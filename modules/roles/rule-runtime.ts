import {
  applyRoleChange,
  ROLES_SUPPRESSION,
  setRuleReevaluator
} from './apply-role-change.js';
import type { RolesConfig } from './config.js';
import {
  clearMemberLedger,
  memberLedger,
  recordGrants,
  removeGrants
} from './ledger.js';
import type { RuleFacts } from './rules.js';
import { planRuleChanges } from './rules.js';

import type { Client, NanoResult } from '@ccs-devhub/nano-core';
import {
  AuditAttributor,
  auditEntriesFetcher,
  getModuleLogger
} from '@ccs-devhub/nano-core';

/**
 * R2 runtime: single-member rule re-evaluation (the box-2 seam,
 * now real) and drift capture. Drift consults the N7 suppression
 * map FIRST, then adopts held-vs-ledger differences: an unledgered
 * held role becomes a 'manual' row with a lazily attributed actor
 * ('unknown' stays first-class as null), a ledgered role no longer
 * held loses its row. Every adoption re-evaluates the member's
 * rules — through the same write path as everything else.
 */

const MODULE_NAME = 'roles';
/* Discord audit-log action MEMBER_ROLE_UPDATE. */
const MEMBER_ROLE_UPDATE = 25;

let attributor: AuditAttributor | null = null;
let level_blind_count = 0;

/** Health metric: rule evaluations blinded by a missing level API. */
export function ruleLevelBlindCount(): number {
  return level_blind_count;
}

/** onDisable: forget module-owned runtime state. */
export function resetRuleRuntime(): void {
  attributor = null;
  level_blind_count = 0;
}

interface LevelingApi {
  getLevel?(
    guild_id: string,
    user_id: string
  ): Promise<NanoResult<number>> | NanoResult<number>;
}

/** N13: resolve the leveling API lazily at every call site. */
async function memberLevel(
  bot: Client,
  guild_id: string,
  user_id: string
): Promise<number | null> {
  const API = bot.nano.getModuleApi('leveling') as
    LevelingApi | undefined;

  if (!API || typeof API.getLevel !== 'function') {
    return null;
  }

  try {
    const RESULT = await API.getLevel(guild_id, user_id);
    return RESULT.ok ? RESULT.data : null;
  } catch {
    return null;
  }
}

async function memberFacts(
  bot: Client,
  guild_id: string,
  user_id: string,
  needs_level: boolean
): Promise<RuleFacts> {
  const GUILD = await bot.guilds.fetch(guild_id);
  const MEMBER = await GUILD.members.fetch(user_id);
  return {
    role_ids: MEMBER.roles.cache.map(
      (role: { id: string }): string => {
        return role.id;
      }
    ).filter((role_id: string): boolean => {
      return role_id !== guild_id;
    }),
    is_bot: MEMBER.user?.bot ?? false,
    level: needs_level
      ? await memberLevel(bot, guild_id, user_id)
      : null,
  };
}

/**
 * Re-evaluate one member's rules and apply the delta (source
 * 'rule'). Registered as the box-2 seam; rule-sourced changes do
 * not re-trigger it, so cascades run one step per external change
 * and the R5 sweep settles anything deeper.
 */
export async function reevaluateMember(
  bot: Client,
  guild_id: string,
  user_id: string
): Promise<void> {
  const DATABASE = bot.services.database;

  if (!DATABASE) {
    return;
  }

  const CONFIG = bot.services.guild_store
    .getGuildModuleConfig<RolesConfig>(guild_id, MODULE_NAME);

  if (!CONFIG.enabled || CONFIG.rules.length === 0) {
    return;
  }

  const NEEDS_LEVEL = CONFIG.rules.some(
    (rule: RolesConfig['rules'][number]): boolean => {
      return rule.when.kind === 'level_at_least';
    }
  );
  const FACTS = await memberFacts(bot, guild_id, user_id, NEEDS_LEVEL);
  const SOURCES: Record<string, string> = {};

  for (const _row of memberLedger(DATABASE.getDb(), guild_id, user_id)) {
    SOURCES[_row.role_id] = _row.source;
  }

  const PLAN = planRuleChanges(CONFIG.rules, FACTS, SOURCES);

  if (PLAN.level_blind) {
    level_blind_count += 1;
  }

  if (PLAN.add.length === 0 && PLAN.remove.length === 0) {
    return;
  }

  const APPLIED = await applyRoleChange(
    bot,
    guild_id,
    user_id,
    { add: PLAN.add, remove: PLAN.remove },
    'rule'
  );

  if (!APPLIED.ok) {
    getModuleLogger(MODULE_NAME).warn(
      { guild_id, user_id, error: APPLIED.error },
      'Rule re-evaluation could not apply its delta'
    );
  }
}

/* Wire the box-2 seam the moment this file loads with the module. */
setRuleReevaluator(reevaluateMember);

export interface MemberLike {
  id: string;
  guild: {
    id: string;
    roles: { cache: { get(id: string): { managed: boolean } | undefined } };
  };
  roles: { cache: { map<T>(cb: (role: { id: string }) => T): T[] } };
  user?: { bot?: boolean };
}

/**
 * R2 drift capture (guildMemberUpdate): suppression FIRST, then the
 * held-vs-ledger diff, then a member-only rule re-evaluation.
 */
export async function handleMemberUpdate(
  bot: Client,
  member: MemberLike
): Promise<void> {
  const GUILD_ID = member.guild.id;
  const DATABASE = bot.services.database;

  if (!DATABASE) {
    return;
  }

  const RAW_HELD = member.roles.cache.map(
    (role: { id: string }): string => {
      return role.id;
    }
  );

  /* N7: our own PATCH — never adopt it as drift. */
  if (ROLES_SUPPRESSION.matches(GUILD_ID, member.id, RAW_HELD)) {
    return;
  }

  const CONFIG = bot.services.guild_store
    .getGuildModuleConfig<RolesConfig>(GUILD_ID, MODULE_NAME);

  if (!CONFIG.enabled) {
    return;
  }

  const HELD = RAW_HELD.filter((role_id: string): boolean => {
    return role_id !== GUILD_ID;
  });
  const DB = DATABASE.getDb();
  const LEDGERED = memberLedger(DB, GUILD_ID, member.id);
  const LEDGERED_IDS = LEDGERED.map(
    (row: { role_id: string }): string => {
      return row.role_id;
    }
  );

  const ADOPT = HELD.filter((role_id: string): boolean => {
    if (LEDGERED_IDS.includes(role_id)) {
      return false;
    }

    /* Managed roles belong to integrations, never to the ledger;
       an unresolvable role is skipped rather than guessed at. */
    const ROLE = member.guild.roles.cache.get(role_id);
    return ROLE ? !ROLE.managed : false;
  });
  const RELEASE = LEDGERED_IDS.filter((role_id: string): boolean => {
    return !HELD.includes(role_id);
  });

  if (ADOPT.length === 0 && RELEASE.length === 0) {
    return;
  }

  attributor ??= new AuditAttributor(auditEntriesFetcher(bot));
  let actor: string | null = null;
  const ATTRIBUTED = await attributor.attribute(
    GUILD_ID,
    MEMBER_ROLE_UPDATE,
    member.id
  );

  if (ATTRIBUTED.ok && ATTRIBUTED.data) {
    actor = ATTRIBUTED.data.executor_id;
  }

  const NOW = Date.now();
  recordGrants(DB, ADOPT.map((role_id: string): {
    guild_id: string;
    user_id: string;
    role_id: string;
    source: 'manual';
    granted_by: string | null;
    granted_at: number;
  } => {
    return {
      guild_id: GUILD_ID,
      user_id: member.id,
      role_id,
      source: 'manual',
      granted_by: actor,
      granted_at: NOW,
    };
  }));
  removeGrants(DB, GUILD_ID, member.id, RELEASE);
  getModuleLogger(MODULE_NAME).info(
    {
      guild_id: GUILD_ID,
      user_id: member.id,
      adopted: ADOPT,
      released: RELEASE,
      actor,
    },
    'External role drift adopted into the ledger'
  );

  await reevaluateMember(bot, GUILD_ID, member.id);
}

/** R4 arrives at box 6; the leave path already needs this hook. */
export function forgetMemberLedger(
  bot: Client,
  guild_id: string,
  user_id: string
): number {
  const DATABASE = bot.services.database;

  if (!DATABASE) {
    return 0;
  }
  return clearMemberLedger(DATABASE.getDb(), guild_id, user_id);
}
