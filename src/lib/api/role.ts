import type { Client, ColorResolvable, Role } from 'discord.js';

import { requireGuild } from '@/api/guild.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/** Plain-JSON view of a role, safe for logs and AI consumers. */
export interface RoleSummary {
  id: string;
  name: string;
  color: string;
  position: number;
  hoist: boolean;
  mentionable: boolean;
}

export interface RoleOptions {
  name?: string;
  color?: string;
  hoist?: boolean;
  mentionable?: boolean;
  reason?: string;
}

export function toRoleSummary(role: Role): RoleSummary {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    position: role.position,
    hoist: role.hoist,
    mentionable: role.mentionable,
  };
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

/** Create a role. `color` accepts hex strings like '#5865F2'. */
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
      reason: options.reason,
    });
    return toRoleSummary(ROLE);
  });
}

/** Edit a role's name, color, hoist, or mentionable flags. */
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
      reason: options.reason,
    });
    return toRoleSummary(EDITED);
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
  role_id: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    const MEMBER = await GUILD.members.fetch(user_id);
    await MEMBER.roles.add(role_id);
    return role_id;
  });
}

/** Take a role away from a guild member. */
export async function removeRoleFromMember(
  bot: Client,
  guild_id: string,
  user_id: string,
  role_id: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    const MEMBER = await GUILD.members.fetch(user_id);
    await MEMBER.roles.remove(role_id);
    return role_id;
  });
}
