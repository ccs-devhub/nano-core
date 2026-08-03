import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'discord.js';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseService } from '@/services/database.js';
import { NanoScheduler } from '@/services/scheduler.js';
import type { NanoResult } from '@/types/nano-result.js';
import { ok } from '@/types/nano-result.js';

import { ROLES_SUPPRESSION } from '@modules/roles/apply-role-change.js';
import { ROLES_CONFIG_SCHEMA } from '@modules/roles/config.js';
import type { RestorePayload } from '@modules/roles/join-pipeline.js';
import {
  handleMemberAdd,
  rescanPendingRestores,
  runRestore
} from '@modules/roles/join-pipeline.js';
import { memberLedger } from '@modules/roles/ledger.js';
import type { SnapshotRole } from '@modules/roles/snapshots.js';
import {
  countPendingSnapshots,
  latestPendingSnapshot
} from '@modules/roles/snapshots.js';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'modules',
  'roles',
  'migrations'
);
const GUILD_ID = 'g1';
const USER_ID = 'u1';
const ENTRY_ROLE = '100000000000000001';
const SANCTION_ROLE = '100000000000000002';
const NEVER_ROLE = '100000000000000003';
const BOT_TOP = 9;
const TAKEN_AT = 1000;
const DEFAULT_SETTLE_MS = 60000;
const DEFAULT_REARMS = 2;
const IMMEDIATE_WAIT_MS = 50;

interface FakeRole {
  id: string;
  managed: boolean;
  position: number;
  permissions: { toArray(): string[] };
}

function fakeRole(
  id: string,
  permissions: string[] = [],
  managed: boolean = false
): FakeRole {
  return {
    id,
    managed,
    position: 1,
    permissions: {
      toArray: (): string[] => {
        return permissions;
      },
    },
  };
}

interface SetCall {
  target: string[];
  reason?: string;
}

interface ScheduledCall {
  name: string;
  run_at: Date | number;
  persistent: boolean;
  payload: unknown;
  fn: (payload?: unknown) => Promise<void> | void;
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

function openTemp(): DatabaseService {
  const ROOT = mkdtempSync(join(tmpdir(), 'nano-roles-join-'));
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

function insertSnapshot(
  service: DatabaseService,
  roles: SnapshotRole[],
  user_id: string = USER_ID,
  taken_at: number = TAKEN_AT
): void {
  service.getDb().run(sql`
    INSERT INTO mod_roles_snapshots
      (guild_id, user_id, taken_at, roles_json, reason, actor_id,
        partial, restore_state, restored_at)
    VALUES (${GUILD_ID}, ${user_id}, ${taken_at},
      ${JSON.stringify(roles)}, 'leave', NULL, 0, 'pending', NULL)
  `);
}

interface HarnessSetup {
  held: string[];
  roles: FakeRole[];
  config?: Record<string, unknown>;
  sanctions?: string[];
  database: DatabaseService;
  real_scheduler?: NanoScheduler;
  break_set?: boolean;
}

interface Harness {
  bot: Client;
  set_calls: SetCall[];
  scheduled: ScheduledCall[];
  dm_sent: string[];
}

function makeHarness(setup: HarnessSetup): Harness {
  const SET_CALLS: SetCall[] = [];
  const SCHEDULED: ScheduledCall[] = [];
  const DM_SENT: string[] = [];
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
        if (setup.break_set) {
          throw new Error('Missing Permissions');
        }

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
    id: GUILD_ID,
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
  const CONFIG = ROLES_CONFIG_SCHEMA.parse(setup.config ?? {});
  const SCHEDULER = setup.real_scheduler ?? {
    scheduleOnce: (
      module_id: string,
      name: string,
      run_at: Date | number,
      fn: (payload?: unknown) => Promise<void> | void,
      options?: { persistent?: boolean; payload?: unknown }
    ): { ok: true; data: string } => {
      SCHEDULED.push({
        name: `${module_id}:${name}`,
        run_at,
        persistent: options?.persistent === true,
        payload: options?.payload,
        fn,
      });
      return { ok: true, data: name };
    },
  };
  const BOT = {
    user: { id: 'bot1' },
    nano: {
      getModuleApi: (name: string): unknown => {
        if (name === 'moderation' && setup.sanctions) {
          const SANCTIONS = setup.sanctions;
          return {
            getActiveSanctions: async ():
            Promise<NanoResult<string[]>> => {
              return ok(SANCTIONS);
            },
          };
        }
        return undefined;
      },
    },
    users: {
      fetch: async (): Promise<{
        send(payload: { content?: string } | string): Promise<{
          id: string;
        }>;
      }> => {
        return {
          send: async (
            payload: { content?: string } | string
          ): Promise<{ id: string }> => {
            DM_SENT.push(
              typeof payload === 'string'
                ? payload
                : payload.content ?? ''
            );
            return { id: 'm1' };
          },
        };
      },
    },
    guilds: {
      fetch: async (): Promise<typeof GUILD> => {
        return GUILD;
      },
    },
    services: {
      database: setup.database,
      scheduler: SCHEDULER,
      guild_store: {
        getGuildModuleConfig: (): typeof CONFIG => {
          return CONFIG;
        },
      },
    },
  };
  return {
    bot: BOT as unknown as Client,
    set_calls: SET_CALLS,
    scheduled: SCHEDULED,
    dm_sent: DM_SENT,
  };
}

function joinMember(held: string[] = []): {
  id: string;
  guild: { id: string };
  roles: { cache: IdCollection };
} {
  return {
    id: USER_ID,
    guild: { id: GUILD_ID },
    roles: { cache: idCollection(held) },
  };
}

afterEach((): void => {
  ROLES_SUPPRESSION.clear();
});

describe('entry role on join', (): void => {
  it('grants the entry role with source entry',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const HARNESS = makeHarness({
        held: [],
        roles: [fakeRole(ENTRY_ROLE)],
        config: { entry_role_id: ENTRY_ROLE },
        database: SERVICE,
      });

      await handleMemberAdd(HARNESS.bot, joinMember());

      expect(HARNESS.set_calls).toHaveLength(1);
      expect(HARNESS.set_calls[0].target).toEqual([ENTRY_ROLE]);

      const ROWS = memberLedger(SERVICE.getDb(), GUILD_ID, USER_ID);

      expect(ROWS).toHaveLength(1);
      expect(ROWS[0].source).toBe('entry');
      expect(ROWS[0].granted_by).toBeNull();
      SERVICE.close();
    });

  it('skips the entry role under an active sanction',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const HARNESS = makeHarness({
        held: [],
        roles: [fakeRole(ENTRY_ROLE)],
        config: { entry_role_id: ENTRY_ROLE },
        sanctions: [SANCTION_ROLE],
        database: SERVICE,
      });

      await handleMemberAdd(HARNESS.bot, joinMember());

      expect(HARNESS.set_calls).toHaveLength(0);
      expect(memberLedger(SERVICE.getDb(), GUILD_ID, USER_ID))
        .toHaveLength(0);
      SERVICE.close();
    });
});

describe('restore arming', (): void => {
  it('arms the persistent settle one-shot instead of the entry role',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      insertSnapshot(SERVICE, [{
        id: 'a',
        name: 'alpha',
        managed: false,
      }]);

      const HARNESS = makeHarness({
        held: [],
        roles: [fakeRole(ENTRY_ROLE)],
        config: { entry_role_id: ENTRY_ROLE },
        database: SERVICE,
      });

      await handleMemberAdd(HARNESS.bot, joinMember());

      expect(HARNESS.set_calls).toHaveLength(0);
      expect(HARNESS.scheduled).toHaveLength(1);

      const JOB = HARNESS.scheduled[0];

      expect(JOB.name).toBe(`roles:restore:${GUILD_ID}:${USER_ID}`);
      expect(JOB.run_at).toBe(DEFAULT_SETTLE_MS);
      expect(JOB.persistent).toBe(true);
      expect(JOB.payload).toEqual({
        guild_id: GUILD_ID,
        user_id: USER_ID,
        rearms_left: DEFAULT_REARMS,
        seen: [],
      });
      SERVICE.close();
    });

  it('re-arms bounded while picks are still landing',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      insertSnapshot(SERVICE, [{
        id: 'a',
        name: 'alpha',
        managed: false,
      }]);

      const HARNESS = makeHarness({
        held: ['picked'],
        roles: [fakeRole('a'), fakeRole('picked')],
        database: SERVICE,
      });
      const MOVED: RestorePayload = {
        guild_id: GUILD_ID,
        user_id: USER_ID,
        rearms_left: 1,
        seen: [],
      };

      await runRestore(HARNESS.bot, MOVED);

      expect(HARNESS.set_calls).toHaveLength(0);
      expect(HARNESS.scheduled).toHaveLength(1);
      expect(HARNESS.scheduled[0].payload).toEqual({
        guild_id: GUILD_ID,
        user_id: USER_ID,
        rearms_left: 0,
        seen: ['picked'],
      });

      /* Budget exhausted: the same drift now executes. */
      const EXHAUSTED: RestorePayload = { ...MOVED, rearms_left: 0 };

      await runRestore(HARNESS.bot, EXHAUSTED);

      expect(HARNESS.set_calls).toHaveLength(1);
      SERVICE.close();
    });
});

describe('restore execution', (): void => {
  it('applies the additive union and stamps the snapshot done',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      insertSnapshot(SERVICE, [
        { id: 'a', name: 'alpha', managed: false },
        { id: 'keep1', name: 'kept', managed: false },
        { id: 'm1', name: 'integration', managed: true },
        { id: NEVER_ROLE, name: 'blocked', managed: false },
        { id: 'gone1', name: 'retired crown', managed: false },
        { id: 'priv1', name: 'sharpened', managed: false },
      ]);

      const HARNESS = makeHarness({
        held: ['keep1'],
        roles: [
          fakeRole('a'),
          fakeRole('keep1'),
          fakeRole(NEVER_ROLE),
          fakeRole('priv1', ['ManageGuild']),
          fakeRole(SANCTION_ROLE),
        ],
        config: {
          never_restore: [NEVER_ROLE],
          sanction_roles: [SANCTION_ROLE],
        },
        sanctions: [SANCTION_ROLE],
        database: SERVICE,
      });
      const PAYLOAD: RestorePayload = {
        guild_id: GUILD_ID,
        user_id: USER_ID,
        rearms_left: 0,
        seen: null,
      };

      await runRestore(HARNESS.bot, PAYLOAD);

      /* ONE PATCH: union(current, restorable) + the live sanction —
         managed, never_restore, deleted and EX9-privileged dropped. */
      expect(HARNESS.set_calls).toHaveLength(1);
      expect([...HARNESS.set_calls[0].target].sort())
        .toEqual([SANCTION_ROLE, 'a', 'keep1']);

      const ROWS = memberLedger(SERVICE.getDb(), GUILD_ID, USER_ID);
      const SOURCES = ROWS.map(
        (row: { role_id: string; source: string }): string => {
          return `${row.role_id}:${row.source}`;
        }
      ).sort();

      expect(SOURCES).toEqual([
        `${SANCTION_ROLE}:restore`,
        'a:restore',
      ]);

      expect(
        latestPendingSnapshot(SERVICE.getDb(), GUILD_ID, USER_ID)
      ).toBeNull();
      expect(countPendingSnapshots(SERVICE.getDb())).toBe(0);

      /* C4 notice names the deleted role in the dropped slot. */
      expect(HARNESS.dm_sent).toHaveLength(1);
      expect(HARNESS.dm_sent[0]).toContain('retired crown');
      SERVICE.close();
    });

  it('leaves the row pending when the PATCH fails',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      insertSnapshot(SERVICE, [{
        id: 'a',
        name: 'alpha',
        managed: false,
      }]);

      const HARNESS = makeHarness({
        held: [],
        roles: [fakeRole('a')],
        database: SERVICE,
        break_set: true,
      });

      await runRestore(HARNESS.bot, {
        guild_id: GUILD_ID,
        user_id: USER_ID,
        rearms_left: 0,
        seen: null,
      });

      expect(
        latestPendingSnapshot(SERVICE.getDb(), GUILD_ID, USER_ID)
      ).not.toBeNull();
      expect(HARNESS.dm_sent).toHaveLength(0);
      SERVICE.close();
    });
});

describe('pending rescan', (): void => {
  it('re-arms one job per pending member', (): void => {
    const SERVICE = openTemp();
    insertSnapshot(SERVICE, [{
      id: 'a',
      name: 'alpha',
      managed: false,
    }], 'uA');
    insertSnapshot(SERVICE, [{
      id: 'b',
      name: 'beta',
      managed: false,
    }], 'uB');
    insertSnapshot(SERVICE, [{
      id: 'c',
      name: 'gamma',
      managed: false,
    }], 'uB', TAKEN_AT + 1);

    const HARNESS = makeHarness({
      held: [],
      roles: [],
      database: SERVICE,
    });

    expect(rescanPendingRestores(HARNESS.bot)).toBe(2);

    const NAMES = HARNESS.scheduled.map(
      (job: ScheduledCall): string => {
        return job.name;
      }
    ).sort();

    expect(NAMES).toEqual([
      `roles:restore:${GUILD_ID}:uA`,
      `roles:restore:${GUILD_ID}:uB`,
    ]);

    for (const _job of HARNESS.scheduled) {
      expect((_job.payload as RestorePayload).seen).toBeNull();
    }
    SERVICE.close();
  });

  it('arms nothing when restore is disabled', (): void => {
    const SERVICE = openTemp();
    insertSnapshot(SERVICE, [{
      id: 'a',
      name: 'alpha',
      managed: false,
    }]);

    const HARNESS = makeHarness({
      held: [],
      roles: [],
      config: { restore: { enabled: false } },
      database: SERVICE,
    });

    expect(rescanPendingRestores(HARNESS.bot)).toBe(0);
    expect(HARNESS.scheduled).toHaveLength(0);
    SERVICE.close();
  });

  it('runs a past-due one-shot immediately through the real scheduler',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      insertSnapshot(SERVICE, [{
        id: 'a',
        name: 'alpha',
        managed: false,
      }]);

      const SCHEDULER = new NanoScheduler();

      SCHEDULER.attachPersistence({
        saveJob: (): void => {
          return;
        },
        deleteJob: (): void => {
          return;
        },
        loadJobs: (): never[] => {
          return [];
        },
      });

      const HARNESS = makeHarness({
        held: [],
        roles: [fakeRole('a')],
        config: { restore: { settle_window_s: 0 } },
        database: SERVICE,
        real_scheduler: SCHEDULER,
      });

      expect(rescanPendingRestores(HARNESS.bot)).toBe(1);

      await new Promise((resolve: (value: unknown) => void): void => {
        setTimeout(resolve, IMMEDIATE_WAIT_MS);
      });

      expect(HARNESS.set_calls).toHaveLength(1);
      expect(HARNESS.set_calls[0].target).toEqual(['a']);
      expect(
        latestPendingSnapshot(SERVICE.getDb(), GUILD_ID, USER_ID)
      ).toBeNull();
      SERVICE.close();
    });
});
