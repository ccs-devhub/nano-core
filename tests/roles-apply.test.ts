import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseService } from '@/services/database.js';

import {
  applyRoleChange,
  refusalReason,
  ROLES_SUPPRESSION
} from '@modules/roles/apply-role-change.js';
import { ROLES_CONFIG_SCHEMA } from '@modules/roles/config.js';
import {
  clearMemberLedger,
  memberLedger,
  recordGrants,
  removeGrants
} from '@modules/roles/ledger.js';
import { SuppressionMap } from '@modules/roles/suppression.js';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'modules',
  'roles',
  'migrations'
);
const GUILD_ID = 'g1';
const USER_ID = 'u1';
const BOT_TOP = 5;
const SHORT_TTL_MS = 5;
const TTL_WAIT_MS = 15;

interface FakeRole {
  id: string;
  managed: boolean;
  position: number;
}

interface SetCall {
  target: string[];
  reason?: string;
}

interface IdCollection {
  map<T>(callback: (role: { id: string }) => T): T[];
}

function idCollection(ids: string[]): IdCollection {
  return {
    map: <T>(callback: (role: { id: string }) => T): T[] => {
      return ids.map((id: string): T => {
        return callback({ id });
      });
    },
  };
}

interface FakeSetup {
  held: string[];
  roles: FakeRole[];
  sanction_roles?: string[];
  database: DatabaseService | null;
}

function makeBot(
  setup: FakeSetup
): { bot: Client; set_calls: SetCall[] } {
  const SET_CALLS: SetCall[] = [];
  let held = [...setup.held];
  const MEMBER = {
    roles: {
      get cache(): IdCollection {
        return idCollection(held);
      },
      set: async (
        role_ids: string[],
        reason?: string
      ): Promise<{ roles: { cache: IdCollection } }> => {
        SET_CALLS.push({ target: role_ids, reason });
        held = [...role_ids];
        return { roles: { cache: idCollection(held) } };
      },
    },
  };
  const ROLE_MAP = new Map<string, FakeRole>(
    setup.roles.map((role: FakeRole): [string, FakeRole] => {
      return [role.id, role];
    })
  );
  const GUILD = {
    roles: {
      cache: ROLE_MAP,
      fetch: async (id: string): Promise<FakeRole | null> => {
        return ROLE_MAP.get(id) ?? null;
      },
    },
    members: {
      fetch: async (): Promise<typeof MEMBER> => {
        return MEMBER;
      },
      me: { roles: { highest: { position: BOT_TOP } } },
    },
  };
  const CONFIG = ROLES_CONFIG_SCHEMA.parse({});
  CONFIG.sanction_roles = setup.sanction_roles ?? [];
  const BOT = {
    guilds: {
      fetch: async (): Promise<typeof GUILD> => {
        return GUILD;
      },
    },
    services: {
      database: setup.database,
      guild_store: {
        getGuildModuleConfig: (): typeof CONFIG => {
          return CONFIG;
        },
      },
    },
  };
  return { bot: BOT as unknown as Client, set_calls: SET_CALLS };
}

function openTemp(): DatabaseService {
  const ROOT = mkdtempSync(join(tmpdir(), 'nano-roles-apply-'));
  const RESULT = DatabaseService.open({ driver: 'sqlite' }, ROOT);

  if (!RESULT.ok) {
    throw new Error(RESULT.error);
  }

  const SERVICE = RESULT.data;
  const MIGRATED = SERVICE.runModuleMigrations('roles', MIGRATIONS_DIR);

  if (!MIGRATED.ok) {
    throw new Error(MIGRATED.error);
  }
  return SERVICE;
}

afterEach((): void => {
  ROLES_SUPPRESSION.clear();
});

describe('refusalReason', (): void => {
  const ROLE: FakeRole = { id: 'r1', managed: false, position: 1 };

  it('refuses everyone, missing, managed, sanction, above-bot',
    (): void => {
      expect(refusalReason(ROLE, GUILD_ID, GUILD_ID, [], BOT_TOP))
        .toBe('everyone');
      expect(refusalReason(null, 'gone', GUILD_ID, [], BOT_TOP))
        .toBe('missing');
      expect(refusalReason(
        { ...ROLE, managed: true },
        'r1',
        GUILD_ID,
        [],
        BOT_TOP
      )).toBe('managed');
      expect(refusalReason(ROLE, 'r1', GUILD_ID, ['r1'], BOT_TOP))
        .toBe('sanction');
      expect(refusalReason(
        { ...ROLE, position: BOT_TOP },
        'r1',
        GUILD_ID,
        [],
        BOT_TOP
      )).toBe('above_bot');
      expect(refusalReason(ROLE, 'r1', GUILD_ID, [], BOT_TOP))
        .toBeNull();
    });
});

describe('SuppressionMap', (): void => {
  it('matches order-insensitively and expires on ttl',
    async (): Promise<void> => {
      const MAP = new SuppressionMap(SHORT_TTL_MS);
      MAP.stamp(GUILD_ID, USER_ID, ['b', 'a']);

      expect(MAP.matches(GUILD_ID, USER_ID, ['a', 'b'])).toBe(true);
      expect(MAP.matches(GUILD_ID, USER_ID, ['a'])).toBe(false);

      await new Promise((resolve: (value: unknown) => void): void => {
        setTimeout(resolve, TTL_WAIT_MS);
      });

      expect(MAP.matches(GUILD_ID, USER_ID, ['a', 'b'])).toBe(false);
      expect(MAP.size()).toBe(0);
    });
});

describe('roles ledger', (): void => {
  it('upserts grants, removes revokes and clears members',
    (): void => {
      const SERVICE = openTemp();
      const DB = SERVICE.getDb();
      recordGrants(DB, [{
        guild_id: GUILD_ID,
        user_id: USER_ID,
        role_id: 'r1',
        source: 'panel',
        granted_by: null,
        granted_at: 1,
      }]);
      recordGrants(DB, [{
        guild_id: GUILD_ID,
        user_id: USER_ID,
        role_id: 'r1',
        source: 'manual',
        granted_by: 'mod1',
        granted_at: 2,
      }]);

      const ROWS = memberLedger(DB, GUILD_ID, USER_ID);

      expect(ROWS).toHaveLength(1);
      expect(ROWS[0].source).toBe('manual');
      expect(ROWS[0].granted_by).toBe('mod1');

      removeGrants(DB, GUILD_ID, USER_ID, ['r1']);

      expect(memberLedger(DB, GUILD_ID, USER_ID)).toHaveLength(0);

      recordGrants(DB, [
        {
          guild_id: GUILD_ID,
          user_id: USER_ID,
          role_id: 'r1',
          source: 'rule',
          granted_by: null,
          granted_at: 3,
        },
        {
          guild_id: GUILD_ID,
          user_id: USER_ID,
          role_id: 'r2',
          source: 'rule',
          granted_by: null,
          granted_at: 4,
        },
      ]);

      expect(clearMemberLedger(DB, GUILD_ID, USER_ID)).toBe(2);
      SERVICE.close();
    });
});

describe('applyRoleChange', (): void => {
  it('grants through one PATCH, ledgers and stamps suppression',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const { bot: BOT, set_calls: CALLS } = makeBot({
        held: ['a'],
        roles: [
          { id: 'a', managed: false, position: 1 },
          { id: 'b', managed: false, position: 2 },
        ],
        database: SERVICE,
      });

      const RESULT = await applyRoleChange(
        BOT,
        GUILD_ID,
        USER_ID,
        { add: ['b'] },
        'manual',
        'mod1'
      );

      expect(RESULT.ok).toBe(true);

      if (RESULT.ok) {
        expect(RESULT.data.applied_add).toEqual(['b']);
        expect(RESULT.data.noop).toBe(false);
      }

      expect(CALLS).toHaveLength(1);
      expect([...CALLS[0].target].sort()).toEqual(['a', 'b']);
      expect(CALLS[0].reason).toBe('roles:manual by mod1');
      expect(ROLES_SUPPRESSION.matches(GUILD_ID, USER_ID, ['a', 'b']))
        .toBe(true);

      const ROWS = memberLedger(SERVICE.getDb(), GUILD_ID, USER_ID);

      expect(ROWS).toHaveLength(1);
      expect(ROWS[0].role_id).toBe('b');
      expect(ROWS[0].source).toBe('manual');
      expect(ROWS[0].granted_by).toBe('mod1');
      SERVICE.close();
    });

  it('refuses the whole matrix without touching the API',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const { bot: BOT, set_calls: CALLS } = makeBot({
        held: [],
        roles: [
          { id: 'managed', managed: true, position: 1 },
          { id: 'high', managed: false, position: BOT_TOP },
          { id: 'sanction', managed: false, position: 1 },
        ],
        sanction_roles: ['sanction'],
        database: SERVICE,
      });

      const RESULT = await applyRoleChange(
        BOT,
        GUILD_ID,
        USER_ID,
        { add: ['managed', 'high', 'sanction', GUILD_ID, 'gone'] },
        'panel'
      );

      expect(RESULT.ok).toBe(true);

      if (RESULT.ok) {
        expect(RESULT.data.noop).toBe(true);
        expect(RESULT.data.refused.map(
          (entry: { reason: string }): string => {
            return entry.reason;
          }
        ).sort()).toEqual([
          'above_bot',
          'everyone',
          'managed',
          'missing',
          'sanction',
        ]);
      }

      expect(CALLS).toHaveLength(0);
      expect(memberLedger(SERVICE.getDb(), GUILD_ID, USER_ID))
        .toHaveLength(0);
      SERVICE.close();
    });

  it('revokes held roles and deletes their ledger rows',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      recordGrants(SERVICE.getDb(), [{
        guild_id: GUILD_ID,
        user_id: USER_ID,
        role_id: 'b',
        source: 'panel',
        granted_by: null,
        granted_at: 1,
      }]);

      const { bot: BOT, set_calls: CALLS } = makeBot({
        held: ['a', 'b'],
        roles: [
          { id: 'a', managed: false, position: 1 },
          { id: 'b', managed: false, position: 2 },
        ],
        database: SERVICE,
      });

      const RESULT = await applyRoleChange(
        BOT,
        GUILD_ID,
        USER_ID,
        { remove: ['b'] },
        'panel'
      );

      expect(RESULT.ok).toBe(true);

      if (RESULT.ok) {
        expect(RESULT.data.applied_remove).toEqual(['b']);
      }

      expect(CALLS).toHaveLength(1);
      expect(CALLS[0].target).toEqual(['a']);
      expect(memberLedger(SERVICE.getDb(), GUILD_ID, USER_ID))
        .toHaveLength(0);
      SERVICE.close();
    });

  it('is a noop when the end state already holds',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const { bot: BOT, set_calls: CALLS } = makeBot({
        held: ['a'],
        roles: [{ id: 'a', managed: false, position: 1 }],
        database: SERVICE,
      });

      const RESULT = await applyRoleChange(
        BOT,
        GUILD_ID,
        USER_ID,
        { add: ['a'] },
        'entry'
      );

      expect(RESULT.ok).toBe(true);

      if (RESULT.ok) {
        expect(RESULT.data.noop).toBe(true);
      }

      expect(CALLS).toHaveLength(0);
      SERVICE.close();
    });

  it('errs honestly without a database service',
    async (): Promise<void> => {
      const { bot: BOT } = makeBot({
        held: [],
        roles: [],
        database: null,
      });

      const RESULT = await applyRoleChange(
        BOT,
        GUILD_ID,
        USER_ID,
        { add: ['a'] },
        'manual'
      );

      expect(RESULT.ok).toBe(false);
    });
});
