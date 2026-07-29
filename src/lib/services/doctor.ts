import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILE_NAME } from '@/constants/nano.js';
import { createKernelModule } from '@/core/kernel/index.js';
import { auditCommands } from '@/misc/utility/command-sync.js';
import { deriveIntents, listPortalDisabledIntents } from
  '@/misc/utility/resolve-intents.js';
import type { ExternalModule } from '@/registry/module-loader.js';
import { loadCoreModule, loadExternalModules } from
  '@/registry/module-loader.js';
import type { NanoConfig } from '@/registry/nano-config.js';
import { loadConfig, NANO_CONFIG_SCHEMA } from '@/registry/nano-config.js';
import { DatabaseService } from '@/services/database.js';
import { StoreClient } from '@/store/store-client.js';
import type { NanoCommand, NanoModule } from '@/types/nano-module.js';

/**
 * The health check behind `npm run doctor`: verifies every layer a
 * running bot depends on WITHOUT logging into the gateway, so it is
 * safe to run any time. Each check reports ok/fail plus a detail line.
 */
export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorOptions {
  root?: string;
  env?: Record<string, string | undefined>;
  fetch_fn?: typeof fetch;
  skip_network?: boolean;
}

const MIN_NODE_MAJOR = 20;
const DISCORD_API_ME = 'https://discord.com/api/v10/users/@me';
const SOURCE_ROOT = dirname(dirname(dirname(fileURLToPath(
  import.meta.url
))));

/**
 * Every slash command the bot would register on boot: the kernel, the
 * core drop-in folder, and each enabled external module — the same set
 * the composition root hands to syncCommands.
 */
export async function collectCommandDefinitions(
  config: NanoConfig
): Promise<NanoCommand[]> {
  const DEFINITIONS: NanoModule[] = [
    createKernelModule(),
    await loadCoreModule(SOURCE_ROOT),
    ...(await loadExternalModules(config)).map(
      (external: ExternalModule): NanoModule => {
        return external.module;
      }
    ),
  ];
  return DEFINITIONS.filter((definition: NanoModule): boolean => {
    return !config.disabled.includes(definition.name);
  }).flatMap((definition: NanoModule): NanoCommand[] => {
    return definition.commands ?? [];
  });
}

export async function runDoctor(
  options: DoctorOptions = {}
): Promise<DoctorCheck[]> {
  const ROOT = options.root ?? process.cwd();
  const ENV = options.env ?? process.env;
  const FETCH = options.fetch_fn ?? fetch;
  const CHECKS: DoctorCheck[] = [];

  /* 1. Node version. */
  const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
  CHECKS.push({
    name: 'node',
    ok: NODE_MAJOR >= MIN_NODE_MAJOR,
    detail: `v${process.versions.node} (needs >= ${MIN_NODE_MAJOR})`,
  });

  /* 2. nano.config.json parses against the schema. */
  const CONFIG_PATH = join(ROOT, CONFIG_FILE_NAME);

  if (!existsSync(CONFIG_PATH)) {
    CHECKS.push({
      name: 'config',
      ok: true,
      detail: `${CONFIG_FILE_NAME} missing — running on defaults.`,
    });
  } else {
    try {
      const PARSED = NANO_CONFIG_SCHEMA.safeParse(
        JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
      );
      CHECKS.push({
        name: 'config',
        ok: PARSED.success,
        detail: PARSED.success
          ? `${CONFIG_FILE_NAME} valid.`
          : 'Invalid — the bot would fall back to defaults.',
      });
    } catch (error: unknown) {
      CHECKS.push({
        name: 'config',
        ok: false,
        detail: `Unreadable JSON: ${String(error)}`,
      });
    }
  }

  const CONFIG = loadConfig(ROOT);

  /* 3. Secrets present in the environment. */
  const TOKEN = ENV.DISCORD_TOKEN;
  const CLIENT_ID = ENV.CLIENT_ID;
  CHECKS.push({
    name: 'secrets',
    ok: Boolean(TOKEN && CLIENT_ID),
    detail: TOKEN && CLIENT_ID
      ? 'DISCORD_TOKEN and CLIENT_ID set.'
      : `Missing: ${[
        TOKEN ? null : 'DISCORD_TOKEN',
        CLIENT_ID ? null : 'CLIENT_ID',
      ].filter(Boolean).join(', ')} (set them in .env).`,
  });

  /* 4. The token actually authenticates against the Discord API. */
  if (TOKEN && !options.skip_network) {
    try {
      const RESPONSE = await FETCH(DISCORD_API_ME, {
        headers: { Authorization: `Bot ${TOKEN}` },
      });

      if (RESPONSE.ok) {
        const ME = await RESPONSE.json() as { username?: string };
        CHECKS.push({
          name: 'discord-api',
          ok: true,
          detail: `Token valid — bot user '${ME.username ?? 'unknown'}'.`,
        });
      } else {
        CHECKS.push({
          name: 'discord-api',
          ok: false,
          detail: `HTTP ${RESPONSE.status} — token rejected or expired.`,
        });
      }
    } catch (error: unknown) {
      CHECKS.push({
        name: 'discord-api',
        ok: false,
        detail: `Unreachable: ${String(error)}`,
      });
    }
  }

  /* 5. Database opens. */
  const DATABASE = DatabaseService.open(CONFIG.database, ROOT);

  if (DATABASE.ok) {
    DATABASE.data.close();
  }

  CHECKS.push({
    name: 'database',
    ok: DATABASE.ok,
    detail: DATABASE.ok
      ? `${CONFIG.database.driver} opens ` +
        `(${CONFIG.database.url ?? 'data/nano.db'}).`
      : DATABASE.error,
  });

  /* 6. Store registry reachable (or served from cache). */
  if (!options.skip_network) {
    const STORE = new StoreClient({
      registry_url: CONFIG.store.registry_url,
      cache_ttl_hours: CONFIG.store.cache_ttl_hours,
      root: ROOT,
      fetch_fn: FETCH,
    });
    const REGISTRY = await STORE.getRegistry();
    CHECKS.push({
      name: 'store',
      ok: REGISTRY.ok,
      detail: REGISTRY.ok
        ? `${REGISTRY.data.modules.length} validated module(s) listed.`
        : REGISTRY.error,
    });
  }

  /* 7. Every configured module entry loads. */
  const LOADED = await loadExternalModules(CONFIG);
  const EXPECTED = CONFIG.modules.length;
  CHECKS.push({
    name: 'modules',
    ok: LOADED.length === EXPECTED,
    detail: `${LOADED.length}/${EXPECTED} module entr` +
      `${EXPECTED === 1 ? 'y' : 'ies'} load` +
      `${LOADED.length === EXPECTED ? '.' : ' — check the errors above.'}`,
  });

  /* 8. Intents summary. */
  const DERIVED = deriveIntents(
    CONFIG.intents,
    LOADED.map((external: ExternalModule): NanoModule => {
      return external.module;
    })
  );
  let intents_ok = true;
  let privileged_note = '';

  if (DERIVED.privileged.length > 0) {
    const GENERIC_NOTE =
      ` — PRIVILEGED (${DERIVED.privileged.join(', ')}): could not ` +
      'verify the developer-portal toggles.';

    if (TOKEN && !options.skip_network) {
      const PORTAL = await listPortalDisabledIntents(
        DERIVED.privileged,
        TOKEN,
        FETCH
      );

      if (PORTAL.ok && PORTAL.data.length === 0) {
        privileged_note =
          ` — privileged (${DERIVED.privileged.join(', ')}) enabled ` +
          'in the developer portal.';
      } else if (PORTAL.ok) {
        intents_ok = false;
        privileged_note =
          ` — PRIVILEGED (${PORTAL.data.join(', ')}) OFF in the ` +
          'developer portal: login will fail or their events will ' +
          'never fire.';
      } else {
        privileged_note = GENERIC_NOTE;
      }
    } else {
      privileged_note = GENERIC_NOTE;
    }
  }

  CHECKS.push({
    name: 'intents',
    ok: intents_ok,
    detail: `${DERIVED.names.join(', ')}${privileged_note}`,
  });

  /* 9. Slash commands registered in the active scope + stale globals. */
  if (TOKEN && CLIENT_ID && !options.skip_network) {
    const LOCAL = await collectCommandDefinitions(CONFIG);
    const AUDIT = await auditCommands(LOCAL, {
      token: TOKEN,
      client_id: CLIENT_ID,
      guild_id: CONFIG.bot.dev_guild_id,
      fetch_fn: FETCH,
    });

    if (!AUDIT.ok) {
      CHECKS.push({ name: 'commands', ok: false, detail: AUDIT.error });
    } else {
      const REPORT = AUDIT.data;
      const SCOPE_LABEL = REPORT.scope === 'guild'
        ? `guild ${CONFIG.bot.dev_guild_id}`
        : 'global';
      const ISSUES = [
        REPORT.missing.length > 0
          ? `missing: ${REPORT.missing.join(', ')}`
          : null,
        REPORT.extra.length > 0
          ? `stale: ${REPORT.extra.join(', ')}`
          : null,
      ].filter(Boolean);
      CHECKS.push({
        name: 'commands',
        ok: REPORT.in_sync,
        detail: REPORT.in_sync
          ? `${REPORT.local.length} command(s) in sync (${SCOPE_LABEL}).`
          : `Out of sync (${SCOPE_LABEL}) — ` +
            `${ISSUES.length > 0 ? ISSUES.join('; ') : 'drifted'} — ` +
            'start the bot or run: npm run module -- commands --sync',
      });

      if (REPORT.stale_global.length > 0) {
        CHECKS.push({
          name: 'global-scope',
          ok: false,
          detail: `${REPORT.stale_global.length} stale global ` +
            `command(s) (${REPORT.stale_global.join(', ')}) — visible ` +
            'in EVERY guild and duplicated in the dev guild; clean: ' +
            'npm run module -- commands --clean-global',
        });
      }
    }
  }
  return CHECKS;
}
