import type {
  Client,
  ColorResolvable,
  PermissionFlagsBits,
  Role,
  RolePosition
} from 'discord.js';

import { assertPermissionName } from '@/api/channel.js';
import { requireGuild } from '@/api/guild.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/** Ownership tags of a managed role, decoded for AI consumers. */
export interface RoleTagsSummary {
  bot_id: string | null;
  integration_id: string | null;
  premium_subscriber: boolean;
}

/** Plain-JSON view of a role, safe for logs and AI consumers. */
export interface RoleSummary {
  id: string;
  name: string;
  color: string;
  position: number;
  hoist: boolean;
  mentionable: boolean;
  managed: boolean;
  tags: RoleTagsSummary;
  permissions: string[];
}

export interface RoleOptions {
  name?: string;
  color?: string;
  hoist?: boolean;
  mentionable?: boolean;
  permissions?: string[];
  reason?: string;
}

/** One row of a bulk role reorder. */
export interface RolePositionInput {
  role_id: string;
  position: number;
}

function toRoleTagsSummary(role: Role): RoleTagsSummary {
  return {
    bot_id: role.tags?.botId ?? null,
    integration_id: role.tags?.integrationId ?? null,
    premium_subscriber: Boolean(
      role.tags && 'premiumSubscriberRole' in role.tags
    ),
  };
}

export function toRoleSummary(role: Role): RoleSummary {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    position: role.position,
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
    tags: toRoleTagsSummary(role),
    permissions: role.permissions.toArray(),
  };
}

function resolvePermissionList(
  names?: string[]
): (keyof typeof PermissionFlagsBits)[] | undefined {
  if (names === undefined) {
    return undefined;
  }
  return names.map(assertPermissionName);
}

/** List every role of a guild, highest position first. */
export async function listRoles(
  bot: Client,
  guild_id: string
): Promise<NanoResult<RoleSummary[]>> {
  return runSafe(async (): Promise<RoleSummary[]> => {
    const GUILD = await requireGuild(bot, guild_id);
    const ROLES = await GUILD.roles.fetch();
    return Array.from(ROLES.values())
      .map(toRoleSummary)
      .sort((a: RoleSummary, b: RoleSummary): number => {
        return b.position - a.position;
      });
  });
}

/** Fetch a single role by id. */
export async function getRole(
  bot: Client,
  guild_id: string,
  role_id: string
): Promise<NanoResult<RoleSummary>> {
  return runSafe(async (): Promise<RoleSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const ROLE = await GUILD.roles.fetch(role_id);

    if (!ROLE) {
      throw new Error(`Role '${role_id}' not found.`);
    }
    return toRoleSummary(ROLE);
  });
}

/**
 * Create a role. `color` accepts hex strings like '#5865F2';
 * `permissions` accepts PermissionFlagsBits names like 'SendMessages'
 * (omitted = zero permissions ONLY when @everyone is zero, since
 * Discord copies @everyone's current set on permissionless creates -
 * pass an explicit array to be exact).
 */
export async function createRole(
  bot: Client,
  guild_id: string,
  options: RoleOptions
): Promise<NanoResult<RoleSummary>> {
  return runSafe(async (): Promise<RoleSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const ROLE = await GUILD.roles.create({
      name: options.name,
      color: options.color as ColorResolvable | undefined,
      hoist: options.hoist,
      mentionable: options.mentionable,
      permissions: resolvePermissionList(options.permissions),
      reason: options.reason,
    });
    return toRoleSummary(ROLE);
  });
}

/**
 * Edit a role's name, color, hoist, mentionable, or permissions.
 * `permissions` REPLACES the whole set when given (empty array strips
 * every permission - the @everyone zero-base move).
 */
export async function editRole(
  bot: Client,
  guild_id: string,
  role_id: string,
  options: RoleOptions
): Promise<NanoResult<RoleSummary>> {
  return runSafe(async (): Promise<RoleSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const ROLE = await GUILD.roles.fetch(role_id);

    if (!ROLE) {
      throw new Error(`Role '${role_id}' not found.`);
    }

    const EDITED = await ROLE.edit({
      name: options.name,
      color: options.color as ColorResolvable | undefined,
      hoist: options.hoist,
      mentionable: options.mentionable,
      permissions: resolvePermissionList(options.permissions),
      reason: options.reason,
    });
    return toRoleSummary(EDITED);
  });
}

/**
 * Reorder roles in ONE bulk call (a single PATCH; Discord emits no
 * audit-log entry for it - verify by reading the list back).
 * Only positions BELOW the bot's own top role can move.
 */
export async function setRolePositions(
  bot: Client,
  guild_id: string,
  positions: RolePositionInput[]
): Promise<NanoResult<RoleSummary[]>> {
  return runSafe(async (): Promise<RoleSummary[]> => {
    const GUILD = await requireGuild(bot, guild_id);
    await GUILD.roles.setPositions(
      positions.map((entry: RolePositionInput): RolePosition => {
        return { role: entry.role_id, position: entry.position };
      })
    );
    const ROLES = await GUILD.roles.fetch();
    return Array.from(ROLES.values())
      .map(toRoleSummary)
      .sort((a: RoleSummary, b: RoleSummary): number => {
        return b.position - a.position;
      });
  });
}

/** Delete a role by id. */
export async function deleteRole(
  bot: Client,
  guild_id: string,
  role_id: string,
  reason?: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    const ROLE = await GUILD.roles.fetch(role_id);

    if (!ROLE) {
      throw new Error(`Role '${role_id}' not found.`);
    }

    await ROLE.delete(reason);
    return role_id;
  });
}

/** Grant a role to a guild member. */
export async function addRoleToMember(
  bot: Client,
  guild_id: string,
  user_id: string,
  role_id: string,
  reason?: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    const MEMBER = await GUILD.members.fetch(user_id);
    await MEMBER.roles.add(role_id, reason);
    return role_id;
  });
}

/** Take a role away from a guild member. */
export async function removeRoleFromMember(
  bot: Client,
  guild_id: string,
  user_id: string,
  role_id: string,
  reason?: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    const MEMBER = await GUILD.members.fetch(user_id);
    await MEMBER.roles.remove(role_id, reason);
    return role_id;
  });
}
