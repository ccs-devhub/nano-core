import { mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Client } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { NanoConfig } from '@/registry/nano-config.js';
import { defaultConfig } from '@/registry/nano-config.js';
import {
  resolveWebConfig,
  startWebServer,
  stopWebServer,
  webServerPort
} from '@/web/server.js';
import { resolveStaticFile } from '@/web/static-files.js';
import { webHealth, webStatus } from '@/web/status.js';

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

function webConfig(
  overrides: Partial<NanoConfig['web']> = {}
): NanoConfig {
  const CONFIG = defaultConfig();

  CONFIG.web = { ...CONFIG.web, enabled: true, port: 0, ...overrides };
  return CONFIG;
}

async function fetchLocal(path: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${webServerPort()}${path}`);
}

describe('web server', (): void => {
  afterEach(async (): Promise<void> => {
    await stopWebServer();
  });

  it('stays off when web.enabled is false', async (): Promise<void> => {
    const CONFIG = webConfig();

    CONFIG.web.enabled = false;
    await startWebServer(fakeBot(), { config: CONFIG, env: TEST_ENV });

    expect(webStatus().listening).toBe(false);
    expect(webStatus().detail).toBe('disabled by config');
    expect(webHealth().status).toBe('healthy');
  });

  it('boots degraded without the client secret and never listens',
    async (): Promise<void> => {
      await startWebServer(fakeBot(), {
        config: webConfig(),
        env: { CLIENT_ID: '1234567890' },
      });

      expect(webStatus().listening).toBe(false);
      expect(webStatus().detail).toContain('DISCORD_CLIENT_SECRET');
      expect(webHealth().status).toBe('degraded');
    });

  it('listens on an ephemeral port and serves the static shell',
    async (): Promise<void> => {
      await startWebServer(fakeBot(), {
        config: webConfig(),
        env: TEST_ENV,
      });

      expect(webStatus().listening).toBe(true);
      expect(webServerPort()).toBeGreaterThan(0);

      const RESPONSE = await fetchLocal('/');

      expect(RESPONSE.status).toBe(200);
      expect(RESPONSE.headers.get('content-type')).toContain('text/html');
      expect(await RESPONSE.text()).toContain('nano-core dashboard');
    });

  it('serves the SPA shell for client-side routes',
    async (): Promise<void> => {
      await startWebServer(fakeBot(), {
        config: webConfig(),
        env: TEST_ENV,
      });

      const RESPONSE = await fetchLocal('/app/guilds/123');

      expect(RESPONSE.status).toBe(200);
      expect(RESPONSE.headers.get('content-type')).toContain('text/html');
    });

  it('refuses path traversal (B15)', async (): Promise<void> => {
    await startWebServer(fakeBot(), {
      config: webConfig(),
      env: TEST_ENV,
    });

    const ENCODED = await fetchLocal('/app/..%2f..%2fpackage.json');

    expect(ENCODED.status).toBe(404);

    const PLAIN = await fetchLocal('/assets/../../package.json');

    expect(PLAIN.status).toBe(404);
  });

  it('returns the NanoResult envelope on unknown api paths',
    async (): Promise<void> => {
      await startWebServer(fakeBot(), {
        config: webConfig(),
        env: TEST_ENV,
      });

      const RESPONSE = await fetchLocal('/api/nope');

      expect(RESPONSE.status).toBe(404);

      const BODY = await RESPONSE.json() as { ok: boolean };

      expect(BODY.ok).toBe(false);
    });

  it('degrades on EADDRINUSE instead of throwing',
    async (): Promise<void> => {
      const BLOCKER: Server = createServer();
      const PORT = await new Promise<number>(
        (resolve: (port: number) => void): void => {
          BLOCKER.listen(0, '127.0.0.1', (): void => {
            const ADDRESS = BLOCKER.address();
            resolve(
              ADDRESS && typeof ADDRESS === 'object' ? ADDRESS.port : 0
            );
          });
        }
      );

      try {
        await startWebServer(fakeBot(), {
          config: webConfig({ port: PORT }),
          env: TEST_ENV,
        });

        expect(webStatus().listening).toBe(false);
        expect(webStatus().detail).toContain('already in use');
        expect(webHealth().status).toBe('degraded');
      } finally {
        await new Promise<void>((resolve: () => void): void => {
          BLOCKER.close((): void => {
            resolve();
          });
        });
      }
    });

  it('stops idempotently', async (): Promise<void> => {
    await stopWebServer();
    await stopWebServer();
  });
});

describe('resolveStaticFile', (): void => {
  it('rejects traversal and null bytes', (): void => {
    const ROOT = process.cwd();
    const ROOTS = [join(ROOT, 'src', 'web', 'static')];

    expect(resolveStaticFile('/../package.json', ROOTS)).toBeNull();
    expect(resolveStaticFile('/..%2fpackage.json', ROOTS)).toBeNull();
    expect(resolveStaticFile('/index.html%00.png', ROOTS)).toBeNull();
    expect(resolveStaticFile('/index.html', ROOTS)).not.toBeNull();
  });
});

describe('resolveWebConfig (the hot/frozen split, A4)', (): void => {
  it('reads the file when parseable and falls back when not',
    (): void => {
      const FROZEN = webConfig({ port: 4999 });

      const EMPTY_ROOT = mkdtempSync(join(tmpdir(), 'nano-web-'));
      const FRESH = resolveWebConfig(EMPTY_ROOT, FROZEN);

      expect(FRESH.enabled).toBe(false);

      const BROKEN_ROOT = mkdtempSync(join(tmpdir(), 'nano-web-'));

      writeFileSync(join(BROKEN_ROOT, 'nano.config.json'), '{ mid-edit');

      const FALLBACK = resolveWebConfig(BROKEN_ROOT, FROZEN);

      expect(FALLBACK.port).toBe(4999);
      expect(FALLBACK.enabled).toBe(true);
    });
});
