import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { DatabaseService } from '@/services/database.js';
import { moduleKind } from '@/types/nano-module.js';

import {
  ROLES_CONFIG_SCHEMA,
  ROLES_CONFIG_SURFACES
} from '@modules/roles/config.js';
import roles_module from '@modules/roles/index.js';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'modules',
  'roles',
  'migrations'
);
const SNOWFLAKE_A = '763464848457072701';
const SNOWFLAKE_B = '810578983225655306';
const SNOWFLAKE_C = '849285785488195584';
const DEFAULT_SETTLE_WINDOW_S = 60;
const MAX_DESCRIPTION = 100;

function openTemp(): DatabaseService {
  const ROOT = mkdtempSync(join(tmpdir(), 'nano-roles-'));
  const RESULT = DatabaseService.open({ driver: 'sqlite' }, ROOT);

  if (!RESULT.ok) {
    throw new Error(RESULT.error);
  }
  return RESULT.data;
}

function minimalPanel(): Record<string, unknown> {
  return {
    id: 'picker',
    surface: 'reaction',
    channel_id: SNOWFLAKE_A,
    map: [{ role_id: SNOWFLAKE_B }],
  };
}

describe('roles config schema', (): void => {
  it('parses {} to a complete, empty-by-default config', (): void => {
    const PARSED = ROLES_CONFIG_SCHEMA.safeParse({});

    expect(PARSED.success).toBe(true);

    if (PARSED.success) {
      expect(PARSED.data.enabled).toBe(true);
      expect(PARSED.data.entry_role_id).toBeNull();
      expect(PARSED.data.bot_role_id).toBeNull();
      expect(PARSED.data.divider_color).toBe('#232428');
      expect(PARSED.data.panels).toEqual([]);
      expect(PARSED.data.sections).toEqual([]);
      expect(PARSED.data.rules).toEqual([]);
      expect(PARSED.data.never_restore).toEqual([]);
      expect(PARSED.data.sanction_roles).toEqual([]);
      expect(PARSED.data.restore.enabled).toBe(true);
      expect(PARSED.data.restore.settle_window_s)
        .toBe(DEFAULT_SETTLE_WINDOW_S);
      expect(PARSED.data.restore.notice).toBeNull();
    }
  });

  it('fills panel gates server-side defaults', (): void => {
    const PARSED = ROLES_CONFIG_SCHEMA.safeParse({
      panels: [minimalPanel()],
    });

    expect(PARSED.success).toBe(true);

    if (PARSED.success) {
      const PANEL = PARSED.data.panels[0];

      expect(PANEL.gates.refuse_sanctioned).toBe(true);
      expect(PANEL.gates.min_account_age_days).toBe(0);
      expect(PANEL.exclusive).toBe(false);
      expect(PANEL.max).toBeNull();
    }
  });

  it('rejects a malformed panel id (N16/A8)', (): void => {
    const PANEL = { ...minimalPanel(), id: 'BAD ID' };
    const PARSED = ROLES_CONFIG_SCHEMA.safeParse({ panels: [PANEL] });

    expect(PARSED.success).toBe(false);
  });

  it('rejects duplicate panel ids and duplicate map roles',
    (): void => {
      const DUPLICATE_IDS = ROLES_CONFIG_SCHEMA.safeParse({
        panels: [minimalPanel(), minimalPanel()],
      });

      expect(DUPLICATE_IDS.success).toBe(false);

      const DUPLICATE_ROLES = ROLES_CONFIG_SCHEMA.safeParse({
        panels: [{
          ...minimalPanel(),
          map: [
            { role_id: SNOWFLAKE_B },
            { role_id: SNOWFLAKE_B },
          ],
        }],
      });

      expect(DUPLICATE_ROLES.success).toBe(false);
    });

  it('rejects an empty panel map and a non-snowflake role',
    (): void => {
      const EMPTY_MAP = ROLES_CONFIG_SCHEMA.safeParse({
        panels: [{ ...minimalPanel(), map: [] }],
      });

      expect(EMPTY_MAP.success).toBe(false);

      const BAD_ROLE = ROLES_CONFIG_SCHEMA.safeParse({
        panels: [{
          ...minimalPanel(),
          map: [{ role_id: 'not-a-snowflake' }],
        }],
      });

      expect(BAD_ROLE.success).toBe(false);
    });

  it('rejects roles or dividers shared between sections',
    (): void => {
      const SHARED_ROLE = ROLES_CONFIG_SCHEMA.safeParse({
        sections: [
          { name: 'alpha', role_ids: [SNOWFLAKE_A] },
          { name: 'beta', role_ids: [SNOWFLAKE_A] },
        ],
      });

      expect(SHARED_ROLE.success).toBe(false);

      const DIVIDER_AS_MEMBER = ROLES_CONFIG_SCHEMA.safeParse({
        sections: [
          {
            name: 'alpha',
            divider_role_id: SNOWFLAKE_A,
            role_ids: [SNOWFLAKE_B],
          },
          { name: 'beta', role_ids: [SNOWFLAKE_A] },
        ],
      });

      expect(DIVIDER_AS_MEMBER.success).toBe(false);
    });

  it('accepts the VIAJERO strict rule and defaults grant_only',
    (): void => {
      const PARSED = ROLES_CONFIG_SCHEMA.safeParse({
        rules: [
          {
            when: {
              kind: 'holds_count',
              role_ids: [SNOWFLAKE_A, SNOWFLAKE_B, SNOWFLAKE_C],
              at_least: 2,
            },
            then: { action: 'grant', role_id: SNOWFLAKE_C },
            enforce: 'strict',
          },
          {
            when: { kind: 'holds_any', role_ids: [SNOWFLAKE_A] },
            then: { action: 'grant', role_id: SNOWFLAKE_B },
          },
        ],
      });

      expect(PARSED.success).toBe(true);

      if (PARSED.success) {
        expect(PARSED.data.rules[0].enforce).toBe('strict');
        expect(PARSED.data.rules[1].enforce).toBe('grant_only');
      }
    });

  it('rejects a bad divider color and a bad enforce value',
    (): void => {
      const BAD_COLOR = ROLES_CONFIG_SCHEMA.safeParse({
        divider_color: 'dark',
      });

      expect(BAD_COLOR.success).toBe(false);

      const BAD_ENFORCE = ROLES_CONFIG_SCHEMA.safeParse({
        rules: [{
          when: { kind: 'is_bot' },
          then: { action: 'grant', role_id: SNOWFLAKE_A },
          enforce: 'always',
        }],
      });

      expect(BAD_ENFORCE.success).toBe(false);
    });

  it('maps every top-level key to a config surface (C6)',
    (): void => {
      const SCHEMA_KEYS = Object.keys(ROLES_CONFIG_SCHEMA.shape)
        .sort();
      const SURFACE_KEYS = Object.keys(ROLES_CONFIG_SURFACES).sort();

      expect(SURFACE_KEYS).toEqual(SCHEMA_KEYS);

      for (const _surface of Object.values(ROLES_CONFIG_SURFACES)) {
        expect(['discord', 'ops']).toContain(_surface);
      }
    });
});

describe('roles migrations', (): void => {
  it('creates the three tables with keys, checks and indices',
    (): void => {
      const SERVICE = openTemp();
      const RESULT = SERVICE.runModuleMigrations(
        'roles',
        MIGRATIONS_DIR
      );

      expect(RESULT.ok).toBe(true);

      const DB = SERVICE.getDb();
      const TABLES = DB.all(
        sql`SELECT name, sql FROM sqlite_master
            WHERE type = 'table' AND name LIKE 'mod_roles%'
            ORDER BY name`
      ) as { name: string; sql: string }[];

      expect(TABLES.map((table: { name: string }): string => {
        return table.name;
      })).toEqual([
        'mod_roles_member_roles',
        'mod_roles_panels',
        'mod_roles_snapshots',
      ]);

      const LEDGER = TABLES[0];

      /* DB2-7: the all-key ledger is WITHOUT ROWID. */
      expect(LEDGER.sql).toContain('WITHOUT ROWID');

      const INDICES = DB.all(
        sql`SELECT name FROM sqlite_master
            WHERE type = 'index' AND name LIKE 'idx_mod_roles%'
            ORDER BY name`
      ) as { name: string }[];

      expect(INDICES.map((index: { name: string }): string => {
        return index.name;
      })).toEqual([
        'idx_mod_roles_member_roles_guild_role',
        'idx_mod_roles_panels_lookup',
        'idx_mod_roles_panels_message',
        'idx_mod_roles_snapshots_pending',
      ]);
      SERVICE.close();
    });

  it('enforces the ledger primary key and the source check',
    (): void => {
      const SERVICE = openTemp();
      SERVICE.runModuleMigrations('roles', MIGRATIONS_DIR);
      const DB = SERVICE.getDb();
      DB.run(
        sql`INSERT INTO mod_roles_member_roles
            (guild_id, user_id, role_id, source, granted_at)
            VALUES ('1', '2', '3', 'panel', 0)`
      );

      expect((): void => {
        DB.run(
          sql`INSERT INTO mod_roles_member_roles
              (guild_id, user_id, role_id, source, granted_at)
              VALUES ('1', '2', '3', 'manual', 1)`
        );
      }).toThrow();

      expect((): void => {
        DB.run(
          sql`INSERT INTO mod_roles_member_roles
              (guild_id, user_id, role_id, source, granted_at)
              VALUES ('1', '2', '4', 'guesswork', 0)`
        );
      }).toThrow();
      SERVICE.close();
    });

  it('keeps panel message ids unique only when present (DB14)',
    (): void => {
      const SERVICE = openTemp();
      SERVICE.runModuleMigrations('roles', MIGRATIONS_DIR);
      const DB = SERVICE.getDb();
      DB.run(
        sql`INSERT INTO mod_roles_panels
            (guild_id, panel_id, channel_id, message_id, surface,
             config_json, updated_at)
            VALUES ('1', 'a', '10', NULL, 'reaction', '{}', 0)`
      );
      DB.run(
        sql`INSERT INTO mod_roles_panels
            (guild_id, panel_id, channel_id, message_id, surface,
             config_json, updated_at)
            VALUES ('1', 'b', '10', NULL, 'button', '{}', 0)`
      );
      DB.run(
        sql`INSERT INTO mod_roles_panels
            (guild_id, panel_id, channel_id, message_id, surface,
             config_json, updated_at)
            VALUES ('1', 'c', '10', '555', 'reaction', '{}', 0)`
      );

      expect((): void => {
        DB.run(
          sql`INSERT INTO mod_roles_panels
              (guild_id, panel_id, channel_id, message_id, surface,
               config_json, updated_at)
              VALUES ('1', 'd', '10', '555', 'reaction', '{}', 0)`
        );
      }).toThrow();
      SERVICE.close();
    });
});

describe('roles module contract', (): void => {
  it('is a storage-only extension for now', (): void => {
    expect(roles_module.name).toBe('roles');
    expect(roles_module.version).toBeTruthy();
    expect(roles_module.description?.length ?? 0)
      .toBeLessThanOrEqual(MAX_DESCRIPTION);
    expect(roles_module.commands).toBeUndefined();
    expect(roles_module.events).toBeUndefined();
    expect(typeof roles_module.onEnable).toBe('function');
    expect(typeof roles_module.healthCheck).toBe('function');
    expect(moduleKind(roles_module)).toBe('extension');
  });
});
