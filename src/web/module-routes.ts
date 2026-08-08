import { readFileSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';

import type {
  Client,
  Guild,
  GuildBasedChannel,
  Role
} from 'discord.js';
import { LRUCache } from 'lru-cache';

import { getGuildSnapshot } from '@/api/guild.js';
import { NANO_VERSION } from '@/constants/nano.js';
import type { CommandGatesConfig } from
  '@/services/command-gates.js';
import {
  COMMAND_GATES_NAMESPACE,
  UNGATEABLE_COMMANDS
} from '@/services/command-gates.js';
import type { GuildConfigIssue } from '@/services/guild-store.js';
import type { DashboardManifest } from '@/types/nano-dashboard.js';
import {
  dashboardValueProblem,
  DEFAULT_ACTOR_GATE
} from '@/types/nano-dashboard.js';
import type {
  NanoCommand,
  NanoCommandHelp,
  NanoHelpCard
} from '@/types/nano-module.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';
import { auditWeb } from '@/web/audit.js';
import {
  adminBitsFor,
  isSnapshotAdmin,
  requireLiveGuildAdmin
} from '@/web/auth/permissions.js';
import type { AuthDeps } from '@/web/auth/routes.js';
import {
  clientIp,
  isHostOwner,
  requireCsrf,
  requireSession,
  sendJson
} from '@/web/auth/routes.js';
import type { WebSession } from '@/web/auth/sessions.js';
import { RateLimiter } from '@/web/auth/sessions.js';
import { resolveWebConfig } from '@/web/hot-config.js';
import {
  listDashboardModules,
  loadModuleDescriptor,
  moduleAssetPath
} from '@/web/manifests.js';
import type { WebContext, WebRouter } from '@/web/router.js';
import { contentTypeFor } from '@/web/static-files.js';

/**
 * The module surface: descriptor windows, config GET/PUT, data views,
 * and actions. Laws enforced here:
 *
 * - READS pass the OAuth-snapshot admin bar; WRITES additionally pass
 *   THE LIVE CHECK (B11) and CSRF.
 * - The PUT accepts the WHOLE object (superRefines need it), but the
 *   write is DIFF-THEN-PATCH (C2): only keys that actually changed
 *   reach patchGuildModuleConfig, preserving the sparse-row posture;
 *   the diff IS the audit log's changed_keys.
 * - Validation failures return the issues[] envelope (C4) so the
 *   client maps errors onto widgets.
 * - The optional module validateConfig hook (B12) runs after zod.
 * - Disabled/failed modules return an explicit unavailable state
 *   (A5); the downgrade gate (C1) surfaces as a conflict.
 * - Actions honor actor_gate ('host' = the bot application owner),
 *   per-guild cooldowns through the EXISTING CooldownManager (B17).
 * - The provides surface is an inter-module seam that trusts its
 *   caller — THIS layer re-applies the operator guards.
 */
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;
const MAX_BODY_BYTES = 524288;
const MAX_ASSET_BYTES = 8388608;
const MS_PER_S = 1000;

/* THE CORE THROTTLE FLOOR (F17): every bound surface throttles even
   when the descriptor omits cooldown_s — a declared value can only
   RAISE the delay, never drop below the floor. */
const VIEW_COOLDOWN_FLOOR_S = 1;
const ACTION_COOLDOWN_FLOOR_S = 2;

/* F16: member lookups remember misses and budget REST calls — an
   authenticated loop over unknown ids answers from memory and the
   per-guild window caps what ever reaches Discord. */
const MEMBER_NEGATIVE_TTL_MS = 60000;
const MEMBER_NEGATIVE_MAX = 5000;
const MEMBER_LOOKUP_MAX_PER_WINDOW = 30;
const MEMBER_LOOKUP_WINDOW_MS = 60000;

const NEGATIVE_MEMBERS = new LRUCache<string, true>({
  max: MEMBER_NEGATIVE_MAX,
  ttl: MEMBER_NEGATIVE_TTL_MS,
});
const MEMBER_LOOKUPS = new RateLimiter({
  max_per_window: MEMBER_LOOKUP_MAX_PER_WINDOW,
  window_ms: MEMBER_LOOKUP_WINDOW_MS,
});

/** Retry-After for every throttle denial — clients and proxies get
    the true wait instead of guessing from the body text. */
function retryAfterS(retry_after_ms: number): Record<string, string> {
  return {
    'retry-after': String(Math.ceil(retry_after_ms / MS_PER_S)),
  };
}

/* F26: every /stats miss costs two id-less REST fetches (channels,
   roles) — a short-TTL cache answers repeat views for free and a
   per-guild cooldown bounds the miss path. */
const STATS_CACHE_TTL_MS = 30000;
const STATS_CACHE_MAX = 500;
const STATS_COOLDOWN_S = 2;

const STATS_CACHE = new LRUCache<string, object>({
  max: STATS_CACHE_MAX,
  ttl: STATS_CACHE_TTL_MS,
});

/* F31: the two config-write routes ride the per-guild house bucket —
   guild-keyed on purpose: sessions are free to mint (5 per user, one
   re-login each), so a session-keyed bucket would be sheddable. */
const CONFIG_WRITE_COOLDOWN_S = 3;

async function readJsonBody(
  req: IncomingMessage,
  max_bytes: number = MAX_BODY_BYTES
): Promise<NanoResult<unknown>> {
  const CHUNKS: Buffer[] = [];
  let total = 0;

  try {
    for await (const _chunk of req) {
      const BUFFER = Buffer.isBuffer(_chunk)
        ? _chunk
        : Buffer.from(String(_chunk));
      total += BUFFER.length;

      if (total > max_bytes) {
        return err('payload_too_large');
      }

      CHUNKS.push(BUFFER);
    }
    return ok(JSON.parse(Buffer.concat(CHUNKS).toString('utf8')));
  } catch (error: unknown) {
    return err(`Unreadable JSON body: ${String(error)}`);
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface RoleRef {
  id: string;
  name: string;
  color: string;
  position: number;
  managed: boolean;
}

interface ChannelRef {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
}

interface GuardedRead {
  session: WebSession;
  guild_id: string;
}

/** Read bar: session + OAuth-snapshot admin of this guild. */
function guardRead(
  deps: AuthDeps,
  context: WebContext
): GuardedRead | null {
  const SESSION = requireSession(deps, context);

  if (!SESSION) {
    return null;
  }

  const GUILD_ID = context.params.gid;
  const WEB = resolveWebConfig(deps.root, deps.frozen);
  const SNAPSHOT = SESSION.guilds.find(
    (guild: { id: string }): boolean => {
      return guild.id === GUILD_ID;
    }
  );

  if (
    !SNAPSHOT ||
    !isSnapshotAdmin(SNAPSHOT, adminBitsFor(WEB.admin_permissions))
  ) {
    sendJson(context.res, HTTP_FORBIDDEN, {
      ok: false,
      error: 'Not an admin of this guild.',
    });
    return null;
  }

  /* F9: the bot must BE in the guild — a pure in-memory lookup
     closing every read route at zero cost. Without it an admin of a
     guild the bot has left keeps reading stored config for up to
     session_ttl_h. */
  if (!deps.bot.guilds.cache.get(GUILD_ID)) {
    sendJson(context.res, HTTP_NOT_FOUND, {
      ok: false,
      error: 'The bot is not in this guild.',
    });
    return null;
  }
  return { session: SESSION, guild_id: GUILD_ID };
}

/** Write bar: read bar + CSRF + THE LIVE CHECK (B11). */
async function guardWrite(
  deps: AuthDeps,
  context: WebContext
): Promise<GuardedRead | null> {
  const READ = guardRead(deps, context);

  if (!READ) {
    return null;
  }

  if (!requireCsrf(context, READ.session)) {
    return null;
  }

  const WEB = resolveWebConfig(deps.root, deps.frozen);
  const LIVE = await requireLiveGuildAdmin(
    deps.bot,
    READ.guild_id,
    READ.session.user.id,
    WEB.admin_permissions
  );

  if (!LIVE.ok) {
    sendJson(context.res, HTTP_FORBIDDEN, {
      ok: false,
      error: `Live admin check failed: ${LIVE.error}`,
    });
    return null;
  }
  return READ;
}

/** F28: the client address for audit lines, proxy-trust aware. */
function auditIp(deps: AuthDeps, context: WebContext): string {
  const WEB = resolveWebConfig(deps.root, deps.frozen);

  return clientIp(context.req, WEB.trust_proxy_header);
}

/** F31: the per-guild write budget for config-shaped PUTs — consumed
    only once validation says the write WILL run, so a rejected body
    never burns the bucket. */
function consumeWriteBudget(
  deps: AuthDeps,
  context: WebContext,
  write: GuardedRead
): boolean {
  const COOLDOWNS = deps.bot.services.cooldowns;

  COOLDOWNS.defineCooldown('web:core:config-write', {
    scope: 'guild',
    delay_ms: CONFIG_WRITE_COOLDOWN_S * MS_PER_S,
  });

  const VERDICT = COOLDOWNS.consume('web:core:config-write', {
    user_id: write.session.user.id,
    guild_id: write.guild_id,
    channel_id: null,
  });

  if (!VERDICT.allowed) {
    sendJson(context.res, HTTP_TOO_MANY, {
      ok: false,
      error: 'On cooldown, retry in ' +
        `${Math.ceil(VERDICT.retry_after_ms / MS_PER_S)}s.`,
    }, retryAfterS(VERDICT.retry_after_ms));
    return false;
  }
  return true;
}

function botGuild(
  deps: AuthDeps,
  context: WebContext,
  guild_id: string
): Guild | null {
  const GUILD = deps.bot.guilds.cache.get(guild_id);

  if (!GUILD) {
    sendJson(context.res, HTTP_NOT_FOUND, {
      ok: false,
      error: 'The bot is not in this guild.',
    });
    return null;
  }
  return GUILD;
}

interface AvailableDescriptor {
  manifest: DashboardManifest;
  registered_config_version: number | null;
}

/** Load a descriptor AND require the module to be available (A5). */
function requireAvailable(
  deps: AuthDeps,
  context: WebContext,
  module_id: string
): AvailableDescriptor | null {
  const LOADED = loadModuleDescriptor(deps.bot, module_id, deps.root);

  if (!LOADED.ok) {
    sendJson(context.res, HTTP_NOT_FOUND, {
      ok: false,
      error: LOADED.error,
    });
    return null;
  }

  if (!LOADED.data.available) {
    sendJson(context.res, HTTP_CONFLICT, {
      ok: false,
      error: `Module '${module_id}' is unavailable ` +
        `(${LOADED.data.reason ?? 'unknown'}).`,
    });
    return null;
  }
  return {
    manifest: LOADED.data.manifest,
    registered_config_version: LOADED.data.registered_config_version,
  };
}

function providesFn(
  bot: Client,
  module_id: string,
  name: string,
  api_version?: string
): ((...args: unknown[]) => unknown) | null {
  /* The api_version HANDSHAKE: a descriptor written for version N
     never dispatches into a module now shipping version M. */
  const API = bot.nano?.getModuleApi<Record<string, unknown>>(
    module_id,
    api_version !== undefined ? { api_version } : undefined
  );
  const FN = API?.[name];
  return typeof FN === 'function'
    ? FN as (...args: unknown[]) => unknown
    : null;
}

/** Send a provides result: NanoResult passthrough, else wrapped ok. */
function sendProvides(context: WebContext, result: unknown): void {
  if (
    result !== null &&
    typeof result === 'object' &&
    'ok' in (result as Record<string, unknown>)
  ) {
    sendJson(context.res, HTTP_OK, result);
    return;
  }

  sendJson(context.res, HTTP_OK, { ok: true, data: result ?? null });
}


/* ---------------------------------------------------------------
 * The commands surface: builder JSON + the help cards every command
 * ships by law, flattened for the dashboard's command cards.
 * --------------------------------------------------------------- */
const OPTION_SUBCOMMAND = 1;
const OPTION_GROUP = 2;

interface RawCommandOption {
  type: number;
  name: string;
  description: string;
  description_localizations?: Record<string, string> | null;
  required?: boolean;
  options?: RawCommandOption[];
}

interface RawCommandJson {
  name: string;
  description?: string;
  description_localizations?: Record<string, string> | null;
  default_member_permissions?: string | null;
  options?: RawCommandOption[];
}

interface CommandArg {
  name: string;
  description: string;
  type: number;
  required: boolean;
}

interface CommandSubRow {
  path: string;
  description: string;
  args: CommandArg[];
  help: NanoHelpCard | null;
}

interface CommandSummary {
  name: string;
  description: string;
  default_member_permissions: string | null;
  cooldown: unknown;
  help: NanoCommandHelp | null;
  args: CommandArg[];
  subcommands: CommandSubRow[];
}

function commandName(command: NanoCommand): string {
  return command.data.name;
}

function argOf(option: RawCommandOption): CommandArg {
  return {
    name: option.name,
    description: option.description,
    type: option.type,
    required: option.required === true,
  };
}

function commandSummary(command: NanoCommand): CommandSummary {
  const RAW = command.data.toJSON() as RawCommandJson;
  const ARGS: CommandArg[] = [];
  const SUBS: CommandSubRow[] = [];

  function subRow(path: string, option: RawCommandOption): void {
    SUBS.push({
      path,
      description: option.description,
      args: (option.options ?? []).map(argOf),
      help: command.help?.subcommands?.[path] ?? null,
    });
  }

  for (const _option of RAW.options ?? []) {
    if (_option.type === OPTION_GROUP) {
      for (const _sub of _option.options ?? []) {
        subRow(`${_option.name} ${_sub.name}`, _sub);
      }
      continue;
    }

    if (_option.type === OPTION_SUBCOMMAND) {
      subRow(_option.name, _option);
      continue;
    }

    ARGS.push(argOf(_option));
  }

  return {
    name: RAW.name,
    description: RAW.description ?? '',
    default_member_permissions:
      RAW.default_member_permissions ?? null,
    cooldown: command.cooldown ?? null,
    help: command.help ?? null,
    args: ARGS,
    subcommands: SUBS,
  };
}

export function registerModuleRoutes(
  router: WebRouter,
  deps: AuthDeps
): void {
  router.add(
    'GET',
    '/api/guilds/:gid/reference',
    (context: WebContext): void => {
      const READ = guardRead(deps, context);

      if (!READ) {
        return;
      }

      const GUILD = botGuild(deps, context, READ.guild_id);

      if (!GUILD) {
        return;
      }

      /* Picker fuel straight from the discord.js cache — free, no
         REST amplification (B16). */
      const ROLES = [...GUILD.roles.cache.values()]
        .map((role: Role): RoleRef => {
          return {
            id: role.id,
            name: role.name,
            color: role.hexColor,
            position: role.position,
            managed: role.managed,
          };
        })
        .sort((a: RoleRef, b: RoleRef): number => {
          return b.position - a.position;
        });
      const CHANNELS = [...GUILD.channels.cache.values()]
        .map((channel: GuildBasedChannel): ChannelRef => {
          return {
            id: channel.id,
            name: channel.name,
            type: channel.type,
            parent_id: channel.parentId,
          };
        });
      sendJson(context.res, HTTP_OK, {
        ok: true,
        data: { roles: ROLES, channels: CHANNELS },
      });
    }
  );

  router.add(
    'GET',
    '/api/guilds/:gid/modules',
    (context: WebContext): void => {
      const READ = guardRead(deps, context);

      if (!READ) {
        return;
      }

      sendJson(context.res, HTTP_OK, {
        ok: true,
        data: { modules: listDashboardModules(deps.bot, deps.root) },
      });
    }
  );

  router.add(
    'GET',
    '/api/guilds/:gid/stats',
    async (context: WebContext): Promise<void> => {
      const READ = guardRead(deps, context);

      if (!READ) {
        return;
      }

      /* F26: cache first — a hit costs no REST and no cooldown. */
      const CACHED = STATS_CACHE.get(READ.guild_id);

      if (CACHED) {
        sendJson(context.res, HTTP_OK, { ok: true, data: CACHED });
        return;
      }

      const COOLDOWNS = deps.bot.services.cooldowns;

      COOLDOWNS.defineCooldown('web:core:stats', {
        scope: 'guild',
        delay_ms: STATS_COOLDOWN_S * MS_PER_S,
      });

      const VERDICT = COOLDOWNS.consume('web:core:stats', {
        user_id: READ.session.user.id,
        guild_id: READ.guild_id,
        channel_id: null,
      });

      if (!VERDICT.allowed) {
        sendJson(context.res, HTTP_TOO_MANY, {
          ok: false,
          error: 'On cooldown, retry in ' +
            `${Math.ceil(VERDICT.retry_after_ms / MS_PER_S)}s.`,
        }, retryAfterS(VERDICT.retry_after_ms));
        return;
      }

      /* The guild stat tiles: the same core guild snapshot the
         Discord surfaces render, served as counters. */
      const SNAPSHOT = await getGuildSnapshot(deps.bot, READ.guild_id);

      if (!SNAPSHOT.ok) {
        sendJson(context.res, HTTP_NOT_FOUND, SNAPSHOT);
        return;
      }

      const DATA = SNAPSHOT.data;
      const DATE_LENGTH = 10;
      const TYPES = DATA.channels.map(
        (channel: { type: string }): string => {
          return channel.type;
        }
      );
      const VOICE = TYPES.filter((type: string): boolean => {
        return type.includes('Voice') || type.includes('Stage');
      }).length;
      const CATEGORIES = TYPES.filter((type: string): boolean => {
        return type === 'GuildCategory';
      }).length;
      const TEXTUAL = TYPES.length - VOICE - CATEGORIES;
      const MANAGED = DATA.roles.filter(
        (role: { managed: boolean }): boolean => {
          return role.managed;
        }
      ).length;
      const PAYLOAD = {
        tiles: [
          {
            label: { en: 'members', es: 'miembros' },
            value: DATA.member_count,
            hint: {
              en: 'Total members in this server right now.',
              es: 'Total de miembros en este servidor ahora.',
            },
          },
          {
            label: { en: 'channels', es: 'canales' },
            value: DATA.channels.length,
            hint: {
              en: `${TEXTUAL} text, ${VOICE} voice, ` +
                  `${CATEGORIES} categories.`,
              es: `${TEXTUAL} de texto, ${VOICE} de voz, ` +
                  `${CATEGORIES} categorías.`,
            },
          },
          {
            label: { en: 'roles', es: 'roles' },
            value: DATA.roles.length,
            hint: {
              en: `${DATA.roles.length - MANAGED} custom roles, ` +
                  `${MANAGED} managed by integrations.`,
              es: `${DATA.roles.length - MANAGED} roles propios, ` +
                  `${MANAGED} manejados por integraciones.`,
            },
          },
          {
            label: { en: 'boosts', es: 'mejoras' },
            value: DATA.premium_subscription_count ?? 0,
            hint: {
              en: 'Active Nitro boosts on this server.',
              es: 'Mejoras Nitro activas en este servidor.',
            },
          },
          {
            label: { en: 'verification', es: 'verificación' },
            value: DATA.verification_level.toLowerCase(),
            hint: {
              en: 'The gate new members pass before chatting.',
              es: 'El filtro que pasan los nuevos miembros ' +
                  'antes de chatear.',
            },
          },
          {
            label: { en: 'created', es: 'creado' },
            value: DATA.created_at.slice(0, DATE_LENGTH),
            hint: {
              en: 'The day this server was created.',
              es: 'El día en que se creó este servidor.',
            },
          },
        ],
        bars: [
          {
            label: { en: 'channel mix', es: 'mezcla de canales' },
            segments: [
              {
                label: { en: 'text', es: 'texto' },
                value: TEXTUAL,
              },
              { label: { en: 'voice', es: 'voz' }, value: VOICE },
              {
                label: { en: 'categories', es: 'categorías' },
                value: CATEGORIES,
              },
            ],
          },
          {
            label: { en: 'role mix', es: 'mezcla de roles' },
            segments: [
              {
                label: { en: 'custom', es: 'propios' },
                value: DATA.roles.length - MANAGED,
              },
              {
                label: { en: 'managed', es: 'manejados' },
                value: MANAGED,
              },
            ],
          },
        ],
      };

      STATS_CACHE.set(READ.guild_id, PAYLOAD);
      sendJson(context.res, HTTP_OK, { ok: true, data: PAYLOAD });
    }
  );

  router.add(
    'GET',
    '/api/guilds/:gid/instance',
    (context: WebContext): void => {
      const READ = guardRead(deps, context);

      if (!READ) {
        return;
      }

      /* The nano-core window: HOST-owned instance configuration,
         READ-ONLY by law — per-guild writes flow only through the
         guild store; host config moves via nano.config.json/TUI.
         F25: process-global facts (driver, intents, socket) are
         HOST-TIER — a guild admin gets only the public identity. */
      const FROZEN = deps.frozen;
      const BASE = {
        bot_name: FROZEN.bot.name,
        bot_username: deps.bot.user?.username ?? null,
        version: NANO_VERSION,
        modules: listDashboardModules(deps.bot, deps.root),
      };
      const DATA = isHostOwner(deps, READ.session.user.id)
        ? {
          ...BASE,
          database_driver: FROZEN.database.driver,
          intents: FROZEN.intents,
          web: { port: FROZEN.web.port, bind: FROZEN.web.bind },
        }
        : BASE;
      sendJson(context.res, HTTP_OK, { ok: true, data: DATA });
    }
  );

  router.add(
    'GET',
    '/api/guilds/:gid/modules/:mid/descriptor',
    (context: WebContext): void => {
      const READ = guardRead(deps, context);

      if (!READ) {
        return;
      }

      const LOADED = loadModuleDescriptor(
        deps.bot,
        context.params.mid,
        deps.root
      );

      if (!LOADED.ok) {
        sendJson(context.res, HTTP_NOT_FOUND, {
          ok: false,
          error: LOADED.error,
        });
        return;
      }

      sendJson(context.res, HTTP_OK, { ok: true, data: LOADED.data });
    }
  );

  router.add(
    'GET',
    '/api/guilds/:gid/modules/:mid/assets/:file',
    (context: WebContext): void => {
      const READ = guardRead(deps, context);

      if (!READ) {
        return;
      }

      /* Presentation assets ship BESIDE the descriptor
         (nano-dashboard-assets/); resolution is whitelisted and
         traversal-safe in moduleAssetPath. */
      const ASSET = moduleAssetPath(
        context.params.mid,
        context.params.file,
        deps.root
      );

      if (!ASSET.ok) {
        sendJson(context.res, HTTP_NOT_FOUND, {
          ok: false,
          error: ASSET.error,
        });
        return;
      }

      /* Size-capped: a module shipping an oversized asset must not
         stall the gateway event loop. */
      if (statSync(ASSET.data).size > MAX_ASSET_BYTES) {
        sendJson(context.res, HTTP_PAYLOAD_TOO_LARGE, {
          ok: false,
          error: 'Asset exceeds the size cap.',
        });
        return;
      }

      const BODY = readFileSync(ASSET.data);

      context.res.writeHead(HTTP_OK, {
        'content-type': contentTypeFor(ASSET.data),
        'content-length': BODY.length,
        /* F5a/D7: this route sits behind the read bar — 'private'
           keeps Cloudflare and every shared cache from serving an
           authenticated response to another identity. */
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
      });
      context.res.end(BODY);
    }
  );

  router.add(
    'GET',
    '/api/guilds/:gid/members/:uid',
    async (context: WebContext): Promise<void> => {
      const READ = guardRead(deps, context);

      if (!READ) {
        return;
      }

      const GUILD = botGuild(deps, context, READ.guild_id);

      if (!GUILD) {
        return;
      }

      if (!/^[0-9]{5,25}$/.test(context.params.uid)) {
        sendJson(context.res, HTTP_BAD_REQUEST, {
          ok: false,
          error: 'Bad member id.',
        });
        return;
      }

      /* F16: a repeated unknown id answers from the negative cache
         and REST lookups ride a per-guild window — an authenticated
         loop can no longer turn this route into a REST hammer. */
      const NEGATIVE_KEY = `${READ.guild_id}:${context.params.uid}`;

      if (NEGATIVE_MEMBERS.get(NEGATIVE_KEY)) {
        sendJson(context.res, HTTP_NOT_FOUND, {
          ok: false,
          error: 'No such member in this guild.',
        });
        return;
      }

      const CACHED = GUILD.members.cache.get(context.params.uid);

      if (CACHED) {
        sendJson(context.res, HTTP_OK, {
          ok: true,
          data: {
            id: CACHED.id,
            username: CACHED.user.username,
            display_name: CACHED.displayName,
          },
        });
        return;
      }

      if (!MEMBER_LOOKUPS.allow(READ.guild_id)) {
        sendJson(context.res, HTTP_TOO_MANY, {
          ok: false,
          error: 'Member lookups are cooling down - retry shortly.',
        }, retryAfterS(MEMBER_LOOKUP_WINDOW_MS));
        return;
      }

      /* ONE member by id — the opcode-8 law budgets full-list
         fetches, never singles. */
      try {
        const MEMBER = await GUILD.members.fetch(context.params.uid);

        sendJson(context.res, HTTP_OK, {
          ok: true,
          data: {
            id: MEMBER.id,
            username: MEMBER.user.username,
            display_name: MEMBER.displayName,
          },
        });
      } catch {
        NEGATIVE_MEMBERS.set(NEGATIVE_KEY, true);
        sendJson(context.res, HTTP_NOT_FOUND, {
          ok: false,
          error: 'No such member in this guild.',
        });
      }
    }
  );

  router.add(
    'GET',
    '/api/guilds/:gid/modules/:mid/commands',
    (context: WebContext): void => {
      const READ = guardRead(deps, context);

      if (!READ) {
        return;
      }

      const MODULE_ID = context.params.mid;
      const ENTRY = deps.bot.nano?.get(MODULE_ID);

      if (!ENTRY) {
        sendJson(context.res, HTTP_NOT_FOUND, {
          ok: false,
          error: `No registered module named '${MODULE_ID}'.`,
        });
        return;
      }

      const COMMANDS = (ENTRY.module.commands ?? []).map(
        commandSummary
      );
      const SUBCOMMAND_COUNT = COMMANDS.reduce(
        (sum: number, command: CommandSummary): number => {
          return sum + command.subcommands.length;
        },
        0
      );
      const NAMES = new Set(COMMANDS.map(
        (command: CommandSummary): string => {
          return command.name;
        }
      ));
      const STORED = deps.bot.services.guild_store
        .getGuildModuleConfig<CommandGatesConfig>(
          READ.guild_id,
          COMMAND_GATES_NAMESPACE
        );
      const GATES: Record<string, unknown> = {};

      for (const [_path, _gate] of Object.entries(STORED.gates)) {
        if (NAMES.has(_path.split(' ')[0])) {
          GATES[_path] = _gate;
        }
      }

      sendJson(context.res, HTTP_OK, {
        ok: true,
        data: {
          commands: COMMANDS,
          gates: GATES,
          ungateable: UNGATEABLE_COMMANDS,
          counts: {
            commands: COMMANDS.length,
            subcommands: SUBCOMMAND_COUNT,
          },
        },
      });
    }
  );

  router.add(
    'PUT',
    '/api/guilds/:gid/modules/:mid/commands/gates',
    async (context: WebContext): Promise<void> => {
      const WRITE = await guardWrite(deps, context);

      if (!WRITE) {
        return;
      }

      const MODULE_ID = context.params.mid;
      const ENTRY = deps.bot.nano?.get(MODULE_ID);

      if (!ENTRY) {
        sendJson(context.res, HTTP_NOT_FOUND, {
          ok: false,
          error: `No registered module named '${MODULE_ID}'.`,
        });
        return;
      }

      /* A5: gate writes require the module to be live. */
      if (!ENTRY.enabled) {
        sendJson(context.res, HTTP_CONFLICT, {
          ok: false,
          error: `Module '${MODULE_ID}' is disabled.`,
        });
        return;
      }

      const BODY = await readJsonBody(context.req);

      if (!BODY.ok) {
        sendJson(context.res, HTTP_BAD_REQUEST, BODY);
        return;
      }

      const RAW_GATES = (BODY.data as { gates?: unknown })?.gates;

      if (RAW_GATES === null || typeof RAW_GATES !== 'object') {
        sendJson(context.res, HTTP_BAD_REQUEST, {
          ok: false,
          error: 'Body must carry a gates object.',
        });
        return;
      }

      /* This window may shape ONLY its own module's command paths,
         and the recovery command is never gateable. */
      const NAMES = new Set((ENTRY.module.commands ?? []).map(
        (command: NanoCommand): string => {
          return commandName(command);
        }
      ));

      for (const _path of Object.keys(
        RAW_GATES as Record<string, unknown>
      )) {
        const ROOT = _path.split(' ')[0];

        if (UNGATEABLE_COMMANDS.includes(ROOT)) {
          sendJson(context.res, HTTP_FORBIDDEN, {
            ok: false,
            error: `'/${ROOT}' is the recovery path and is never ` +
              'gateable.',
          });
          return;
        }

        if (!NAMES.has(ROOT)) {
          sendJson(context.res, HTTP_BAD_REQUEST, {
            ok: false,
            error: `'${_path}' does not belong to module ` +
              `'${MODULE_ID}'.`,
          });
          return;
        }
      }

      const STORE = deps.bot.services.guild_store;
      const CURRENT = STORE.getGuildModuleConfig<CommandGatesConfig>(
        WRITE.guild_id,
        COMMAND_GATES_NAMESPACE
      );
      const NEXT: Record<string, unknown> = {};

      for (const [_path, _gate] of Object.entries(CURRENT.gates)) {
        if (!NAMES.has(_path.split(' ')[0])) {
          NEXT[_path] = _gate;
        }
      }

      for (const [_path, _gate] of Object.entries(
        RAW_GATES as Record<string, unknown>
      )) {
        NEXT[_path] = _gate;
      }

      const CANDIDATE = { gates: NEXT };
      const CHECKED = STORE.checkGuildModuleConfig(
        COMMAND_GATES_NAMESPACE,
        CANDIDATE
      );

      if (!CHECKED.ok) {
        sendJson(context.res, HTTP_BAD_REQUEST, {
          ok: false,
          error: 'Gate validation failed.',
          issues: CHECKED.issues,
        });
        return;
      }

      const CHANGED_PATHS = [
        ...new Set([
          ...Object.keys(CURRENT.gates),
          ...Object.keys(NEXT),
        ]),
      ].filter((path: string): boolean => {
        return !jsonEqual(CURRENT.gates[path], NEXT[path]);
      });

      if (!consumeWriteBudget(deps, context, WRITE)) {
        return;
      }

      const RESULT = STORE.patchGuildModuleConfig(
        WRITE.guild_id,
        COMMAND_GATES_NAMESPACE,
        CANDIDATE
      );

      if (!RESULT.ok) {
        sendJson(context.res, HTTP_BAD_REQUEST, {
          ok: false,
          error: RESULT.error,
        });
        return;
      }

      auditWeb({
        kind: 'command_gates_put',
        user_id: WRITE.session.user.id,
        guild_id: WRITE.guild_id,
        module_id: MODULE_ID,
        changed_keys: CHANGED_PATHS,
        ip: auditIp(deps, context),
      });
      sendJson(context.res, HTTP_OK, {
        ok: true,
        data: {
          gates: (RESULT.data as CommandGatesConfig).gates,
          changed_paths: CHANGED_PATHS,
        },
      });
    }
  );

  router.add(
    'GET',
    '/api/guilds/:gid/modules/:mid/config',
    (context: WebContext): void => {
      const READ = guardRead(deps, context);

      if (!READ) {
        return;
      }

      const MODULE_ID = context.params.mid;
      const DESCRIPTOR = requireAvailable(deps, context, MODULE_ID);

      if (!DESCRIPTOR) {
        return;
      }

      const STORE = deps.bot.services.guild_store;
      const CONFIG = STORE.getGuildModuleConfig(
        READ.guild_id,
        MODULE_ID
      );

      /* THE HOST-TIER READ GATE (the F25 sibling, 2026-08-07): the
         tier gate was WRITE-only and this route returned every key
         — load-bearing the moment any module stores a credential
         at host tier. Non-owners get host VALUES withheld (null);
         the key survives so the widget still renders read-only. */
      if (!isHostOwner(deps, READ.session.user.id)) {
        for (const _field of DESCRIPTOR.manifest.config.fields) {
          if (
            (_field as { tier?: string }).tier === 'host' &&
            _field.key in CONFIG
          ) {
            (CONFIG as Record<string, unknown>)[_field.key] = null;
          }
        }
      }
      sendJson(context.res, HTTP_OK, {
        ok: true,
        data: {
          config: CONFIG,
          version: STORE.schemaVersionOf(MODULE_ID),
        },
      });
    }
  );

  router.add(
    'PUT',
    '/api/guilds/:gid/modules/:mid/config',
    async (context: WebContext): Promise<void> => {
      const WRITE = await guardWrite(deps, context);

      if (!WRITE) {
        return;
      }

      const MODULE_ID = context.params.mid;
      const DESCRIPTOR = requireAvailable(deps, context, MODULE_ID);

      if (!DESCRIPTOR) {
        return;
      }

      const BODY = await readJsonBody(context.req);

      if (!BODY.ok) {
        sendJson(
          context.res,
          BODY.error === 'payload_too_large'
            ? HTTP_PAYLOAD_TOO_LARGE
            : HTTP_BAD_REQUEST,
          { ok: false, error: BODY.error }
        );
        return;
      }

      if (
        BODY.data === null ||
        typeof BODY.data !== 'object' ||
        Array.isArray(BODY.data)
      ) {
        sendJson(context.res, HTTP_BAD_REQUEST, {
          ok: false,
          error: 'The config body must be a JSON object.',
        });
        return;
      }

      const CANDIDATE = BODY.data as Record<string, unknown>;
      const STORE = deps.bot.services.guild_store;
      const CHECKED = STORE.checkGuildModuleConfig(MODULE_ID, CANDIDATE);

      if (!CHECKED.ok) {
        const ISSUES: GuildConfigIssue[] = CHECKED.issues ?? [];
        sendJson(context.res, HTTP_BAD_REQUEST, {
          ok: false,
          error: CHECKED.error,
          issues: ISSUES,
        });
        return;
      }

      /* The B12 layer: the module's own semantic validation hook runs
         after zod, before any write. */
      const VALIDATE_NAME = DESCRIPTOR.manifest.config.validate;

      if (VALIDATE_NAME) {
        const HOOK = providesFn(
          deps.bot,
          MODULE_ID,
          VALIDATE_NAME,
          DESCRIPTOR.manifest.api_version
        );

        if (HOOK) {
          const VERDICT = await HOOK(WRITE.guild_id, CHECKED.data);

          if (
            VERDICT !== null &&
            typeof VERDICT === 'object' &&
            (VERDICT as { ok?: boolean }).ok === false
          ) {
            sendJson(context.res, HTTP_BAD_REQUEST, {
              ok: false,
              error: String(
                (VERDICT as { error?: unknown }).error ??
                'The module rejected this configuration.'
              ),
            });
            return;
          }
        }
      }

      /* DIFF-THEN-PATCH (C2): a dashboard save must never freeze
         every default as an explicit row. */
      const CURRENT = STORE.getGuildModuleConfig(
        WRITE.guild_id,
        MODULE_ID
      );
      const NEXT = CHECKED.data;
      const CHANGED = Object.keys(NEXT)
        .filter((key: string): boolean => {
          return !jsonEqual(NEXT[key], CURRENT[key]);
        });

      if (CHANGED.length === 0) {
        sendJson(context.res, HTTP_OK, {
          ok: true,
          data: {
            config: CURRENT,
            version: STORE.schemaVersionOf(MODULE_ID),
            changed_keys: [],
          },
        });
        return;
      }

      /* THE C6 HOST TIER (owner ruling 2026-08-05): host-tier keys
         are dashboard-read-only for everyone except the bot owner —
         enforced HERE, not just rendered, so a hand-crafted PUT
         cannot slip a host key past the UI. */
      const HOST_KEYS = DESCRIPTOR.manifest.config.fields
        .filter((field: { key: string; tier?: string }): boolean => {
          return field.tier === 'host';
        })
        .map((field: { key: string }): string => {
          return field.key;
        });
      const BLOCKED = CHANGED.filter((key: string): boolean => {
        return HOST_KEYS.includes(key);
      });

      if (
        BLOCKED.length > 0 &&
        !isHostOwner(deps, WRITE.session.user.id)
      ) {
        sendJson(context.res, HTTP_FORBIDDEN, {
          ok: false,
          error: `Host-tier keys (${BLOCKED.join(', ')}) are ` +
            'editable only by the bot owner.',
        });
        return;
      }

      if (!consumeWriteBudget(deps, context, WRITE)) {
        return;
      }

      const PATCH: Record<string, unknown> = {};

      for (const _key of CHANGED) {
        PATCH[_key] = NEXT[_key];
      }

      const RESULT = STORE.patchGuildModuleConfig(
        WRITE.guild_id,
        MODULE_ID,
        PATCH
      );

      if (!RESULT.ok) {
        const IS_DOWNGRADE = RESULT.error.includes(
          'exceeds the registered version'
        );
        sendJson(
          context.res,
          IS_DOWNGRADE ? HTTP_CONFLICT : HTTP_BAD_REQUEST,
          { ok: false, error: RESULT.error }
        );
        return;
      }

      auditWeb({
        kind: 'config_put',
        user_id: WRITE.session.user.id,
        guild_id: WRITE.guild_id,
        module_id: MODULE_ID,
        changed_keys: CHANGED,
        ip: auditIp(deps, context),
      });
      sendJson(context.res, HTTP_OK, {
        ok: true,
        data: {
          config: RESULT.data,
          version: STORE.schemaVersionOf(MODULE_ID),
          changed_keys: CHANGED,
        },
      });
    }
  );

  router.add(
    'GET',
    '/api/guilds/:gid/modules/:mid/data/:view',
    async (context: WebContext): Promise<void> => {
      const READ = guardRead(deps, context);

      if (!READ) {
        return;
      }

      const MODULE_ID = context.params.mid;
      const DESCRIPTOR = requireAvailable(deps, context, MODULE_ID);

      if (!DESCRIPTOR) {
        return;
      }

      const VIEW = (DESCRIPTOR.manifest.data ?? []).find(
        (item: { id: string }): boolean => {
          return item.id === context.params.view;
        }
      );

      if (!VIEW) {
        sendJson(context.res, HTTP_NOT_FOUND, {
          ok: false,
          error: `No data view '${context.params.view}'.`,
        });
        return;
      }

      /* Expensive reads throttle exactly like actions (B17) — the
         member-fetch law's second half. The core floor (F17) applies
         even when the descriptor omits cooldown_s. */
      const VIEW_DELAY_S = Math.max(
        VIEW_COOLDOWN_FLOOR_S,
        VIEW.cooldown_s ?? 0
      );
      const KEY = `web:${MODULE_ID}:data:${VIEW.id}`;
      const COOLDOWNS = deps.bot.services.cooldowns;

      COOLDOWNS.defineCooldown(KEY, {
        scope: 'guild',
        delay_ms: VIEW_DELAY_S * MS_PER_S,
      });

      const VERDICT = COOLDOWNS.consume(KEY, {
        user_id: READ.session.user.id,
        guild_id: READ.guild_id,
        channel_id: null,
      });

      if (!VERDICT.allowed) {
        sendJson(context.res, HTTP_TOO_MANY, {
          ok: false,
          error: 'On cooldown, retry in ' +
            `${Math.ceil(VERDICT.retry_after_ms / MS_PER_S)}s.`,
        }, retryAfterS(VERDICT.retry_after_ms));
        return;
      }

      const FN = providesFn(
        deps.bot,
        MODULE_ID,
        VIEW.provides,
        DESCRIPTOR.manifest.api_version
      );

      if (!FN) {
        sendJson(context.res, HTTP_SERVER_ERROR, {
          ok: false,
          error: `Provides function '${VIEW.provides}' is missing.`,
        });
        return;
      }

      const PARAMS: Record<string, string> = {};

      for (const _field of VIEW.params ?? []) {
        const VALUE = context.url.searchParams.get(_field.key);

        if (VALUE !== null) {
          PARAMS[_field.key] = VALUE;
        }
      }

      /* guild_id auto-injected first (N13 lazy resolution above). */
      const RESULT = VIEW.params && VIEW.params.length > 0
        ? await FN(READ.guild_id, PARAMS)
        : await FN(READ.guild_id);
      sendProvides(context, RESULT);
    }
  );

  router.add(
    'POST',
    '/api/guilds/:gid/modules/:mid/actions/:action',
    async (context: WebContext): Promise<void> => {
      const WRITE = await guardWrite(deps, context);

      if (!WRITE) {
        return;
      }

      const MODULE_ID = context.params.mid;
      const DESCRIPTOR = requireAvailable(deps, context, MODULE_ID);

      if (!DESCRIPTOR) {
        return;
      }

      const ACTION = (DESCRIPTOR.manifest.actions ?? []).find(
        (item: { id: string }): boolean => {
          return item.id === context.params.action;
        }
      );

      if (!ACTION) {
        sendJson(context.res, HTTP_NOT_FOUND, {
          ok: false,
          error: `No action '${context.params.action}'.`,
        });
        return;
      }

      /* actor_gate (B14): 'host' actions belong to the
         env-configured bot owner (BOT_OWNER_ID). */
      const GATE = ACTION.actor_gate ?? DEFAULT_ACTOR_GATE;

      if (GATE === 'host' &&
          !isHostOwner(deps, WRITE.session.user.id)) {
        sendJson(context.res, HTTP_FORBIDDEN, {
          ok: false,
          error: 'This action is reserved for the bot owner.',
        });
        return;
      }

      const FN = providesFn(
        deps.bot,
        MODULE_ID,
        ACTION.provides,
        DESCRIPTOR.manifest.api_version
      );

      if (!FN) {
        sendJson(context.res, HTTP_SERVER_ERROR, {
          ok: false,
          error: `Provides function '${ACTION.provides}' is missing.`,
        });
        return;
      }

      const BODY = await readJsonBody(context.req);

      if (!BODY.ok) {
        /* F14: a body that failed to parse never dispatches — the
           action would otherwise run with silently-empty params. */
        const STATUS = BODY.error === 'payload_too_large'
          ? HTTP_PAYLOAD_TOO_LARGE
          : HTTP_BAD_REQUEST;

        sendJson(context.res, STATUS, {
          ok: false,
          error: 'Action body must be valid JSON.',
        });
        return;
      }

      const RAW_PARAMS = BODY.data !== null &&
        typeof BODY.data === 'object'
        ? (BODY.data as { params?: Record<string, unknown> }).params
        : undefined;

      /* THE DECLARED-CONTRACT FILTER: only params the descriptor
         declares cross the seam — a hand-crafted POST cannot reach
         behavior the UI cannot express. Since 2026-08-07 the VALUE
         must also match the declared type (F24); a mistyped param
         refuses the dispatch instead of passing through verbatim. */
      const PARAMS: Record<string, unknown> = {};

      if (RAW_PARAMS !== null && typeof RAW_PARAMS === 'object') {
        for (const _field of ACTION.params ?? []) {
          const VALUE = RAW_PARAMS[_field.key];

          if (VALUE !== undefined) {
            const PROBLEM = dashboardValueProblem(_field, VALUE);

            if (PROBLEM !== null) {
              sendJson(context.res, HTTP_BAD_REQUEST, {
                ok: false,
                error: `Invalid param: ${PROBLEM}.`,
              });
              return;
            }

            PARAMS[_field.key] = VALUE;
          }
        }
      }

      /* Per-guild cooldown through the EXISTING manager (B17). The
         core floor (F17) applies even when the descriptor omits
         cooldown_s. Consumed only once the dispatch WILL run — a
         refused request must not burn the guild's bucket. */
      const ACTION_DELAY_S = Math.max(
        ACTION_COOLDOWN_FLOOR_S,
        ACTION.cooldown_s ?? 0
      );
      const KEY = `web:${MODULE_ID}:${ACTION.id}`;
      const COOLDOWNS = deps.bot.services.cooldowns;
      COOLDOWNS.defineCooldown(KEY, {
        scope: 'guild',
        delay_ms: ACTION_DELAY_S * MS_PER_S,
      });

      const VERDICT = COOLDOWNS.consume(KEY, {
        user_id: WRITE.session.user.id,
        guild_id: WRITE.guild_id,
      });

      if (!VERDICT.allowed) {
        sendJson(context.res, HTTP_TOO_MANY, {
          ok: false,
          error: 'Cooldown - retry in ' +
            `${Math.ceil(VERDICT.retry_after_ms / MS_PER_S)}s.`,
        }, retryAfterS(VERDICT.retry_after_ms));
        return;
      }

      /* The dispatch context: the acting user rides a third arg so
         module ledgers can attribute dashboard writes. */
      const CONTEXT = { actor_id: WRITE.session.user.id };
      const RESULT = ACTION.params && ACTION.params.length > 0
        ? await FN(WRITE.guild_id, PARAMS, CONTEXT)
        : await FN(WRITE.guild_id, undefined, CONTEXT);

      auditWeb({
        kind: 'action',
        user_id: WRITE.session.user.id,
        guild_id: WRITE.guild_id,
        module_id: MODULE_ID,
        detail: ACTION.id,
        ip: auditIp(deps, context),
      });
      sendProvides(context, RESULT);
    }
  );
}
