import { z } from 'zod';

import type { GuildStore } from '@/services/guild-store.js';

/**
 * PER-GUILD COMMAND GATES — a core CONNECTION, not a feature: one
 * reserved guild-store namespace any guild admin can shape from the
 * dashboard, consulted by the kernel dispatcher before EVERY slash
 * dispatch. A gate keys on a command path ('foo', or a subcommand
 * path like 'foo bar') and may turn the path off for the guild
 * or limit it to specific roles or members. Empty allow lists mean
 * everyone (Discord's own permissions still apply first).
 *
 * THE RECOVERY GUARD: `/module` is NEVER gateable — it is the path
 * that re-enables things when a guild locks itself out.
 */
export const COMMAND_GATES_NAMESPACE = 'command_gates';

export const COMMAND_GATES_VERSION = 1;

export const UNGATEABLE_COMMANDS = ['module'];

const SNOWFLAKE_PATTERN = /^[0-9]{5,25}$/;
const PATH_PATTERN = /^[a-z0-9_-]+( [a-z0-9_-]+){0,2}$/;

export interface CommandGate {
  enabled?: boolean;
  allowed_role_ids?: string[];
  allowed_user_ids?: string[];
}

export type CommandGatesConfig = {
  gates: Record<string, CommandGate>;
};

export const COMMAND_GATES_SCHEMA = z.object({
  gates: z.record(
    z.string().regex(PATH_PATTERN),
    z.object({
      enabled: z.boolean().optional(),
      allowed_role_ids: z.array(
        z.string().regex(SNOWFLAKE_PATTERN)
      ).optional(),
      allowed_user_ids: z.array(
        z.string().regex(SNOWFLAKE_PATTERN)
      ).optional(),
    }).strict()
  ).default({}),
});

/** Boot-time registration of the reserved namespace. */
export function registerCommandGates(store: GuildStore): void {
  store.registerSchema(COMMAND_GATES_NAMESPACE, {
    schema: COMMAND_GATES_SCHEMA,
    config_version: COMMAND_GATES_VERSION,
  });
}

export interface GateActor {
  user_id: string;
  role_ids: string[];
}

export interface GateVerdict {
  allowed: boolean;
  reason?: 'disabled' | 'not_allowed';
}

/**
 * Evaluate the gates for one dispatch. Both the command gate and
 * the exact subcommand-path gate apply — the stricter one wins.
 */
export function evaluateCommandGate(
  config: CommandGatesConfig,
  command_name: string,
  subcommand_path: string | undefined,
  actor: GateActor
): GateVerdict {
  if (UNGATEABLE_COMMANDS.includes(command_name)) {
    return { allowed: true };
  }

  /* Defensive: a clobbered or missing namespace never breaks
     dispatch — no gates means everything is allowed. */
  const GATES = config?.gates ?? {};
  const PATHS = [command_name];

  if (subcommand_path) {
    PATHS.push(`${command_name} ${subcommand_path}`);
  }

  for (const _path of PATHS) {
    const GATE = GATES[_path];

    if (!GATE) {
      continue;
    }

    if (GATE.enabled === false) {
      return { allowed: false, reason: 'disabled' };
    }

    const ROLES = GATE.allowed_role_ids ?? [];
    const USERS = GATE.allowed_user_ids ?? [];

    if (ROLES.length === 0 && USERS.length === 0) {
      continue;
    }

    const USER_OK = USERS.includes(actor.user_id);
    const ROLE_OK = actor.role_ids.some((role_id: string): boolean => {
      return ROLES.includes(role_id);
    });

    if (!USER_OK && !ROLE_OK) {
      return { allowed: false, reason: 'not_allowed' };
    }
  }
  return { allowed: true };
}
