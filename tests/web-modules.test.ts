import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Client } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defaultConfig } from '@/registry/nano-config.js';
import { NanoCache } from '@/services/cache.js';
import { CooldownManager } from '@/services/cooldown.js';
import { DatabaseService } from '@/services/database.js';
import { GuildStore } from '@/services/guild-store.js';
import type { FetchLike } from '@/web/auth/oauth.js';
import {
  startWebServer,
  stopWebServer,
  webServerPort
} from '@/web/server.js';

const GUILD_ID = '100';
/* In the session snapshot but NOT in the bot's guild cache (F9). */
const GONE_GUILD_ID = '101';
const SESSION_USER = 'u1';
const MODULE_ID = 'testmod';
const CONFIG_VERSION = 2;
const TEST_ENV = {
  DISCORD_CLIENT_SECRET: 'test-secret',
  CLIENT_ID: '1234567890',
};

const TEST_SCHEMA = z.object({
  greeting: z.string().default('hi'),
  count: z.number().int()
    .default(0),
  danger_role: z.string().default(''),
});

const DESCRIPTOR = {
  title: 'Test Module',
  config_version: CONFIG_VERSION,
  config: {
    validate: 'validateConfig',
    fields: [
      { key: 'greeting', label: 'Greeting', type: 'text' },
      { key: 'count', label: 'Count', type: 'number' },
      {
        key: 'danger_role',
        label: 'Danger role',
        type: 'snowflake',
        kind: 'role',
        tier: 'host',
      },
    ],
  },
  data: [
    { id: 'things', title: 'Things', provides: 'listThings' },
    {
      id: 'lookup',
      title: 'Lookup',
      provides: 'lookupThing',
      params: [
        { key: 'user_id', label: 'User', type: 'snowflake', kind: 'user' },
      ],
    },
  ],
  actions: [
    { id: 'wave', label: 'Wave', provides: 'wave' },
    {
      id: 'nuke',
      label: 'Nuke',
      provides: 'nuke',
      actor_gate: 'host',
      danger: true,
      confirm: true,
    },
    { id: 'slow', label: 'Slow', provides: 'wave', cooldown_s: 60 },
    {
      id: 'echo',
      label: 'Echo',
      provides: 'echoBack',
      params: [
        {
          key: 'target',
          label: 'Target',
          type: 'snowflake',
          kind: 'user',
        },
        { key: 'count', label: 'Count', type: 'number', max: 10 },
      ],
    },
  ],
};

interface Harness {
  root: string;
  database: DatabaseService;
  store: GuildStore;
  bot: Client;
  module_state: { enabled: boolean };
  provides_calls: string[];
  fetch_impl: FetchLike;
  /** The env-configured BOT_OWNER_ID for this run. */
  owner_id: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function discordFetch(): FetchLike {
  return async (input: string): Promise<Response> => {
    if (input.includes('/oauth2/token/revoke')) {
      return jsonResponse(200, {});
    }

    if (input.includes('/oauth2/token')) {
      return jsonResponse(200, {
        access_token: 'at-1',
        expires_in: 604800,
      });
    }

    if (input.includes('/users/@me/guilds')) {
      return jsonResponse(200, [
        {
          id: GUILD_ID,
          name: 'Alpha',
          icon: null,
          owner: true,
          permissions: '0',
        },
        {
          id: GONE_GUILD_ID,
          name: 'Departed',
          icon: null,
          owner: true,
          permissions: '0',
        },
      ]);
    }

    if (input.includes('/users/@me')) {
      return jsonResponse(200, { id: SESSION_USER, username: 'kyo' });
    }
    return jsonResponse(404, {});
  };
}

interface HarnessOptions {
  /** The guild's LIVE owner (B11); default = the session user. */
  live_owner_id?: string;
  /** The bot application owner (host actor gate). */
  app_owner_id?: string;
}

function buildHarness(options: HarnessOptions = {}): Harness {
  const ROOT = mkdtempSync(join(tmpdir(), 'nano-web-mod-'));
  const MODULE_DIR = join(ROOT, 'mods', MODULE_ID);

  mkdirSync(MODULE_DIR, { recursive: true });
  writeFileSync(
    join(MODULE_DIR, 'nano-dashboard.json'),
    JSON.stringify(DESCRIPTOR)
  );

  /* A module whose descriptor EXISTS but fails the schema — its
     served error must scrub the checkout root (F1). */
  const BROKEN_DIR = join(ROOT, 'mods', 'broken');

  mkdirSync(BROKEN_DIR, { recursive: true });
  writeFileSync(
    join(BROKEN_DIR, 'nano-dashboard.json'),
    JSON.stringify({ title: 123 })
  );

  const CONFIG = defaultConfig();

  CONFIG.modules = [`./mods/${MODULE_ID}`, './mods/broken'];
  CONFIG.web = { ...CONFIG.web, enabled: true, port: 0 };
  writeFileSync(
    join(ROOT, 'nano.config.json'),
    JSON.stringify(CONFIG)
  );

  const OPENED = DatabaseService.open({ driver: 'sqlite' }, ROOT);

  if (!OPENED.ok) {
    throw new Error(OPENED.error);
  }

  const STORE = new GuildStore(
    OPENED.data.guildConfigPersistence(),
    new NanoCache()
  );

  STORE.registerSchema(MODULE_ID, {
    schema: TEST_SCHEMA,
    config_version: CONFIG_VERSION,
  });

  const MODULE_STATE = { enabled: true };
  const PROVIDES_CALLS: string[] = [];
  const PROVIDES: Record<string, unknown> = {
    listThings: (guild_id: string): unknown => {
      PROVIDES_CALLS.push(`listThings:${guild_id}`);
      return { ok: true, data: { things: [guild_id] } };
    },
    lookupThing: (
      guild_id: string,
      params: Record<string, string>
    ): unknown => {
      PROVIDES_CALLS.push(`lookupThing:${guild_id}`);
      return { ok: true, data: { guild_id, user_id: params.user_id } };
    },
    wave: (guild_id: string): unknown => {
      PROVIDES_CALLS.push(`wave:${guild_id}`);
      return { ok: true, data: 'waved' };
    },
    nuke: (guild_id: string): unknown => {
      PROVIDES_CALLS.push(`nuke:${guild_id}`);
      return { ok: true, data: 'nuked' };
    },
    echoBack: (
      guild_id: string,
      params: Record<string, unknown>
    ): unknown => {
      PROVIDES_CALLS.push(
        `echoBack:${guild_id}:${JSON.stringify(params)}`
      );
      return { ok: true, data: params };
    },
    validateConfig: (
      guild_id: string,
      candidate: Record<string, unknown>
    ): unknown => {
      PROVIDES_CALLS.push(`validateConfig:${guild_id}`);

      if (candidate.danger_role === 'privileged') {
        return { ok: false, error: 'privileged role refused' };
      }
      return { ok: true, data: null };
    },
  };

  const LIVE_OWNER = options.live_owner_id ?? SESSION_USER;
  const GUILD = {
    id: GUILD_ID,
    ownerId: LIVE_OWNER,
    members: {
      cache: new Map(),
      fetch: (uid: string): Promise<never> => {
        PROVIDES_CALLS.push(`memberFetch:${uid}`);
        return Promise.reject(new Error('not a member'));
      },
    },
    roles: {
      cache: new Map([[
        'r1',
        {
          id: 'r1',
          name: 'Role One',
          hexColor: '#aabbcc',
          position: 5,
          managed: false,
        },
      ]]),
    },
    channels: {
      cache: new Map([[
        'c1',
        { id: 'c1', name: 'general', type: 0, parentId: null },
      ]]),
    },
  };

  const BOT = {
    services: {
      lifecycle: {
        addShutdownTask: (): void => {
          return undefined;
        },
      },
      guild_store: STORE,
      cooldowns: new CooldownManager(),
    },
    guilds: { cache: new Map([[GUILD_ID, GUILD]]) },
    nano: {
      get: (name: string): { enabled: boolean } | undefined => {
        return name === MODULE_ID ? MODULE_STATE : undefined;
      },
      getModuleApi: (
        name: string
      ): Record<string, unknown> | undefined => {
        return name === MODULE_ID && MODULE_STATE.enabled
          ? PROVIDES
          : undefined;
      },
    },
    application: {
      owner: { id: options.app_owner_id ?? SESSION_USER },
    },
  } as unknown as Client;

  return {
    root: ROOT,
    database: OPENED.data,
    store: STORE,
    bot: BOT,
    module_state: MODULE_STATE,
    provides_calls: PROVIDES_CALLS,
    fetch_impl: discordFetch(),
    owner_id: options.app_owner_id ?? SESSION_USER,
  };
}

async function startHarness(harness: Harness): Promise<void> {
  const CONFIG = defaultConfig();

  CONFIG.modules = [`./mods/${MODULE_ID}`];
  CONFIG.web = { ...CONFIG.web, enabled: true, port: 0 };
  await startWebServer(harness.bot, {
    config: CONFIG,
    root: harness.root,
    env: { ...TEST_ENV, BOT_OWNER_ID: harness.owner_id },
    fetch_impl: harness.fetch_impl,
  });
}

function base(): string {
  return `http://127.0.0.1:${webServerPort()}`;
}

async function loginFlow(): Promise<{ cookie: string; csrf: string }> {
  const LOGIN = await fetch(`${base()}/auth/login`, {
    redirect: 'manual',
  });
  const STATE = new URL(LOGIN.headers.get('location') ?? '')
    .searchParams
    .get('state') ?? '';
  const CALLBACK = await fetch(
    `${base()}/auth/callback?code=abc&state=${STATE}`,
    {
      redirect: 'manual',
      headers: { cookie: `__Host-nano_oauth=${STATE}` },
    }
  );
  const SESSION = CALLBACK.headers.getSetCookie()
    .find((cookie: string): boolean => {
      return cookie.startsWith('__Host-nano_session=');
    })
    ?.split(';')[0]
    ?.slice('__Host-nano_session='.length) ?? '';
  const ME = await fetch(`${base()}/api/me`, {
    headers: { cookie: `__Host-nano_session=${SESSION}` },
  });
  const BODY = await ME.json() as { data: { csrf: string } };
  return {
    cookie: `__Host-nano_session=${SESSION}`,
    csrf: BODY.data.csrf,
  };
}

describe('web module surface', (): void => {
  let harness: Harness | null = null;

  afterEach(async (): Promise<void> => {
    await stopWebServer();
    harness?.database.close();
    harness = null;
  });

  it('lists modules with descriptor and availability', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GUILD_ID}/modules`,
      { headers: { cookie: COOKIE } }
    );

    expect(RESPONSE.status).toBe(200);

    const BODY = await RESPONSE.json() as {
      data: {
        modules: {
          name: string;
          has_descriptor: boolean;
          available: boolean;
          registered_config_version: number | null;
          descriptor_error?: string;
        }[];
      };
    };
    const ROW = BODY.data.modules.find(
      (row: { name: string }): boolean => {
        return row.name === MODULE_ID;
      }
    );

    expect(ROW?.has_descriptor).toBe(true);
    expect(ROW?.available).toBe(true);
    expect(ROW?.registered_config_version).toBe(CONFIG_VERSION);

    /* F1: the broken descriptor's error reaches the client with the
       checkout root scrubbed to '.'. */
    const BROKEN_ROW = BODY.data.modules.find(
      (row: { name: string }): boolean => {
        return row.name === 'broken';
      }
    );

    expect(BROKEN_ROW?.has_descriptor).toBe(false);
    expect(String(BROKEN_ROW?.descriptor_error))
      .toContain('./mods/broken');
    expect(String(BROKEN_ROW?.descriptor_error))
      .not.toContain(harness!.root);
  });

  it('serves the descriptor with the registered version', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}/descriptor`,
      { headers: { cookie: COOKIE } }
    );

    expect(RESPONSE.status).toBe(200);

    const BODY = await RESPONSE.json() as {
      data: {
        manifest: { title: string; config_version: number };
        available: boolean;
        registered_config_version: number;
      };
    };

    expect(BODY.data.manifest.title).toBe('Test Module');
    expect(BODY.data.available).toBe(true);
    expect(BODY.data.registered_config_version).toBe(CONFIG_VERSION);
  });

  it('reads defaults and writes DIFF-THEN-PATCH sparse rows (C2)',
    async (): Promise<void> => {
      harness = buildHarness();
      await startHarness(harness);

      const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
      const CONFIG_URL =
        `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}/config`;

      const GET = await fetch(CONFIG_URL, {
        headers: { cookie: COOKIE },
      });

      expect(GET.status).toBe(200);

      const GET_BODY = await GET.json() as {
        data: {
          config: { greeting: string; count: number };
          version: number;
        };
      };

      expect(GET_BODY.data.config.greeting).toBe('hi');
      expect(GET_BODY.data.version).toBe(CONFIG_VERSION);

      const PUT = await fetch(CONFIG_URL, {
        method: 'PUT',
        headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
        body: JSON.stringify({
          ...GET_BODY.data.config,
          greeting: 'hello there',
        }),
      });

      expect(PUT.status).toBe(200);

      const PUT_BODY = await PUT.json() as {
        data: { changed_keys: string[] };
      };

      expect(PUT_BODY.data.changed_keys).toEqual(['greeting']);

      /* Sparse posture: ONLY the changed key + the version stamp may
         hit storage — unchanged defaults never freeze into rows. */
      const ROWS = harness.database.guildConfigPersistence()
        .loadModuleConfig(GUILD_ID, MODULE_ID)
        .map((row: { key: string }): string => {
          return row.key;
        })
        .sort();

      expect(ROWS).toEqual(['__config_version', 'greeting']);

      /* A no-change PUT writes nothing. */
      const SAME = await fetch(CONFIG_URL, {
        method: 'PUT',
        headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
        body: JSON.stringify({
          ...GET_BODY.data.config,
          greeting: 'hello there',
        }),
      });
      const SAME_BODY = await SAME.json() as {
        data: { changed_keys: string[] };
      };

      expect(SAME_BODY.data.changed_keys).toEqual([]);
    });

  it('returns the issues[] envelope on schema violations (C4)',
    async (): Promise<void> => {
      harness = buildHarness();
      await startHarness(harness);

      const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
      const RESPONSE = await fetch(
        `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}/config`,
        {
          method: 'PUT',
          headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
          body: JSON.stringify({ greeting: 123, count: 0 }),
        }
      );

      expect(RESPONSE.status).toBe(400);

      const BODY = await RESPONSE.json() as {
        ok: boolean;
        issues: { path: string; message: string }[];
      };

      expect(BODY.ok).toBe(false);
      expect(
        BODY.issues.some((issue: { path: string }): boolean => {
          return issue.path === 'greeting';
        })
      ).toBe(true);
    });

  it('runs the module validateConfig hook after zod (B12)',
    async (): Promise<void> => {
      harness = buildHarness();
      await startHarness(harness);

      const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
      const RESPONSE = await fetch(
        `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}/config`,
        {
          method: 'PUT',
          headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
          body: JSON.stringify({
            greeting: 'hi',
            count: 0,
            danger_role: 'privileged',
          }),
        }
      );

      expect(RESPONSE.status).toBe(400);

      const BODY = await RESPONSE.json() as { error: string };

      expect(BODY.error).toContain('privileged role refused');
      expect(harness.provides_calls).toContain(
        `validateConfig:${GUILD_ID}`
      );
    });

  it('refuses a PUT without CSRF', async (): Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}/config`,
      {
        method: 'PUT',
        headers: { cookie: COOKIE },
        body: JSON.stringify({ greeting: 'x', count: 0 }),
      }
    );

    expect(RESPONSE.status).toBe(403);
  });

  it('refuses writes when the LIVE check fails (B11)',
    async (): Promise<void> => {
      harness = buildHarness({ live_owner_id: 'someone_else' });
      await startHarness(harness);

      /* The OAuth snapshot says owner, but the live guild disagrees
         and the member fetch fails — the demoted/kicked admin. */
      const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
      const RESPONSE = await fetch(
        `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}/config`,
        {
          method: 'PUT',
          headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
          body: JSON.stringify({ greeting: 'x', count: 0 }),
        }
      );

      expect(RESPONSE.status).toBe(403);

      const BODY = await RESPONSE.json() as { error: string };

      expect(BODY.error).toContain('Live admin check failed');
    });

  it('refuses the downgrade write (C1)', async (): Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    /* Simulate rows written by a NEWER module version. */
    harness.database.guildConfigPersistence().upsertKeys(
      GUILD_ID,
      MODULE_ID,
      [{ key: '__config_version', value: '3' }]
    );

    const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}/config`,
      {
        method: 'PUT',
        headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
        body: JSON.stringify({ greeting: 'newer', count: 0 }),
      }
    );

    expect(RESPONSE.status).toBe(409);

    const BODY = await RESPONSE.json() as { error: string };

    expect(BODY.error).toContain('exceeds the registered version');
  });

  it('returns the unavailable state for disabled modules (A5)',
    async (): Promise<void> => {
      harness = buildHarness();
      harness.module_state.enabled = false;
      await startHarness(harness);

      const { cookie: COOKIE } = await loginFlow();
      const RESPONSE = await fetch(
        `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}/config`,
        { headers: { cookie: COOKIE } }
      );

      expect(RESPONSE.status).toBe(409);

      const BODY = await RESPONSE.json() as { error: string };

      expect(BODY.error).toContain('unavailable');
      expect(BODY.error).toContain('disabled');
    });

  it('dispatches data views with guild_id injected first',
    async (): Promise<void> => {
      harness = buildHarness();
      await startHarness(harness);

      const { cookie: COOKIE } = await loginFlow();
      const THINGS = await fetch(
        `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}` +
        '/data/things',
        { headers: { cookie: COOKIE } }
      );

      expect(THINGS.status).toBe(200);

      const THINGS_BODY = await THINGS.json() as {
        ok: boolean;
        data: { things: string[] };
      };

      expect(THINGS_BODY.data.things).toEqual([GUILD_ID]);

      const LOOKUP = await fetch(
        `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}` +
        '/data/lookup?user_id=55',
        { headers: { cookie: COOKIE } }
      );
      const LOOKUP_BODY = await LOOKUP.json() as {
        data: { guild_id: string; user_id: string };
      };

      expect(LOOKUP_BODY.data.guild_id).toBe(GUILD_ID);
      expect(LOOKUP_BODY.data.user_id).toBe('55');

      const MISSING = await fetch(
        `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}` +
        '/data/nope',
        { headers: { cookie: COOKIE } }
      );

      expect(MISSING.status).toBe(404);
    });

  it('dispatches actions with CSRF + the ops gate', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
    const URL_WAVE =
      `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}` +
      '/actions/wave';

    const NO_CSRF = await fetch(URL_WAVE, {
      method: 'POST',
      headers: { cookie: COOKIE },
    });

    expect(NO_CSRF.status).toBe(403);

    const OK_CALL = await fetch(URL_WAVE, {
      method: 'POST',
      headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
      body: JSON.stringify({}),
    });

    expect(OK_CALL.status).toBe(200);
    expect(harness.provides_calls).toContain(`wave:${GUILD_ID}`);
  });

  it('reserves host-gated actions for the bot owner (B14)',
    async (): Promise<void> => {
      harness = buildHarness({ app_owner_id: 'someone_else' });
      await startHarness(harness);

      const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
      const RESPONSE = await fetch(
        `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}` +
        '/actions/nuke',
        {
          method: 'POST',
          headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
          body: JSON.stringify({}),
        }
      );

      expect(RESPONSE.status).toBe(403);
      expect(harness.provides_calls).not.toContain(`nuke:${GUILD_ID}`);
    });

  it('lets the bot owner run host-gated actions', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}` +
      '/actions/nuke',
      {
        method: 'POST',
        headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
        body: JSON.stringify({}),
      }
    );

    expect(RESPONSE.status).toBe(200);
    expect(harness.provides_calls).toContain(`nuke:${GUILD_ID}`);
  });

  it('blocks host-tier config keys for non-owners (C6)', async ():
  Promise<void> => {
    harness = buildHarness({ app_owner_id: 'someone_else' });
    await startHarness(harness);

    const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}/config`,
      {
        method: 'PUT',
        headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
        body: JSON.stringify({
          greeting: 'hi',
          count: 0,
          danger_role: '123456789012345678',
        }),
      }
    );

    expect(RESPONSE.status).toBe(403);

    const BODY = await RESPONSE.json() as { error: string };

    expect(BODY.error).toContain('danger_role');
    expect(BODY.error).toContain('bot owner');
  });

  it('lets the bot owner edit host-tier keys (C6)', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}/config`,
      {
        method: 'PUT',
        headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
        body: JSON.stringify({
          greeting: 'hi',
          count: 0,
          danger_role: '123456789012345678',
        }),
      }
    );

    expect(RESPONSE.status).toBe(200);

    const BODY = await RESPONSE.json() as {
      data: { changed_keys: string[] };
    };

    expect(BODY.data.changed_keys).toEqual(['danger_role']);
  });

  it('reports host_owner on /api/me', async (): Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE } = await loginFlow();
    const RESPONSE = await fetch(`${base()}/api/me`, {
      headers: { cookie: COOKIE },
    });
    const BODY = await RESPONSE.json() as {
      data: { host_owner: boolean };
    };

    expect(BODY.data.host_owner).toBe(true);
  });

  it('applies the core throttle floor to undeclared surfaces (F17)',
    async (): Promise<void> => {
      harness = buildHarness();
      await startHarness(harness);

      const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
      const URL_THINGS =
        `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}` +
        '/data/things';

      const FIRST = await fetch(URL_THINGS, {
        headers: { cookie: COOKIE },
      });
      expect(FIRST.status).toBe(200);

      const SECOND = await fetch(URL_THINGS, {
        headers: { cookie: COOKIE },
      });
      expect(SECOND.status).toBe(429);

      const URL_WAVE =
        `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}` +
        '/actions/wave';

      const ACT_FIRST = await fetch(URL_WAVE, {
        method: 'POST',
        headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
        body: JSON.stringify({}),
      });
      expect(ACT_FIRST.status).toBe(200);

      const ACT_SECOND = await fetch(URL_WAVE, {
        method: 'POST',
        headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
        body: JSON.stringify({}),
      });
      expect(ACT_SECOND.status).toBe(429);
    });

  it('withholds host-tier VALUES from non-owners on read', async ():
  Promise<void> => {
    const SECRET_ROLE = '200000000000000042';

    harness = buildHarness({ app_owner_id: 'someone_else' });
    await startHarness(harness);
    harness.store.setGuildModuleConfig(GUILD_ID, MODULE_ID, {
      greeting: 'hi',
      count: 1,
      danger_role: SECRET_ROLE,
    });

    const { cookie: COOKIE } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}` +
      '/config',
      { headers: { cookie: COOKIE } }
    );
    const BODY = await RESPONSE.json() as {
      data: { config: { danger_role: unknown; greeting: string } };
    };

    /* The key survives (the widget renders read-only), the VALUE
       is withheld - the read leak is closed. */
    expect(BODY.data.config.danger_role).toBeNull();
    expect(BODY.data.config.greeting).toBe('hi');
    expect(JSON.stringify(BODY)).not.toContain(SECRET_ROLE);
  });

  it('refuses reads for a guild the bot is not in (F9)', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GONE_GUILD_ID}/modules`,
      { headers: { cookie: COOKIE } }
    );

    expect(RESPONSE.status).toBe(404);

    const BODY = await RESPONSE.json() as { error: string };

    expect(BODY.error).toContain('not in this guild');
  });

  it('type-checks declared action param values (F24)', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
    const URL_ECHO =
      `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}` +
      '/actions/echo';
    const VALID_ID = '12345678901234567';

    const BAD_SNOWFLAKE = await fetch(URL_ECHO, {
      method: 'POST',
      headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
      body: JSON.stringify({ params: { target: 'abc', count: 5 } }),
    });
    expect(BAD_SNOWFLAKE.status).toBe(400);

    const BAD_NUMBER = await fetch(URL_ECHO, {
      method: 'POST',
      headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
      body: JSON.stringify({
        params: { target: VALID_ID, count: 99 },
      }),
    });
    expect(BAD_NUMBER.status).toBe(400);

    /* Refused requests must not consume the cooldown bucket — the
       valid retry below still dispatches. */
    const VALID = await fetch(URL_ECHO, {
      method: 'POST',
      headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
      body: JSON.stringify({
        params: { target: VALID_ID, count: 5, smuggled: true },
      }),
    });
    expect(VALID.status).toBe(200);

    const DISPATCHED = harness.provides_calls.find(
      (item: string): boolean => {
        return item.startsWith('echoBack:');
      }
    );
    const EXPECTED_PARAMS = JSON.stringify({
      target: VALID_ID,
      count: 5,
    });
    expect(DISPATCHED)
      .toBe(`echoBack:${GUILD_ID}:${EXPECTED_PARAMS}`);
  });

  it('caps member lookups: negative cache + window (F16)', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE } = await loginFlow();
    const UID_BASE = 90000000000000000n;
    const LOOKUP_WINDOW = 30;

    async function lookup(uid: string): Promise<number> {
      const RESPONSE = await fetch(
        `${base()}/api/guilds/${GUILD_ID}/members/${uid}`,
        { headers: { cookie: COOKIE } }
      );

      return RESPONSE.status;
    }

    const FIRST_UID = String(UID_BASE);

    expect(await lookup(FIRST_UID)).toBe(404);
    expect(await lookup(FIRST_UID)).toBe(404);

    /* The repeat answered from the negative cache — ONE fetch. */
    const FETCHES = (): number => {
      return harness!.provides_calls.filter(
        (item: string): boolean => {
          return item.startsWith('memberFetch:');
        }
      ).length;
    };

    expect(FETCHES()).toBe(1);

    /* Exhaust the per-guild window with distinct unknown ids. */
    for (let index = 1; index < LOOKUP_WINDOW; index += 1) {
      expect(await lookup(String(UID_BASE + BigInt(index)))).toBe(404);
    }

    const OVER = await lookup(String(UID_BASE + BigInt(LOOKUP_WINDOW)));

    expect(OVER).toBe(429);
    expect(FETCHES()).toBe(LOOKUP_WINDOW);
  });

  it('rejects an action whose body fails to parse (F14)', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}` +
      '/actions/wave',
      {
        method: 'POST',
        headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
        body: '{ not json',
      }
    );

    expect(RESPONSE.status).toBe(400);
    expect(harness.provides_calls).not.toContain(`wave:${GUILD_ID}`);
  });

  it('applies per-guild action cooldowns (B17)', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
    const URL_SLOW =
      `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}` +
      '/actions/slow';

    const FIRST = await fetch(URL_SLOW, {
      method: 'POST',
      headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
      body: JSON.stringify({}),
    });

    expect(FIRST.status).toBe(200);

    const SECOND = await fetch(URL_SLOW, {
      method: 'POST',
      headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
      body: JSON.stringify({}),
    });

    expect(SECOND.status).toBe(429);
  });

  it('serves reference picker fuel from the cache', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GUILD_ID}/reference`,
      { headers: { cookie: COOKIE } }
    );

    expect(RESPONSE.status).toBe(200);

    const BODY = await RESPONSE.json() as {
      data: {
        roles: { id: string; color: string }[];
        channels: { id: string; name: string }[];
      };
    };

    expect(BODY.data.roles[0]?.id).toBe('r1');
    expect(BODY.data.roles[0]?.color).toBe('#aabbcc');
    expect(BODY.data.channels[0]?.name).toBe('general');
  });

  it('serves read-only host instance info', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GUILD_ID}/instance`,
      { headers: { cookie: COOKIE } }
    );

    expect(RESPONSE.status).toBe(200);

    const BODY = await RESPONSE.json() as {
      data: {
        bot_name: string;
        version: string;
        database_driver: string;
        modules: { name: string }[];
      };
    };

    expect(BODY.data.version.length).toBeGreaterThan(0);
    expect(BODY.data.database_driver).toBe('sqlite');
    expect(
      BODY.data.modules.some((row: { name: string }): boolean => {
        return row.name === MODULE_ID;
      })
    ).toBe(true);
  });

  it('refuses guilds the session does not admin', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/999/modules`,
      { headers: { cookie: COOKIE } }
    );

    expect(RESPONSE.status).toBe(403);
  });

  it('scopes /instance host facts to the bot owner (F25)', async ():
  Promise<void> => {
    harness = buildHarness({ app_owner_id: 'owner-elsewhere' });
    await startHarness(harness);

    const { cookie: COOKIE } = await loginFlow();
    const RESPONSE = await fetch(
      `${base()}/api/guilds/${GUILD_ID}/instance`,
      { headers: { cookie: COOKIE } }
    );

    expect(RESPONSE.status).toBe(200);

    const BODY = await RESPONSE.json() as {
      data: Record<string, unknown>;
    };

    /* A plain guild admin keeps the public identity... */
    expect(BODY.data.bot_name).toBeDefined();
    expect(BODY.data.version).toBeDefined();
    expect(BODY.data.modules).toBeDefined();
    /* ...and never the process-global host facts. */
    expect(BODY.data.database_driver).toBeUndefined();
    expect(BODY.data.intents).toBeUndefined();
    expect(BODY.data.web).toBeUndefined();
  });

  it('throttles rapid config writes per guild (F31)', async ():
  Promise<void> => {
    harness = buildHarness();
    await startHarness(harness);

    const { cookie: COOKIE, csrf: CSRF } = await loginFlow();
    const CONFIG_URL =
      `${base()}/api/guilds/${GUILD_ID}/modules/${MODULE_ID}/config`;
    const FIRST = await fetch(CONFIG_URL, {
      method: 'PUT',
      headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
      body: JSON.stringify({
        greeting: 'one',
        count: 0,
        danger_role: '',
      }),
    });

    expect(FIRST.status).toBe(200);

    /* The second REAL write inside the window rides the same
       per-guild house bucket and refuses honestly. */
    const SECOND = await fetch(CONFIG_URL, {
      method: 'PUT',
      headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
      body: JSON.stringify({
        greeting: 'two',
        count: 0,
        danger_role: '',
      }),
    });

    expect(SECOND.status).toBe(429);
  });

  it('caches /stats and answers repeats without REST (F26)', async ():
  Promise<void> => {
    harness = buildHarness();

    /* getGuildSnapshot walks the real guild surface — enrich the
       fake guild and count the id-less REST fetches it costs. */
    const GUILD = harness.bot.guilds.cache
      .get(GUILD_ID) as unknown as Record<string, unknown>;
    let rest_fetches = 0;

    Object.assign(GUILD, {
      id: GUILD_ID,
      name: 'Alpha',
      description: null,
      memberCount: 7,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      verificationLevel: 1,
      explicitContentFilter: 0,
      mfaLevel: 0,
      rulesChannelId: null,
      publicUpdatesChannelId: null,
      systemChannelId: null,
      premiumSubscriptionCount: 2,
      features: [],
      channels: {
        fetch: (): Promise<Map<string, unknown>> => {
          rest_fetches += 1;
          return Promise.resolve(new Map([[
            'c1',
            {
              id: 'c1',
              name: 'general',
              type: 0,
              parentId: null,
              position: 0,
              permissionOverwrites: { cache: new Map() },
            },
          ]]));
        },
      },
      roles: {
        fetch: (): Promise<Map<string, unknown>> => {
          rest_fetches += 1;
          return Promise.resolve(new Map([[
            'r1',
            {
              id: 'r1',
              name: 'Role One',
              hexColor: '#aabbcc',
              position: 5,
              hoist: false,
              mentionable: false,
              managed: false,
              permissions: {
                toArray: (): string[] => {
                  return [];
                },
              },
            },
          ]]));
        },
      },
    });
    (harness.bot.guilds as unknown as Record<string, unknown>)
      .fetch = (): Promise<unknown> => {
        return Promise.resolve(GUILD);
      };
    await startHarness(harness);

    const { cookie: COOKIE } = await loginFlow();
    const STATS_URL = `${base()}/api/guilds/${GUILD_ID}/stats`;
    const FIRST = await fetch(STATS_URL, {
      headers: { cookie: COOKIE },
    });

    expect(FIRST.status).toBe(200);
    expect(rest_fetches).toBe(2);

    const FIRST_BODY = await FIRST.json() as { data: unknown };
    const SECOND = await fetch(STATS_URL, {
      headers: { cookie: COOKIE },
    });

    expect(SECOND.status).toBe(200);

    const SECOND_BODY = await SECOND.json() as { data: unknown };

    /* The repeat view answers from the short-TTL cache: same
       payload, not one more REST call. */
    expect(rest_fetches).toBe(2);
    expect(SECOND_BODY.data).toEqual(FIRST_BODY.data);
  });
});
