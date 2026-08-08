import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { NanoCache } from '@/services/cache.js';
import { DatabaseService } from '@/services/database.js';
import type { GuildConfigPersistence } from
  '@/services/guild-store.js';
import { GuildStore } from '@/services/guild-store.js';

const GUILD_A = '100000000000000001';
const GUILD_B = '100000000000000002';
const MODULE = 'leveling';
const DEFAULT_XP = 10;
const CUSTOM_XP = 25;
const V2 = 2;

const SCHEMA = z.object({
  xp_per_message: z.number().int()
    .min(0)
    .default(DEFAULT_XP),
  announce: z.boolean().default(true),
});

/* Ceiling fixtures: a passthrough schema so the write ceiling — not
   zod — decides, and the ceiling numbers pinned to the contract. */
const LOOSE_MODULE = 'loose';
const LOOSE_SCHEMA = z.looseObject({});
const NODE_LIMIT = 2000;
const STRING_LIMIT = 8192;

describe('GuildStore', (): void => {
  let root: string;
  let database: DatabaseService;
  let store: GuildStore;

  beforeEach(async (): Promise<void> => {
    root = await mkdtemp(join(tmpdir(), 'nano-guild-store-'));
    const OPENED = DatabaseService.open({ driver: 'sqlite' }, root);

    if (!OPENED.ok) {
      throw new Error(OPENED.error);
    }

    database = OPENED.data;
    store = new GuildStore(
      database.guildConfigPersistence(),
      new NanoCache()
    );
    store.registerSchema(MODULE, { schema: SCHEMA });
  });

  afterEach(async (): Promise<void> => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('returns schema defaults with zero rows and zero writes',
    (): void => {
      const CONFIG = store.getGuildModuleConfig(GUILD_A, MODULE);
      expect(CONFIG).toEqual({
        xp_per_message: DEFAULT_XP,
        announce: true,
      });
      expect(store.listGuildsFor(MODULE)).toEqual([]);
    });

  it('persists a valid write and reads it back', (): void => {
    const SET = store.setGuildModuleConfig(GUILD_A, MODULE, {
      xp_per_message: CUSTOM_XP,
      announce: false,
    });
    expect(SET.ok).toBe(true);

    const CONFIG = store.getGuildModuleConfig(GUILD_A, MODULE);
    expect(CONFIG).toEqual({
      xp_per_message: CUSTOM_XP,
      announce: false,
    });
    expect(store.listGuildsFor(MODULE)).toEqual([GUILD_A]);
  });

  it('rejects an invalid write and stores nothing', (): void => {
    const SET = store.setGuildModuleConfig(GUILD_A, MODULE, {
      xp_per_message: -1,
    });
    expect(SET.ok).toBe(false);
    expect(store.listGuildsFor(MODULE)).toEqual([]);
    expect(store.getGuildModuleConfig(GUILD_A, MODULE))
      .toEqual({ xp_per_message: DEFAULT_XP, announce: true });
  });

  it('patches one key, validates the merged object', (): void => {
    store.setGuildModuleConfig(GUILD_A, MODULE, {
      xp_per_message: CUSTOM_XP,
      announce: false,
    });
    const PATCH = store.patchGuildModuleConfig(GUILD_A, MODULE, {
      announce: true,
    });
    expect(PATCH.ok).toBe(true);

    const CONFIG = store.getGuildModuleConfig(GUILD_A, MODULE);
    expect(CONFIG).toEqual({
      xp_per_message: CUSTOM_XP,
      announce: true,
    });

    const BAD = store.patchGuildModuleConfig(GUILD_A, MODULE, {
      xp_per_message: -1,
    });
    expect(BAD.ok).toBe(false);
  });

  it('deletes back to defaults', (): void => {
    store.setGuildModuleConfig(GUILD_A, MODULE, {
      xp_per_message: CUSTOM_XP,
    });
    const REMOVED = store.deleteGuildModuleConfig(GUILD_A, MODULE);
    expect(REMOVED.ok && REMOVED.data > 0).toBe(true);
    expect(store.getGuildModuleConfig(GUILD_A, MODULE))
      .toEqual({ xp_per_message: DEFAULT_XP, announce: true });
    expect(store.listGuildsFor(MODULE)).toEqual([]);
  });

  it('keeps guilds isolated', (): void => {
    store.setGuildModuleConfig(GUILD_A, MODULE, {
      xp_per_message: CUSTOM_XP,
    });
    expect(store.getGuildModuleConfig(GUILD_B, MODULE))
      .toEqual({ xp_per_message: DEFAULT_XP, announce: true });
    expect(store.listGuildsFor(MODULE)).toEqual([GUILD_A]);
  });

  it('runs the migration hook when the stored version is older',
    (): void => {
      store.setGuildModuleConfig(GUILD_A, MODULE, {
        xp_per_message: CUSTOM_XP,
      });

      const SCHEMA_V2 = z.object({
        message_xp: z.number().int()
          .min(0)
          .default(DEFAULT_XP),
        announce: z.boolean().default(true),
      });
      store.registerSchema(MODULE, {
        schema: SCHEMA_V2,
        config_version: V2,
        migrate: (
          old_version: number,
          value: Record<string, unknown>
        ): Record<string, unknown> => {
          expect(old_version).toBe(1);
          return {
            message_xp: value.xp_per_message,
            announce: value.announce,
          };
        },
      });

      const CONFIG = store.getGuildModuleConfig(GUILD_A, MODULE);
      expect(CONFIG.message_xp).toBe(CUSTOM_XP);
    });

  it('falls back to defaults on a corrupted row and counts it',
    (): void => {
      const PERSISTENCE = database.guildConfigPersistence();
      PERSISTENCE.upsertKeys(GUILD_A, MODULE, [
        { key: 'xp_per_message', value: 'not json{{' },
      ]);

      const CONFIG = store.getGuildModuleConfig(GUILD_A, MODULE);
      expect(CONFIG).toEqual({
        xp_per_message: DEFAULT_XP,
        announce: true,
      });
      expect(store.parseFailures()[MODULE]).toBeGreaterThan(0);
    });

  it('caches reads and invalidates on write', (): void => {
    const CACHE = new NanoCache();
    const CALLS: number[] = [];
    const REAL = database.guildConfigPersistence();
    const SPY: GuildConfigPersistence = {
      ...REAL,
      loadModuleConfig: (
        guild_id: string,
        module_id: string
      ): { key: string; value: string }[] => {
        CALLS.push(1);
        return REAL.loadModuleConfig(guild_id, module_id);
      },
    };
    const SPIED = new GuildStore(SPY, CACHE);
    SPIED.registerSchema(MODULE, { schema: SCHEMA });

    SPIED.getGuildModuleConfig(GUILD_A, MODULE);
    SPIED.getGuildModuleConfig(GUILD_A, MODULE);
    expect(CALLS.length).toBe(1);

    /* Every write now loads the stored rows once for the C1
       downgrade gate (stored version > registered refuses), so a
       set costs one load; the post-write read is uncached (+1). */
    SPIED.setGuildModuleConfig(GUILD_A, MODULE, {
      xp_per_message: CUSTOM_XP,
    });
    const CONFIG = SPIED.getGuildModuleConfig(GUILD_A, MODULE);
    expect(CALLS.length).toBe(3);
    expect(CONFIG.xp_per_message).toBe(CUSTOM_XP);
  });

  it('degrades without a database: defaults out, writes refused',
    (): void => {
      const OFFLINE = new GuildStore(null, new NanoCache());
      OFFLINE.registerSchema(MODULE, { schema: SCHEMA });

      expect(OFFLINE.getGuildModuleConfig(GUILD_A, MODULE))
        .toEqual({ xp_per_message: DEFAULT_XP, announce: true });
      expect(OFFLINE.setGuildModuleConfig(GUILD_A, MODULE, {}).ok)
        .toBe(false);
      expect(OFFLINE.listGuildsFor(MODULE)).toEqual([]);
    });

  it('refuses writes for a module with no registered schema',
    (): void => {
      const SET = store.setGuildModuleConfig(GUILD_A, 'ghost', {
        anything: 1,
      });
      expect(SET.ok).toBe(false);

      if (!SET.ok) {
        expect(SET.error).toContain('no registered config schema');
      }

      const PATCH = store.patchGuildModuleConfig(GUILD_A, 'ghost', {
        anything: 1,
      });
      expect(PATCH.ok).toBe(false);
      expect(store.listGuildsFor('ghost')).toEqual([]);
    });

  it('enforces the write ceiling: container depth', (): void => {
    store.registerSchema(LOOSE_MODULE, { schema: LOOSE_SCHEMA });

    const SIX_LEVELS = {
      a: { b: { c: { d: { e: { f: 1 } } } } },
    };
    expect(
      store.setGuildModuleConfig(GUILD_A, LOOSE_MODULE, SIX_LEVELS).ok
    ).toBe(true);

    const SEVEN_LEVELS = {
      a: { b: { c: { d: { e: { f: { g: 1 } } } } } },
    };
    const REFUSED = store.setGuildModuleConfig(
      GUILD_A,
      LOOSE_MODULE,
      SEVEN_LEVELS
    );
    expect(REFUSED.ok).toBe(false);

    if (!REFUSED.ok) {
      expect(REFUSED.error).toContain('nesting deeper');
    }
  });

  it('enforces the write ceiling: total values', (): void => {
    store.registerSchema(LOOSE_MODULE, { schema: LOOSE_SCHEMA });
    const MANY: Record<string, unknown> = {};

    for (let index = 0; index < NODE_LIMIT + 1; index += 1) {
      MANY[`k${index}`] = 1;
    }

    const REFUSED = store.setGuildModuleConfig(
      GUILD_A,
      LOOSE_MODULE,
      MANY
    );
    expect(REFUSED.ok).toBe(false);

    if (!REFUSED.ok) {
      expect(REFUSED.error).toContain(`more than ${NODE_LIMIT}`);
    }
  });

  it('enforces the write ceiling: string bytes', (): void => {
    store.registerSchema(LOOSE_MODULE, { schema: LOOSE_SCHEMA });

    const AT_LIMIT = { note: 'x'.repeat(STRING_LIMIT) };
    expect(
      store.setGuildModuleConfig(GUILD_A, LOOSE_MODULE, AT_LIMIT).ok
    ).toBe(true);

    const OVER = { note: 'x'.repeat(STRING_LIMIT + 1) };
    const REFUSED = store.setGuildModuleConfig(
      GUILD_A,
      LOOSE_MODULE,
      OVER
    );
    expect(REFUSED.ok).toBe(false);

    if (!REFUSED.ok) {
      expect(REFUSED.error).toContain('string longer');
    }
  });
});
