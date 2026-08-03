import type { RolesRule } from './config.js';

/**
 * R2: the pure rule engine. Facts in, a role delta out — no Discord,
 * no database, no clock. THE ENFORCE LAW: grant_only rules revoke
 * ONLY what the engine itself granted (ledger source 'rule'), manual
 * and panel grants are never rule-revoked; 'strict' rules revoke on
 * a condition flip regardless of source — the sanctioned use is the
 * VIAJERO key-derivation rule (Q5, no grandfathering).
 */

export interface RuleFacts {
  role_ids: string[];
  is_bot: boolean;
  /**
   * null = the leveling API is absent or failed (N13): level rules
   * evaluate FALSE and the plan is flagged level_blind — degraded,
   * never wrong-positive.
   */
  level: number | null;
}

/** Does one rule condition hold for these facts? */
export function ruleConditionHolds(
  when: RolesRule['when'],
  facts: RuleFacts
): boolean {
  if (when.kind === 'holds_any') {
    return when.role_ids.some((role_id: string): boolean => {
      return facts.role_ids.includes(role_id);
    });
  }

  if (when.kind === 'holds_all') {
    return when.role_ids.every((role_id: string): boolean => {
      return facts.role_ids.includes(role_id);
    });
  }

  if (when.kind === 'holds_count') {
    const HELD = when.role_ids.filter((role_id: string): boolean => {
      return facts.role_ids.includes(role_id);
    });
    return HELD.length >= when.at_least;
  }

  if (when.kind === 'is_bot') {
    return facts.is_bot;
  }
  return facts.level !== null && facts.level >= when.level;
}

export interface RulePlan {
  add: string[];
  remove: string[];
  /** A level rule existed but the level was unknown (N13 blind). */
  level_blind: boolean;
}

interface TargetState {
  grant_matched: boolean;
  grant_flipped: boolean;
  flip_strict: boolean;
  revoke_matched: boolean;
}

/**
 * Plan the delta for one member. Per target role: a matched revoke
 * rule wins over everything, a matched grant rule holds or adds the
 * role, and a flipped grant rule removes it only under the enforce
 * law above. ledger_sources maps HELD role ids to their ledger
 * source ('rule' rows are the engine's own grants).
 */
export function planRuleChanges(
  rules: RolesRule[],
  facts: RuleFacts,
  ledger_sources: Record<string, string>
): RulePlan {
  const TARGETS = new Map<string, TargetState>();
  let level_blind = false;

  for (const _rule of rules) {
    if (_rule.when.kind === 'level_at_least' && facts.level === null) {
      level_blind = true;
    }

    const MATCHED = ruleConditionHolds(_rule.when, facts);
    const TARGET_ID = _rule.then.role_id;
    let state = TARGETS.get(TARGET_ID);

    if (!state) {
      state = {
        grant_matched: false,
        grant_flipped: false,
        flip_strict: false,
        revoke_matched: false,
      };
      TARGETS.set(TARGET_ID, state);
    }

    if (_rule.then.action === 'grant') {
      if (MATCHED) {
        state.grant_matched = true;
      } else {
        state.grant_flipped = true;

        if (_rule.enforce === 'strict') {
          state.flip_strict = true;
        }
      }
    } else if (MATCHED) {
      state.revoke_matched = true;
    }
  }

  const ADD: string[] = [];
  const REMOVE: string[] = [];

  for (const [_target_id, _state] of TARGETS) {
    const HELD = facts.role_ids.includes(_target_id);

    if (_state.revoke_matched) {
      if (HELD) {
        REMOVE.push(_target_id);
      }
      continue;
    }

    if (_state.grant_matched) {
      if (!HELD) {
        ADD.push(_target_id);
      }
      continue;
    }

    if (_state.grant_flipped && HELD) {
      const RULE_OWNED = ledger_sources[_target_id] === 'rule';

      if (_state.flip_strict || RULE_OWNED) {
        REMOVE.push(_target_id);
      }
    }
  }
  return { add: ADD, remove: REMOVE, level_blind };
}
