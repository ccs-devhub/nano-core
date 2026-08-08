import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Client } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { NanoConfig } from '@/registry/nano-config.js';
import { defaultConfig } from '@/registry/nano-config.js';
import type { FetchLike, OauthGuild } from '@/web/auth/oauth.js';
import { exchangeCode } from '@/web/auth/oauth.js';
import {
  adminBitsFor,
  isSnapshotAdmin,
  requireLiveGuildAdmin
} from '@/web/auth/permissions.js';
import {
  NonceStore,
  RateLimiter,
  SessionStore
} from '@/web/auth/sessions.js';
import {
  startWebServer,
  stopWebServer,
  webServerPort
} from '@/web/server.js';

const MANAGE_GUILD_BITS = String(1 << 5);

interface GuildView {
  id: string;
  state: string;
  invite_url?: string;
}
const TEST_ENV = {
  DISCORD_CLIENT_SECRET: 'test-secret',
  CLIENT_ID: '1234567890',
};

const GUILD_LIST: OauthGuild[] = [
  {
    id: '100',
    name: 'Alpha',
    icon: null,
    owner: true,
    permissions: '0',
  },
  {
    id: '200',
    name: 'Beta',
    icon: null,
    owner: false,
    permissions: MANAGE_GUILD_BITS,
  },
  {
    id: '300',
    name: 'Gamma',
    icon: null,
    owner: false,
    permissions: '0',
  },
];

interface DiscordStub {
  fetch_impl: FetchLike;
  calls: Record<string, number>;
  /** Force /users/@me/guilds to answer with this status. */
  guilds_status: number;
  guilds_delay_ms: number;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function discordStub(): DiscordStub {
  const STATE = {
    calls: {} as Record<string, number>,
    guilds_status: 200,
    guilds_delay_ms: 0,
  };
  const FETCH = async (input: string): Promise<Response> => {
    const COUNT = (key: string): void => {
      STATE.calls[key] = (STATE.calls[key] ?? 0) + 1;
    };

    if (input.includes('/oauth2/token/revoke')) {
      COUNT('revoke');
      return jsonResponse(200, {});
    }

    if (input.includes('/oauth2/token')) {
      COUNT('token');
      return jsonResponse(200, {
        access_token: 'at-1',
        token_type: 'Bearer',
        expires_in: 604800,
        refresh_token: 'rt-must-be-discarded',
      });
    }

    if (input.includes('/users/@me/guilds')) {
      COUNT('guilds');

      if (STATE.guilds_delay_ms > 0) {
        await new Promise((resolve: (value: null) => void): void => {
          setTimeout((): void => {
            resolve(null);
          }, STATE.guilds_delay_ms);
        });
      }

      if (STATE.guilds_status === 429) {
        return jsonResponse(429, { retry_after: 30 });
      }

      if (STATE.guilds_status !== 200) {
        return jsonResponse(STATE.guilds_status, {});
      }
      return jsonResponse(200, GUILD_LIST);
    }

    if (input.includes('/users/@me')) {
      COUNT('me');
      return jsonResponse(200, {
        id: 'u1',
        username: 'kyo',
        global_name: 'Kyo',
        avatar: null,
      });
    }
    return jsonResponse(404, {});
  };
  const STUB: DiscordStub = Object.assign(STATE, { fetch_impl: FETCH });
  return STUB;
}

function fakeBot(present_guild_ids: string[]): Client {
  const CACHE = new Map<string, { id: string }>();

  for (const _id of present_guild_ids) {
    CACHE.set(_id, { id: _id });
  }
  return {
    services: {
      lifecycle: {
        addShutdownTask: (): void => {
          return undefined;
        },
      },
    },
    guilds: { cache: CACHE },
  } as unknown as Client;
}

interface WebSetup {
  config: NanoConfig;
  root: string;
}

/**
 * The hot-config split reads nano.config.json from the server root on
 * every request, so each test gets a temp root whose file matches its
 * frozen config.
 */
function webSetup(
  overrides: Partial<NanoConfig['web']> = {}
): WebSetup {
  const CONFIG = defaultConfig();

  CONFIG.web = { ...CONFIG.web, enabled: true, port: 0, ...overrides };

  const ROOT = mkdtempSync(join(tmpdir(), 'nano-auth-'));

  writeFileSync(
    join(ROOT, 'nano.config.json'),
    JSON.stringify(CONFIG)
  );
  return { config: CONFIG, root: ROOT };
}

function base(): string {
  return `http://127.0.0.1:${webServerPort()}`;
}

function setCookieValue(response: Response, name: string): string | null {
  for (const _cookie of response.headers.getSetCookie()) {
    if (_cookie.startsWith(`${name}=`)) {
      return _cookie.split(';')[0].slice(name.length + 1);
    }
  }
  return null;
}

async function loginFlow(): Promise<{
  cookie: string;
  csrf: string;
}> {
  const LOGIN = await fetch(`${base()}/auth/login`, {
    redirect: 'manual',
  });

  expect(LOGIN.status).toBe(302);

  const LOCATION = LOGIN.headers.get('location') ?? '';
  const STATE = new URL(LOCATION).searchParams.get('state') ?? '';

  expect(LOCATION).toContain('discord.com/oauth2/authorize');
  expect(STATE.length).toBeGreaterThan(0);

  const CALLBACK = await fetch(
    `${base()}/auth/callback?code=abc&state=${STATE}`,
    {
      redirect: 'manual',
      headers: { cookie: `__Host-nano_oauth=${STATE}` },
    }
  );

  expect(CALLBACK.status).toBe(302);
  expect(CALLBACK.headers.get('location')).toBe('/app/');

  const SESSION = setCookieValue(CALLBACK, '__Host-nano_session') ?? '';

  expect(SESSION.length).toBeGreaterThan(0);

  const ME = await fetch(`${base()}/api/me`, {
    headers: { cookie: `__Host-nano_session=${SESSION}` },
  });

  expect(ME.status).toBe(200);

  const ME_BODY = await ME.json() as {
    ok: boolean;
    data: { user: { id: string }; csrf: string };
  };

  expect(ME_BODY.data.user.id).toBe('u1');
  return { cookie: `__Host-nano_session=${SESSION}`, csrf: ME_BODY.data.csrf };
}

describe('web auth flow', (): void => {
  afterEach(async (): Promise<void> => {
    await stopWebServer();
  });

  it('logs in end to end and hardens the cookies', async ():
  Promise<void> => {
    const STUB = discordStub();

    const SETUP = webSetup();

    await startWebServer(fakeBot(['100']), {
      config: SETUP.config,
      root: SETUP.root,
      env: TEST_ENV,
      fetch_impl: STUB.fetch_impl,
    });

    const LOGIN = await fetch(`${base()}/auth/login`, {
      redirect: 'manual',
    });
    const OAUTH_COOKIE = LOGIN.headers.getSetCookie()
      .find((cookie: string): boolean => {
        return cookie.startsWith('__Host-nano_oauth=');
      }) ?? '';

    expect(OAUTH_COOKIE).toContain('HttpOnly');
    expect(OAUTH_COOKIE).toContain('SameSite=Lax');
    /* F29: Secure is structural — present even on this http test
       host, because the __Host- prefix demands it everywhere. */
    expect(OAUTH_COOKIE).toContain('Secure');

    const { cookie: COOKIE } = await loginFlow();

    expect(COOKIE).toContain('__Host-nano_session=');
    expect(STUB.calls.token).toBeGreaterThanOrEqual(1);
  });

  it('classifies guilds three ways with the pinned invite bits',
    async (): Promise<void> => {
      const STUB = discordStub();

      const SETUP = webSetup();

      await startWebServer(fakeBot(['100']), {
        config: SETUP.config,
        root: SETUP.root,
        env: TEST_ENV,
        fetch_impl: STUB.fetch_impl,
      });

      const { cookie: COOKIE } = await loginFlow();
      const RESPONSE = await fetch(`${base()}/api/guilds`, {
        headers: { cookie: COOKIE },
      });
      const BODY = await RESPONSE.json() as {
        ok: boolean;
        data: { guilds: GuildView[] };
      };
      const BY_ID = new Map(
        BODY.data.guilds.map((guild: GuildView): [string, GuildView] => {
          return [guild.id, guild];
        })
      );

      expect(BY_ID.get('100')?.state).toBe('configurable');
      expect(BY_ID.get('200')?.state).toBe('invitable');
      expect(BY_ID.get('200')?.invite_url).toContain(
        'permissions=268528704'
      );
      expect(BY_ID.get('200')?.invite_url).toContain('guild_id=200');
      expect(BY_ID.has('300')).toBe(false);
    });

  it('refuses a reused, unknown, or cookie-mismatched state',
    async (): Promise<void> => {
      const STUB = discordStub();

      const SETUP = webSetup();

      await startWebServer(fakeBot(['100']), {
        config: SETUP.config,
        root: SETUP.root,
        env: TEST_ENV,
        fetch_impl: STUB.fetch_impl,
      });

      const LOGIN = await fetch(`${base()}/auth/login`, {
        redirect: 'manual',
      });
      const STATE = new URL(LOGIN.headers.get('location') ?? '')
        .searchParams
        .get('state') ?? '';

      /* Cookie mismatch first (state stays unconsumed? no — consume
         happens before the cookie check, so mint a fresh state per
         case). */
      const MISMATCH = await fetch(
        `${base()}/auth/callback?code=abc&state=${STATE}`,
        {
          redirect: 'manual',
          headers: { cookie: '__Host-nano_oauth=wrong-value' },
        }
      );

      expect(MISMATCH.status).toBe(400);

      /* The state was consumed by the mismatch attempt: reuse fails. */
      const REUSED = await fetch(
        `${base()}/auth/callback?code=abc&state=${STATE}`,
        {
          redirect: 'manual',
          headers: { cookie: `__Host-nano_oauth=${STATE}` },
        }
      );

      expect(REUSED.status).toBe(400);

      const UNKNOWN = await fetch(
        `${base()}/auth/callback?code=abc&state=never-minted`,
        {
          redirect: 'manual',
          headers: { cookie: '__Host-nano_oauth=never-minted' },
        }
      );

      expect(UNKNOWN.status).toBe(400);
    });

  it('guards logout with CSRF, revokes the token, kills the session',
    async (): Promise<void> => {
      const STUB = discordStub();

      const SETUP = webSetup();

      await startWebServer(fakeBot(['100']), {
        config: SETUP.config,
        root: SETUP.root,
        env: TEST_ENV,
        fetch_impl: STUB.fetch_impl,
      });

      const { cookie: COOKIE, csrf: CSRF } = await loginFlow();

      const NO_HEADER = await fetch(`${base()}/auth/logout`, {
        method: 'POST',
        headers: { cookie: COOKIE },
      });

      expect(NO_HEADER.status).toBe(403);

      const WRONG = await fetch(`${base()}/auth/logout`, {
        method: 'POST',
        headers: { cookie: COOKIE, 'x-nano-csrf': 'not-the-token' },
      });

      expect(WRONG.status).toBe(403);

      const RIGHT = await fetch(`${base()}/auth/logout`, {
        method: 'POST',
        headers: { cookie: COOKIE, 'x-nano-csrf': CSRF },
      });

      expect(RIGHT.status).toBe(200);
      expect(STUB.calls.revoke).toBe(1);

      const AFTER = await fetch(`${base()}/api/me`, {
        headers: { cookie: COOKIE },
      });

      expect(AFTER.status).toBe(401);
    });

  it('rate limits the pre-auth endpoints', async (): Promise<void> => {
    const STUB = discordStub();

    const SETUP = webSetup();

    await startWebServer(fakeBot(['100']), {
      config: SETUP.config,
      root: SETUP.root,
      env: TEST_ENV,
      fetch_impl: STUB.fetch_impl,
      auth: { login_max_per_window: 3 },
    });

    let last_status = 0;

    for (let i = 0; i < 4; i += 1) {
      const RESPONSE = await fetch(`${base()}/auth/login`, {
        redirect: 'manual',
      });
      last_status = RESPONSE.status;
    }

    expect(last_status).toBe(429);
  });

  it('destroys the session when the guild refresh gets a 401 (B3)',
    async (): Promise<void> => {
      const STUB = discordStub();

      const SETUP = webSetup({ guild_refresh_s: 0 });

      await startWebServer(fakeBot(['100']), {
        config: SETUP.config,
        root: SETUP.root,
        env: TEST_ENV,
        fetch_impl: STUB.fetch_impl,
      });

      const { cookie: COOKIE } = await loginFlow();

      STUB.guilds_status = 401;

      const RESPONSE = await fetch(`${base()}/api/guilds`, {
        headers: { cookie: COOKIE },
      });

      expect(RESPONSE.status).toBe(401);

      const ME = await fetch(`${base()}/api/me`, {
        headers: { cookie: COOKIE },
      });

      expect(ME.status).toBe(401);
    });

  it('honors retry_after and serves the stale snapshot on 429 (B4)',
    async (): Promise<void> => {
      const STUB = discordStub();

      const SETUP = webSetup({ guild_refresh_s: 0 });

      await startWebServer(fakeBot(['100']), {
        config: SETUP.config,
        root: SETUP.root,
        env: TEST_ENV,
        fetch_impl: STUB.fetch_impl,
      });

      const { cookie: COOKIE } = await loginFlow();
      const BASELINE = STUB.calls.guilds ?? 0;

      STUB.guilds_status = 429;

      const FIRST = await fetch(`${base()}/api/guilds`, {
        headers: { cookie: COOKIE },
      });

      expect(FIRST.status).toBe(200);
      expect(STUB.calls.guilds).toBe(BASELINE + 1);

      /* retry_after stamped: the next request must NOT re-fetch. */
      const SECOND = await fetch(`${base()}/api/guilds`, {
        headers: { cookie: COOKIE },
      });

      expect(SECOND.status).toBe(200);
      expect(STUB.calls.guilds).toBe(BASELINE + 1);
    });

  it('single-flights concurrent guild refreshes (B4)',
    async (): Promise<void> => {
      const STUB = discordStub();

      const SETUP = webSetup({ guild_refresh_s: 0 });

      await startWebServer(fakeBot(['100']), {
        config: SETUP.config,
        root: SETUP.root,
        env: TEST_ENV,
        fetch_impl: STUB.fetch_impl,
      });

      const { cookie: COOKIE } = await loginFlow();
      const BASELINE = STUB.calls.guilds ?? 0;

      STUB.guilds_delay_ms = 50;

      const [FIRST, SECOND] = await Promise.all([
        fetch(`${base()}/api/guilds`, { headers: { cookie: COOKIE } }),
        fetch(`${base()}/api/guilds`, { headers: { cookie: COOKIE } }),
      ]);

      expect(FIRST.status).toBe(200);
      expect(SECOND.status).toBe(200);
      expect(STUB.calls.guilds).toBe(BASELINE + 1);
    });
});

describe('session and nonce stores', (): void => {
  const USER = {
    id: 'u1',
    username: 'kyo',
    global_name: null,
    avatar: null,
  };

  it('expires sessions by TTL', (): void => {
    const STORE = new SessionStore({ ttl_ms: -1 });
    const SESSION = STORE.create(USER, 'at', []);

    expect(STORE.get(SESSION.id)).toBeNull();
    STORE.stop();
  });

  it('caps sessions per user (B7)', (): void => {
    const STORE = new SessionStore({ ttl_ms: 60000, max_per_user: 3 });

    for (let i = 0; i < 5; i += 1) {
      STORE.create(USER, `at-${i}`, []);
    }

    expect(STORE.size()).toBe(3);
    STORE.stop();
  });

  it('mints single-use nonces (B1)', (): void => {
    const STORE = new NonceStore();
    const STATE = STORE.mint('/app/x');

    expect(STORE.consume(STATE)?.destination).toBe('/app/x');
    expect(STORE.consume(STATE)).toBeNull();
  });

  it('rate limits within a window (B1)', (): void => {
    const LIMITER = new RateLimiter({
      max_per_window: 2,
      window_ms: 60000,
    });

    expect(LIMITER.allow('ip')).toBe(true);
    expect(LIMITER.allow('ip')).toBe(true);
    expect(LIMITER.allow('ip')).toBe(false);
    expect(LIMITER.allow('other')).toBe(true);
  });
});

describe('permissions', (): void => {
  it('resolves admin bits and checks the snapshot', (): void => {
    const BITS = adminBitsFor(['Administrator', 'ManageGuild']);

    expect(isSnapshotAdmin(
      {
        id: '1',
        name: 'x',
        icon: null,
        owner: false,
        permissions: MANAGE_GUILD_BITS,
      },
      BITS
    )).toBe(true);
    expect(isSnapshotAdmin(
      { id: '1', name: 'x', icon: null, owner: false, permissions: '0' },
      BITS
    )).toBe(false);
    expect(isSnapshotAdmin(
      { id: '1', name: 'x', icon: null, owner: true, permissions: '0' },
      BITS
    )).toBe(true);
  });

  it('runs the live bot-side admin check (B11)',
    async (): Promise<void> => {
      const MEMBERS: Record<
        string,
        { permissions: { has: (bit: bigint) => boolean } }
      > = {
        admin_user: {
          permissions: {
            has: (): boolean => {
              return true;
            },
          },
        },
        plain_user: {
          permissions: {
            has: (): boolean => {
              return false;
            },
          },
        },
      };
      const BOT = {
        guilds: {
          cache: new Map([[
            'g1',
            {
              ownerId: 'owner_user',
              members: {
                fetch: (id: string): Promise<unknown> => {
                  if (MEMBERS[id]) {
                    return Promise.resolve(MEMBERS[id]);
                  }
                  return Promise.reject(new Error('Unknown member'));
                },
              },
            },
          ]]),
        },
      } as unknown as Client;
      const NAMES = ['Administrator', 'ManageGuild'];

      const OWNER = await requireLiveGuildAdmin(
        BOT, 'g1', 'owner_user', NAMES
      );

      expect(OWNER.ok).toBe(true);

      const ADMIN = await requireLiveGuildAdmin(
        BOT, 'g1', 'admin_user', NAMES
      );

      expect(ADMIN.ok).toBe(true);

      const PLAIN = await requireLiveGuildAdmin(
        BOT, 'g1', 'plain_user', NAMES
      );

      expect(PLAIN.ok).toBe(false);

      const GONE = await requireLiveGuildAdmin(
        BOT, 'g1', 'kicked_user', NAMES
      );

      expect(GONE.ok).toBe(false);

      const NO_GUILD = await requireLiveGuildAdmin(
        BOT, 'g9', 'owner_user', NAMES
      );

      expect(NO_GUILD.ok).toBe(false);
    });
});

describe('upstream body scrubbing (F1)', (): void => {
  it('never reflects a Discord error body to the caller', async ():
  Promise<void> => {
    const SECRET_BODY = '{"secret_detail":"internal-discord-info"}';
    const STUB: FetchLike = async (): Promise<Response> => {
      return new Response(SECRET_BODY, { status: 400 });
    };
    const RESULT = await exchangeCode({
      client_id: 'cid',
      client_secret: 'sec',
      code: 'code',
      redirect_uri: 'http://127.0.0.1/auth/callback',
      fetch_impl: STUB,
    });

    expect(RESULT.ok).toBe(false);
    if (!RESULT.ok) {
      expect(RESULT.error).not.toContain('secret_detail');
      expect(RESULT.error).toBe('HTTP 400');
    }
  });
});
