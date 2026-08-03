import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseService } from '@/services/database.js';

import { ROLES_SUPPRESSION } from '@modules/roles/apply-role-change.js';
import { ROLES_CONFIG_SCHEMA } from '@modules/roles/config.js';
import { memberLedger, recordGrants } from '@modules/roles/ledger.js';
import type { MemberLike } from '@modules/roles/rule-runtime.js';
import {
  handleMemberUpdate,
  reevaluateMember
} from '@modules/roles/rule-runtime.js';
import type { RuleFacts } from '@modules/roles/rules.js';
import {
  planRuleChanges,
  ruleConditionHolds
} from '@modules/roles/rules.js';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'modules',
  'roles',
  'migrations'
);
const GUILD_ID = 'g1';
const USER_ID = 'u1';
const KEY_A = '200000000000000001';
const KEY_B = '200000000000000002';
const KEY_C = '200000000000000003';
const DERIVED = '200000000000000004';
const MANAGED = '200000000000000005';
const DRIFTED = '200000000000000006';
const BOT_TOP = 9;

function facts(overrides: Partial<RuleFacts> = {}): RuleFacts {
  return { role_ids: [], is_bot: false, level: null, ...overrides };
}

function viajeroRule(
  enforce: 'grant_only' | 'strict'
): Record<string, unknown> {
  return {
    when: {
      kind: 'holds_count',
      role_ids: [KEY_A, KEY_B, KEY_C],
      at_least: 2,
    },
    then: { action: 'grant', role_id: DERIVED },
    enforce,
  };
}

function parsedRules(
  rules: Record<string, unknown>[]
): ReturnType<typeof ROLES_CONFIG_SCHEMA.parse>['rules'] {
  return ROLES_CONFIG_SCHEMA.parse({ rules }).rules;
}

function openTemp(): DatabaseService {
  const ROOT = mkdtempSync(join(tmpdir(), 'nano-roles-rules-'));
  const RESULT = DatabaseService.open({ driver: 'sqlite' }, ROOT);

  if (!RESULT.ok) {
    throw new Error(RESULT.error);
  }

  const MIGRATED = RESULT.data.runModuleMigrations(
    'roles',
    MIGRATIONS_DIR
  );

  if (!MIGRATED.ok) {
    throw new Error(MIGRATED.error);
  }
  return RESULT.data;
}

interface FakeSetup {
  database: DatabaseService;
  held: string[];
  config: Record<string, unknown>;
  audit_executor?: string;
}

function makeBot(
  setup: FakeSetup
): { bot: Client; member: MemberLike; role_sets: string[][] } {
  const ROLE_SETS: string[][] = [];
  let held = [...setup.held];
  const ROLE_CACHE = new Map(
    [KEY_A, KEY_B, KEY_C, DERIVED, DRIFTED].map(
      (id: string): [string, {
        id: string;
        managed: boolean;
        position: number;
      }] => {
        return [id, { id, managed: false, position: 1 }];
      }
    )
  );
  ROLE_CACHE.set(MANAGED, { id: MANAGED, managed: true, position: 1 });
  const CACHE_VIEW = {
    map: <T>(cb: (role: { id: string }) => T): T[] => {
      return held.map((id: string): T => {
        return cb({ id });
      });
    },
  };
  const MEMBER = {
    id: USER_ID,
    user: { bot: false, createdTimestamp: Date.now() },
    joinedTimestamp: Date.now(),
    guild: {
      id: GUILD_ID,
      roles: { cache: ROLE_CACHE },
    },
    roles: {
      get cache(): typeof CACHE_VIEW {
        return CACHE_VIEW;
      },
      set: async (role_ids: string[]): Promise<{
        roles: { cache: typeof CACHE_VIEW };
      }> => {
        ROLE_SETS.push(role_ids);
        held = [...role_ids];
        return { roles: { cache: CACHE_VIEW } };
      },
    },
  };
  const GUILD = {
    id: GUILD_ID,
    roles: {
      cache: ROLE_CACHE,
      fetch: async (): Promise<null> => {
        return null;
      },
    },
    members: {
      fetch: async (): Promise<typeof MEMBER> => {
        return MEMBER;
      },
      me: { roles: { highest: { position: BOT_TOP } } },
    },
    fetchAuditLogs: async (): Promise<{
      entries: Map<number, {
        action: number;
        targetId: string;
        executorId: string | null;
        reason: null;
        createdTimestamp: number;
      }>;
    }> => {
      return {
        entries: new Map([[1, {
          action: 25,
          targetId: USER_ID,
          executorId: setup.audit_executor ?? null,
          reason: null,
          createdTimestamp: Date.now(),
        }]]),
      };
    },
  };
  const CONFIG = ROLES_CONFIG_SCHEMA.parse(setup.config);
  const BOT = {
    user: { id: 'bot1' },
    nano: {
      getModuleApi: (): undefined => {
        return undefined;
      },
    },
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
  return {
    bot: BOT as unknown as Client,
    member: MEMBER as unknown as MemberLike,
    role_sets: ROLE_SETS,
  };
}

afterEach((): void => {
  ROLES_SUPPRESSION.clear();
});

describe('ruleConditionHolds', (): void => {
  it('evaluates every when shape, level blind means FALSE',
    (): void => {
      const RULES = parsedRules([
        viajeroRule('strict'),
        {
          when: { kind: 'holds_any', role_ids: [KEY_A] },
          then: { action: 'grant', role_id: DERIVED },
        },
        {
          when: { kind: 'holds_all', role_ids: [KEY_A, KEY_B] },
          then: { action: 'grant', role_id: DERIVED },
        },
        {
          when: { kind: 'is_bot' },
          then: { action: 'revoke', role_id: DERIVED },
        },
        {
          when: { kind: 'level_at_least', level: 5 },
          then: { action: 'grant', role_id: DERIVED },
        },
      ]);

      expect(ruleConditionHolds(
        RULES[0].when,
        facts({ role_ids: [KEY_A, KEY_C] })
      )).toBe(true);
      expect(ruleConditionHolds(
        RULES[0].when,
        facts({ role_ids: [KEY_A] })
      )).toBe(false);
      expect(ruleConditionHolds(RULES[1].when, facts({
        role_ids: [KEY_A],
      }))).toBe(true);
      expect(ruleConditionHolds(RULES[2].when, facts({
        role_ids: [KEY_A],
      }))).toBe(false);
      expect(ruleConditionHolds(RULES[3].when, facts({
        is_bot: true,
      }))).toBe(true);
      expect(ruleConditionHolds(RULES[4].when, facts({ level: null })))
        .toBe(false);
      expect(ruleConditionHolds(RULES[4].when, facts({ level: 5 })))
        .toBe(true);
    });
});

describe('planRuleChanges', (): void => {
  it('grants a matched rule and stays idempotent when held',
    (): void => {
      const RULES = parsedRules([viajeroRule('strict')]);
      const GRANT = planRuleChanges(
        RULES,
        facts({ role_ids: [KEY_A, KEY_B] }),
        {}
      );

      expect(GRANT.add).toEqual([DERIVED]);
      expect(GRANT.remove).toEqual([]);

      const HELD = planRuleChanges(
        RULES,
        facts({ role_ids: [KEY_A, KEY_B, DERIVED] }),
        {}
      );

      expect(HELD.add).toEqual([]);
      expect(HELD.remove).toEqual([]);
    });

  it('enforces grant_only: only its own grants fall on a flip',
    (): void => {
      const RULES = parsedRules([viajeroRule('grant_only')]);
      const RULE_OWNED = planRuleChanges(
        RULES,
        facts({ role_ids: [KEY_A, DERIVED] }),
        { [DERIVED]: 'rule' }
      );

      expect(RULE_OWNED.remove).toEqual([DERIVED]);

      const MANUAL_OWNED = planRuleChanges(
        RULES,
        facts({ role_ids: [KEY_A, DERIVED] }),
        { [DERIVED]: 'manual' }
      );

      expect(MANUAL_OWNED.remove).toEqual([]);
    });

  it('enforces strict: the flip revokes regardless of source (Q5)',
    (): void => {
      const RULES = parsedRules([viajeroRule('strict')]);
      const PLAN = planRuleChanges(
        RULES,
        facts({ role_ids: [KEY_A, DERIVED] }),
        { [DERIVED]: 'manual' }
      );

      expect(PLAN.remove).toEqual([DERIVED]);
    });

  it('lets a matched revoke rule win over a matched grant',
    (): void => {
      const RULES = parsedRules([
        {
          when: { kind: 'holds_any', role_ids: [KEY_A] },
          then: { action: 'grant', role_id: DERIVED },
        },
        {
          when: { kind: 'is_bot' },
          then: { action: 'revoke', role_id: DERIVED },
        },
      ]);
      const PLAN = planRuleChanges(
        RULES,
        facts({ role_ids: [KEY_A, DERIVED], is_bot: true }),
        {}
      );

      expect(PLAN.remove).toEqual([DERIVED]);
      expect(PLAN.add).toEqual([]);
    });

  it('keeps a role when any grant rule for it still matches',
    (): void => {
      const RULES = parsedRules([
        viajeroRule('strict'),
        {
          when: { kind: 'holds_any', role_ids: [KEY_C] },
          then: { action: 'grant', role_id: DERIVED },
        },
      ]);
      const PLAN = planRuleChanges(
        RULES,
        facts({ role_ids: [KEY_C, DERIVED] }),
        {}
      );

      expect(PLAN.remove).toEqual([]);
    });

  it('flags level-blind plans without acting on them', (): void => {
    const RULES = parsedRules([{
      when: { kind: 'level_at_least', level: 7 },
      then: { action: 'grant', role_id: DERIVED },
    }]);
    const PLAN = planRuleChanges(RULES, facts({ level: null }), {});

    expect(PLAN.level_blind).toBe(true);
    expect(PLAN.add).toEqual([]);
  });
});

describe('reevaluateMember', (): void => {
  it('derives VIAJERO live and the cascade stops after one step',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const { bot: BOT, role_sets: SETS } = makeBot({
        database: SERVICE,
        held: [KEY_A, KEY_B],
        config: { rules: [viajeroRule('strict')] },
      });

      await reevaluateMember(BOT, GUILD_ID, USER_ID);

      expect(SETS).toHaveLength(1);
      expect(SETS[0]).toContain(DERIVED);

      const ROWS = memberLedger(SERVICE.getDb(), GUILD_ID, USER_ID);

      expect(ROWS).toHaveLength(1);
      expect(ROWS[0].role_id).toBe(DERIVED);
      expect(ROWS[0].source).toBe('rule');
      SERVICE.close();
    });
});

describe('handleMemberUpdate drift capture', (): void => {
  it('skips suppressed self-writes entirely',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const { bot: BOT, member: MEMBER } = makeBot({
        database: SERVICE,
        held: [DRIFTED],
        config: {},
      });
      ROLES_SUPPRESSION.stamp(GUILD_ID, USER_ID, [DRIFTED]);

      await handleMemberUpdate(BOT, MEMBER);

      expect(memberLedger(SERVICE.getDb(), GUILD_ID, USER_ID))
        .toHaveLength(0);
      SERVICE.close();
    });

  it('adopts unledgered holds with attribution, skips managed, ' +
    'releases stale rows', async (): Promise<void> => {
    const SERVICE = openTemp();
    recordGrants(SERVICE.getDb(), [{
      guild_id: GUILD_ID,
      user_id: USER_ID,
      role_id: KEY_A,
      source: 'panel',
      granted_by: null,
      granted_at: 1,
    }]);

    const { bot: BOT, member: MEMBER } = makeBot({
      database: SERVICE,
      held: [DRIFTED, MANAGED],
      config: {},
      audit_executor: 'mod9',
    });

    await handleMemberUpdate(BOT, MEMBER);

    const ROWS = memberLedger(SERVICE.getDb(), GUILD_ID, USER_ID);

    expect(ROWS).toHaveLength(1);
    expect(ROWS[0].role_id).toBe(DRIFTED);
    expect(ROWS[0].source).toBe('manual');
    expect(ROWS[0].granted_by).toBe('mod9');
    SERVICE.close();
  });
});
