import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { loadConfig, saveConfig } from '@/registry/nano-config.js';
import {
  EXTERNAL_RISK_WARNING,
  installExternal,
  installFromStore,
  listOutdated
} from '@/store/installer.js';
import type { StoreModule, StoreRegistry } from '@/store/store-client.js';
import { checkMinCore, StoreClient } from '@/store/store-client.js';

const REGISTRY: StoreRegistry = {
  store_version: 1,
  modules: [
    {
      name: 'embed-styler',
      description: 'Themed embeds.',
      author: 'kyonax',
      source: 'npm',
      package: '@ccs-devhub/nano-module-embed-styler',
      version: '1.2.0',
      min_core: '0.1.0',
      validated_at: '2026-07-01',
    },
    {
      name: 'welcome-cards',
      description: 'Welcome images.',
      author: 'somedev',
      source: 'github',
      repo: 'somedev/nano-welcome-cards',
      version: '0.3.1',
      commit: 'aaaaaaa',
      min_core: '0.1.0',
      validated_at: '2026-06-02',
    },
    {
      name: 'future-module',
      description: 'Needs a newer core.',
      author: 'somedev',
      source: 'npm',
      package: 'nano-future',
      version: '1.0.0',
      min_core: '99.0.0',
      validated_at: '2026-06-02',
    },
  ],
};

function fetchOk(): typeof fetch {
  return vi.fn(async (): Promise<Response> => {
    return new Response(JSON.stringify(REGISTRY));
  }) as unknown as typeof fetch;
}

function fetchFail(): typeof fetch {
  return vi.fn(async (): Promise<Response> => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
}

function createClient(
  root: string,
  fetch_fn: typeof fetch
): StoreClient {
  return new StoreClient({
    registry_url: 'https://example.test/registry.json',
    root,
    fetch_fn,
  });
}

describe('StoreClient', (): void => {
  it('fetches, caches, and serves from cache within the TTL', async ():
  Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-store-'));
    const FETCH = fetchOk();
    const CLIENT = createClient(ROOT, FETCH);

    const FIRST = await CLIENT.getRegistry();
    const SECOND = await CLIENT.getRegistry();

    expect(FIRST.ok).toBe(true);
    expect(SECOND.ok).toBe(true);
    expect(FETCH).toHaveBeenCalledTimes(1);
  });

  it('serves the stale cache when the network fails', async ():
  Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-store-'));
    await createClient(ROOT, fetchOk()).getRegistry();

    const OFFLINE = createClient(ROOT, fetchFail());
    const RESULT = await OFFLINE.getRegistry(true);

    expect(RESULT.ok).toBe(true);

    if (RESULT.ok) {
      expect(RESULT.data.modules).toHaveLength(3);
    }
  });

  it('resolves exact names and suggests near misses', async ():
  Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-store-'));
    const CLIENT = createClient(ROOT, fetchOk());

    expect((await CLIENT.resolve('embed-styler')).ok).toBe(true);

    const MISS = await CLIENT.resolve('embed');

    expect(MISS.ok).toBe(false);

    if (!MISS.ok) {
      expect(MISS.error).toContain('embed-styler');
    }
  });

  it('searches names, descriptions, and tags', async (): Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-store-'));
    const CLIENT = createClient(ROOT, fetchOk());

    const RESULT = await CLIENT.search('welcome');

    expect(RESULT.ok).toBe(true);

    if (RESULT.ok) {
      expect(RESULT.data.map((m: StoreModule): string => {
        return m.name;
      })).toEqual(['welcome-cards']);
    }
  });
});

describe('checkMinCore', (): void => {
  it('compares dotted versions', (): void => {
    expect(checkMinCore('0.1.0', '0.2.0')).toBe(true);
    expect(checkMinCore('0.2.0', '0.2.0')).toBe(true);
    expect(checkMinCore('0.3.0', '0.2.0')).toBe(false);
    expect(checkMinCore(undefined, '0.2.0')).toBe(true);
  });
});

describe('installer', (): void => {
  it('installs npm store modules pinned to the validated version',
    async (): Promise<void> => {
      const ROOT = mkdtempSync(join(tmpdir(), 'nano-store-'));
      const CLIENT = createClient(ROOT, fetchOk());
      const COMMANDS: string[] = [];
      const RESULT = await installFromStore(CLIENT, 'embed-styler', {
        root: ROOT,
        now: (): string => {
          return '2026-07-15T00:00:00.000Z';
        },
        exec: (command: string): string => {
          COMMANDS.push(command);
          return '';
        },
      });

      expect(RESULT.ok).toBe(true);
      expect(COMMANDS).toEqual([
        'npm install @ccs-devhub/nano-module-embed-styler@1.2.0',
      ]);

      const CONFIG = loadConfig(ROOT);

      expect(CONFIG.modules).toEqual([{
        name: 'embed-styler',
        source: 'store',
        spec: '@ccs-devhub/nano-module-embed-styler',
        version: '1.2.0',
        installed_at: '2026-07-15T00:00:00.000Z',
        trusted: true,
      }]);
    });

  it('clones github store modules into staging and verifies the pin',
    async (): Promise<void> => {
      const ROOT = mkdtempSync(join(tmpdir(), 'nano-store-'));
      const CLIENT = createClient(ROOT, fetchOk());
      const COMMANDS: string[] = [];
      const RESULT = await installFromStore(CLIENT, 'welcome-cards', {
        root: ROOT,
        exec: (command: string): string => {
          COMMANDS.push(command);
          return command.includes('rev-parse') ? 'aaaaaaa1234\n' : '';
        },
      });

      expect(RESULT.ok).toBe(true);
      expect(COMMANDS[0]).toContain(
        'git clone --depth 1 --branch v0.3.1'
      );
      expect(COMMANDS[0]).toContain('modules/.staging-welcome-cards');
      expect(COMMANDS[1]).toContain('rev-parse HEAD');
      expect(COMMANDS[2]).toBe(
        'mv modules/.staging-welcome-cards modules/welcome-cards'
      );

      if (RESULT.ok) {
        expect(RESULT.data.spec).toBe('./modules/welcome-cards');
      }
    });

  it('refuses to overwrite a local module the store does not manage',
    async (): Promise<void> => {
      const ROOT = mkdtempSync(join(tmpdir(), 'nano-store-'));
      mkdirSync(join(ROOT, 'modules', 'welcome-cards'), {
        recursive: true,
      });
      const CLIENT = createClient(ROOT, fetchOk());
      const COMMANDS: string[] = [];
      const RESULT = await installFromStore(CLIENT, 'welcome-cards', {
        root: ROOT,
        exec: (command: string): string => {
          COMMANDS.push(command);
          return '';
        },
      });

      expect(RESULT.ok).toBe(false);

      if (!RESULT.ok) {
        expect(RESULT.error).toContain('not a store-managed');
      }

      /* Nothing destructive ran: the local dir was never touched. */
      expect(COMMANDS).toEqual([]);
    });

  it('aborts github installs on commit mismatch', async ():
  Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-store-'));
    const CLIENT = createClient(ROOT, fetchOk());
    const RESULT = await installFromStore(CLIENT, 'welcome-cards', {
      root: ROOT,
      exec: (command: string): string => {
        return command.includes('rev-parse') ? 'bbbbbbb999\n' : '';
      },
    });

    expect(RESULT.ok).toBe(false);

    if (!RESULT.ok) {
      expect(RESULT.error).toContain('Commit mismatch');
    }
  });

  it('gates modules that need a newer core', async (): Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-store-'));
    const CLIENT = createClient(ROOT, fetchOk());
    const RESULT = await installFromStore(CLIENT, 'future-module', {
      root: ROOT,
      exec: (): string => {
        return '';
      },
    });

    expect(RESULT.ok).toBe(false);

    if (!RESULT.ok) {
      expect(RESULT.error).toContain('needs nano-core');
    }
  });

  it('refuses unconfirmed external npm installs with the risk warning',
    (): void => {
      const ROOT = mkdtempSync(join(tmpdir(), 'nano-store-'));
      const RESULT = installExternal('some-random-bot-module', false, {
        root: ROOT,
        exec: (): string => {
          return '';
        },
      });

      expect(RESULT.ok).toBe(false);

      if (!RESULT.ok) {
        expect(RESULT.error).toBe(EXTERNAL_RISK_WARNING);
      }
    });

  it('records confirmed externals as unreviewed provenance', ():
  void => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-store-'));
    const COMMANDS: string[] = [];
    const RESULT = installExternal('some-random-bot-module', true, {
      root: ROOT,
      exec: (command: string): string => {
        COMMANDS.push(command);
        return '';
      },
    });

    expect(RESULT.ok).toBe(true);
    expect(COMMANDS).toEqual(['npm install some-random-bot-module']);

    const CONFIG = loadConfig(ROOT);
    const ENTRY = CONFIG.modules[0];

    expect(typeof ENTRY === 'object' && ENTRY.trusted).toBe(false);
    expect(typeof ENTRY === 'object' && ENTRY.source).toBe('external');
  });

  it('lists outdated and store-removed modules', async ():
  Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-store-'));
    const CLIENT = createClient(ROOT, fetchOk());

    await installFromStore(CLIENT, 'embed-styler', {
      root: ROOT,
      exec: (): string => {
        return '';
      },
    });

    /* Fake an older installed version + a vanished module. */
    const CONFIG = loadConfig(ROOT);
    const ENTRY = CONFIG.modules[0];

    if (typeof ENTRY === 'object') {
      ENTRY.version = '1.0.0';
    }

    CONFIG.modules.push({
      name: 'gone-module',
      source: 'store',
      spec: 'gone-module',
      version: '0.1.0',
    });
    saveConfig(CONFIG, ROOT);

    const RESULT = await listOutdated(CLIENT, ROOT);

    expect(RESULT.ok).toBe(true);

    if (RESULT.ok) {
      expect(RESULT.data).toContainEqual({
        name: 'embed-styler',
        installed: '1.0.0',
        latest: '1.2.0',
      });
      expect(RESULT.data).toContainEqual({
        name: 'gone-module',
        installed: '0.1.0',
        latest: 'removed from store',
      });
    }
  });
});
