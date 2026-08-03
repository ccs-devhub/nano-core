import type { RolesConfig } from './config.js';
import { TEXT_ROLES_DB_REQUIRED } from './constants.js';
import { recordGrants, removeGrants } from './ledger.js';
import { SuppressionMap } from './suppression.js';

import type { Client, NanoResult } from '@ccs-devhub/nano-core';
import {
  err,
  getModuleLogger,
  runSafe,
  SerialQueue,
  setMemberRoles
} from '@ccs-devhub/nano-core';

/**
 * The ONE shared write path (R1/R2/R3/L1): every grant or revoke
 * this module performs flows through applyRoleChange. Refusals are
 * decided BEFORE any mutation, the member's expected set stamps
 * the N7 suppression map, the mutation is a single PATCH through
 * the core setMemberRoles, and the ledger records the delta. All
 * work for one member is serialized behind a per-member queue
 * (B15); different members never wait on each other.
 */

const MODULE_NAME = 'roles';

export type RoleChangeSource =
  | 'panel'
  | 'rule'
  | 'manual'
  | 'restore'
  | 'tier'
  | 'entry';

/** A role delta: ids to grant and ids to revoke, one PATCH. */
export interface RoleChange {
  add?: string[];
  remove?: string[];
}

export type RefusalReason =
  | 'missing'
  | 'everyone'
  | 'managed'
  | 'sanction'
  | 'above_bot';

/**
 * R3 only: the restore path re-applies ACTIVE sanctions inside the
 * same PATCH, so ids the moderation module names as live sanctions
 * pass the sanction refusal. Every other source leaves this empty
 * (B14: sanction roles stay moderation-owned).
 */
export interface RoleChangeOptions {
  allow_sanctions?: string[];
}

export interface RoleChangeReport {
  guild_id: string;
  user_id: string;
  applied_add: string[];
  applied_remove: string[];
  refused: { role_id: string; reason: RefusalReason }[];
  /** True when nothing needed a PATCH (already in the end state). */
  noop: boolean;
}

/* Module-owned instances (PF4); cleared on disable (PF17). */
export const ROLES_QUEUE = new SerialQueue();
export const ROLES_SUPPRESSION = new SuppressionMap();

type RuleReevaluator = (
  bot: Client,
  guild_id: string,
  user_id: string
) => Promise<void>;

let rule_reevaluator: RuleReevaluator | null = null;

/** Box-4 wiring: rule-runtime registers itself here at load. */
export function setRuleReevaluator(fn: RuleReevaluator): void {
  rule_reevaluator = fn;
}

/** Minimal live-role view the refusal matrix needs. */
interface LiveRole {
  id: string;
  managed: boolean;
  position: number;
}

/**
 * The refusal matrix, pure and API-free: managed roles, @everyone,
 * configured sanction roles (moderation-owned, B14) and anything
 * at or above the bot's own highest role are never touched.
 */
export function refusalReason(
  role: LiveRole | null,
  role_id: string,
  guild_id: string,
  sanction_roles: string[],
  bot_highest_position: number
): RefusalReason | null {
  if (role_id === guild_id) {
    return 'everyone';
  }

  if (!role) {
    return 'missing';
  }

  if (role.managed) {
    return 'managed';
  }

  if (sanction_roles.includes(role_id)) {
    return 'sanction';
  }

  if (role.position >= bot_highest_position) {
    return 'above_bot';
  }
  return null;
}

async function liveRole(
  guild: {
    roles: {
      cache: { get(id: string): LiveRole | undefined };
      fetch(id: string): Promise<LiveRole | null>;
    };
  },
  role_id: string
): Promise<LiveRole | null> {
  const CACHED = guild.roles.cache.get(role_id);

  if (CACHED) {
    return CACHED;
  }

  try {
    return await guild.roles.fetch(role_id);
  } catch {
    return null;
  }
}

export async function applyRoleChange(
  bot: Client,
  guild_id: string,
  user_id: string,
  change: RoleChange,
  source: RoleChangeSource,
  actor?: string,
  options: RoleChangeOptions = {}
): Promise<NanoResult<RoleChangeReport>> {
  const DATABASE = bot.services.database;

  if (!DATABASE) {
    return err(TEXT_ROLES_DB_REQUIRED);
  }

  const CONFIG = bot.services.guild_store
    .getGuildModuleConfig<RolesConfig>(guild_id, MODULE_NAME);
  const ALLOWED = options.allow_sanctions ?? [];
  const SANCTION_ROLES = CONFIG.sanction_roles.filter(
    (role_id: string): boolean => {
      return !ALLOWED.includes(role_id);
    }
  );

  return ROLES_QUEUE.run(
    `${guild_id}:${user_id}`,
    (): Promise<NanoResult<RoleChangeReport>> => {
      return runSafe(async (): Promise<RoleChangeReport> => {
        const GUILD = await bot.guilds.fetch(guild_id);
        /* Read current BEFORE writing — the queue serializes this
           member, so the read cannot race our own writes. */
        const MEMBER = await GUILD.members.fetch(user_id);
        const HELD: string[] = MEMBER.roles.cache.map(
          (role: { id: string }): string => {
            return role.id;
          }
        );
        const BOT_HIGHEST =
          GUILD.members.me?.roles.highest.position ?? 0;

        const REFUSED: { role_id: string; reason: RefusalReason }[] =
          [];
        const ADD: string[] = [];
        const REMOVE: string[] = [];

        for (const _role_id of change.add ?? []) {
          const ROLE = await liveRole(GUILD, _role_id);
          const REASON = refusalReason(
            ROLE,
            _role_id,
            guild_id,
            SANCTION_ROLES,
            BOT_HIGHEST
          );

          if (REASON) {
            REFUSED.push({ role_id: _role_id, reason: REASON });
          } else if (!HELD.includes(_role_id)) {
            ADD.push(_role_id);
          }
        }

        for (const _role_id of change.remove ?? []) {
          const ROLE = await liveRole(GUILD, _role_id);
          const REASON = refusalReason(
            ROLE,
            _role_id,
            guild_id,
            SANCTION_ROLES,
            BOT_HIGHEST
          );

          if (REASON && REASON !== 'missing') {
            /* A deleted role cannot be revoked via PATCH anyway —
               drop it from the target silently. */
            REFUSED.push({ role_id: _role_id, reason: REASON });
          } else if (HELD.includes(_role_id)) {
            REMOVE.push(_role_id);
          }
        }

        const REPORT: RoleChangeReport = {
          guild_id,
          user_id,
          applied_add: ADD,
          applied_remove: REMOVE,
          refused: REFUSED,
          noop: ADD.length === 0 && REMOVE.length === 0,
        };

        if (REPORT.noop) {
          return REPORT;
        }

        const TARGET = HELD
          .filter((role_id: string): boolean => {
            return !REMOVE.includes(role_id);
          })
          .concat(ADD);

        /* N7: stamp the expected set BEFORE the PATCH. */
        ROLES_SUPPRESSION.stamp(guild_id, user_id, TARGET);

        const PATCHED = await setMemberRoles(
          bot,
          guild_id,
          user_id,
          TARGET,
          actor ? `roles:${source} by ${actor}` : `roles:${source}`
        );

        if (!PATCHED.ok) {
          throw new Error(PATCHED.error);
        }

        const NOW = Date.now();
        recordGrants(
          DATABASE.getDb(),
          ADD.map((role_id: string): {
            guild_id: string;
            user_id: string;
            role_id: string;
            source: RoleChangeSource;
            granted_by: string | null;
            granted_at: number;
          } => {
            return {
              guild_id,
              user_id,
              role_id,
              source,
              granted_by: actor ?? null,
              granted_at: NOW,
            };
          })
        );
        removeGrants(DATABASE.getDb(), guild_id, user_id, REMOVE);

        if (source !== 'rule' && rule_reevaluator) {
          /* One cascade step per external change; deeper chains
             settle in the R5 sweep. A re-eval failure never breaks
             the change that triggered it. */
          try {
            await rule_reevaluator(bot, guild_id, user_id);
          } catch (error: unknown) {
            getModuleLogger(MODULE_NAME).warn(
              { guild_id, user_id, error: String(error) },
              'Rule re-evaluation after a change failed'
            );
          }
        }

        await resyncMemberDividers();

        getModuleLogger(MODULE_NAME).info(
          {
            guild_id,
            user_id,
            source,
            add: ADD,
            remove: REMOVE,
            refused: REFUSED,
          },
          'Role change applied'
        );
        return REPORT;
      });
    }
  );
}

/* Box 7 seam: single-member divider resync (DIVIDER LAW v22) runs
   here after every ledger write. Deliberate no-op until the
   divider engine lands. */
async function resyncMemberDividers(): Promise<void> {
  return;
}
