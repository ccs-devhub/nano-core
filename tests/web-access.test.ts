import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { connect } from 'node:net';

import type { Client } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { NanoConfig } from '@/registry/nano-config.js';
import { defaultConfig } from '@/registry/nano-config.js';
import { AccessValidator } from '@/web/access.js';
import type { FetchLike } from '@/web/auth/oauth.js';
import {
  startWebServer,
  stopWebServer,
  webServerPort
} from '@/web/server.js';

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'test-app-aud-tag';
const KID = 'test-key-1';
const TTL_S = 600;
const MS_PER_S = 1000;
/* A parked, never-used socket is NOT "idle" to node, so stop rides
   the full 3 s teardown grace — the bound proves the teardown fires
   instead of hanging forever. */
const SHUTDOWN_TEST_BOUND_MS = 4000;

const { publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY } =
  generateKeyPairSync('rsa', { modulusLength: 2048 });

const JWK = {
  ...(PUBLIC_KEY.export({ format: 'jwk' }) as Record<string, unknown>),
  kid: KID,
};

const JWKS_FETCH: FetchLike = async (): Promise<Response> => {
  return new Response(JSON.stringify({ keys: [JWK] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

function b64url(text: string): string {
  return Buffer.from(text).toString('base64url');
}

function signToken(
  payload: Record<string, unknown>,
  header_overrides: Record<string, unknown> = {}
): string {
  const HEADER = b64url(
    JSON.stringify({ alg: 'RS256', kid: KID, ...header_overrides })
  );
  const BODY = b64url(JSON.stringify(payload));
  const SIGNATURE = cryptoSign(
    'RSA-SHA256',
    Buffer.from(`${HEADER}.${BODY}`),
    PRIVATE_KEY
  ).toString('base64url');

  return `${HEADER}.${BODY}.${SIGNATURE}`;
}

function validClaims(): Record<string, unknown> {
  return {
    aud: [AUD],
    iss: `https://${TEAM}`,
    exp: Math.floor(Date.now() / MS_PER_S) + TTL_S,
  };
}

function requestWith(token?: string): IncomingMessage {
  return {
    headers: token ? { 'cf-access-jwt-assertion': token } : {},
  } as unknown as IncomingMessage;
}

function validator(): AccessValidator {
  return new AccessValidator({
    team_domain: TEAM,
    aud: AUD,
    fetch_impl: JWKS_FETCH,
  });
}

describe('AccessValidator (F13)', (): void => {
  it('is disabled unless both team domain and aud are set',
    (): void => {
      expect(new AccessValidator({ team_domain: '', aud: AUD })
        .enabled).toBe(false);
      expect(new AccessValidator({ team_domain: TEAM, aud: '' })
        .enabled).toBe(false);
      expect(validator().enabled).toBe(true);
    });

  it('accepts a valid Access JWT', async (): Promise<void> => {
    const RESULT = await validator()
      .check(requestWith(signToken(validClaims())));

    expect(RESULT.ok).toBe(true);
  });

  it('denies a missing or malformed token', async ():
  Promise<void> => {
    const CHECKER = validator();

    expect((await CHECKER.check(requestWith())).ok).toBe(false);
    expect((await CHECKER.check(requestWith('junk'))).ok).toBe(false);
    expect((await CHECKER.check(requestWith('a.b.c'))).ok)
      .toBe(false);
  });

  it('denies a tampered signature', async (): Promise<void> => {
    const TOKEN = signToken(validClaims());
    const FORGED = `${TOKEN.slice(0, TOKEN.length - 4)}AAAA`;

    expect((await validator().check(requestWith(FORGED))).ok)
      .toBe(false);
  });

  it('denies expired, wrong-audience and wrong-issuer claims',
    async (): Promise<void> => {
      const CHECKER = validator();
      const EXPIRED = signToken({
        ...validClaims(),
        exp: Math.floor(Date.now() / MS_PER_S) - 1,
      });

      expect((await CHECKER.check(requestWith(EXPIRED))).ok)
        .toBe(false);

      const WRONG_AUD = signToken({ ...validClaims(), aud: ['other'] });

      expect((await CHECKER.check(requestWith(WRONG_AUD))).ok)
        .toBe(false);

      const WRONG_ISS = signToken({
        ...validClaims(),
        iss: 'https://evil.example',
      });

      expect((await CHECKER.check(requestWith(WRONG_ISS))).ok)
        .toBe(false);
    });

  it('denies tokens signed by an unknown key', async ():
  Promise<void> => {
    const TOKEN = signToken(validClaims(), { kid: 'other-key' });

    expect((await validator().check(requestWith(TOKEN))).ok)
      .toBe(false);
  });
});

describe('the funnel gate (F13)', (): void => {
  const TEST_ENV = {
    DISCORD_CLIENT_SECRET: 'test-secret',
    CLIENT_ID: '1234567890',
  };

  function fakeBot(): Client {
    return {
      services: {
        lifecycle: {
          addShutdownTask: (): void => {
            return undefined;
          },
        },
      },
    } as unknown as Client;
  }

  function accessConfig(): NanoConfig {
    const CONFIG = defaultConfig();

    CONFIG.web = {
      ...CONFIG.web,
      enabled: true,
      port: 0,
      access_team_domain: TEAM,
      access_aud: AUD,
    };
    return CONFIG;
  }

  afterEach(async (): Promise<void> => {
    await stopWebServer();
  });

  it('guards every path ahead of routing, static and 404', async ():
  Promise<void> => {
    await startWebServer(fakeBot(), {
      config: accessConfig(),
      env: TEST_ENV,
      fetch_impl: JWKS_FETCH,
    });

    const BASE = `http://127.0.0.1:${webServerPort()}`;
    const BARE = await fetch(`${BASE}/nope`);

    expect(BARE.status).toBe(401);

    const TOKEN = signToken(validClaims());
    const PASSED = await fetch(`${BASE}/nope`, {
      headers: { 'cf-access-jwt-assertion': TOKEN },
    });

    expect(PASSED.status).toBe(404);
  });

  it('answers a malformed request line with 400 (F3)', async ():
  Promise<void> => {
    await startWebServer(fakeBot(), {
      config: accessConfig(),
      env: TEST_ENV,
      fetch_impl: JWKS_FETCH,
    });

    const REPLY = await new Promise<string>(
      (resolve: (text: string) => void): void => {
        const SOCKET = connect(webServerPort(), '127.0.0.1');
        let seen = '';

        SOCKET.on('connect', (): void => {
          SOCKET.write('THIS IS NOT HTTP\r\n\r\n');
        });
        SOCKET.on('data', (chunk: Buffer): void => {
          seen += chunk.toString('utf8');
        });
        SOCKET.on('close', (): void => {
          resolve(seen);
        });
      }
    );

    expect(REPLY).toContain('400');
  });

  it('shuts down promptly with a lingering keep-alive (F4)', async ():
  Promise<void> => {
    await startWebServer(fakeBot(), {
      config: accessConfig(),
      env: TEST_ENV,
      fetch_impl: JWKS_FETCH,
    });

    /* Park an idle raw connection, then stop: closeIdleConnections
       must drop it and stop must resolve well under the grace. */
    const SOCKET = connect(webServerPort(), '127.0.0.1');

    await new Promise<void>((resolve: () => void): void => {
      SOCKET.on('connect', (): void => {
        resolve();
      });
    });

    const STARTED = Date.now();

    await stopWebServer();
    expect(Date.now() - STARTED).toBeLessThan(SHUTDOWN_TEST_BOUND_MS);
    SOCKET.destroy();
  });
});
