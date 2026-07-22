import type {
  Client,
  GuildMember,
  PermissionResolvable
} from 'discord.js';
import { PermissionsBitField } from 'discord.js';

import { requireGuild } from '@/api/guild.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/** Result of a permission check, with the human-readable missing set. */
export interface PermissionCheck {
  allowed: boolean;
  missing: string[];
}

export interface HierarchyCheck {
  actor_is_higher: boolean;
  target_manageable: boolean;
  target_kickable: boolean;
  target_bannable: boolean;
  target_moderatable: boolean;
}

/** Does the BOT hold these permissions (channel-scoped when given)? */
export async function botHasPermissions(
  bot: Client,
  guild_id: string,
  perms: PermissionResolvable[],
  channel_id?: string
): Promise<NanoResult<PermissionCheck>> {
  return runSafe(async (): Promise<PermissionCheck> => {
    const GUILD = await requireGuild(bot, guild_id);
    const ME = await GUILD.members.fetchMe();
    return checkMemberPermissions(ME, perms, channel_id);
  });
}

/** Does a USER hold these permissions (channel-scoped when given)? */
export async function userHasPermissions(
  bot: Client,
  guild_id: string,
  user_id: string,
  perms: PermissionResolvable[],
  channel_id?: string
): Promise<NanoResult<PermissionCheck>> {
  return runSafe(async (): Promise<PermissionCheck> => {
    const GUILD = await requireGuild(bot, guild_id);
    const MEMBER = await GUILD.members.fetch(user_id);
    return checkMemberPermissions(MEMBER, perms, channel_id);
  });
}

/**
 * Role-hierarchy safety: is the actor above the target, and can the
 * BOT act on the target at all (manage/kick/ban/timeout)?
 */
export async function checkRoleHierarchy(
  bot: Client,
  guild_id: string,
  actor_id: string,
  target_id: string
): Promise<NanoResult<HierarchyCheck>> {
  return runSafe(async (): Promise<HierarchyCheck> => {
    const GUILD = await requireGuild(bot, guild_id);
    const ACTOR = await GUILD.members.fetch(actor_id);
    const TARGET = await GUILD.members.fetch(target_id);
    const COMPARISON = ACTOR.roles.highest
      .comparePositionTo(TARGET.roles.highest);

    return {
      actor_is_higher: COMPARISON > 0,
      target_manageable: TARGET.manageable,
      target_kickable: TARGET.kickable,
      target_bannable: TARGET.bannable,
      target_moderatable: TARGET.moderatable,
    };
  });
}

function checkMemberPermissions(
  member: GuildMember,
  perms: PermissionResolvable[],
  channel_id?: string
): PermissionCheck {
  const SCOPE = channel_id
    ? member.guild.channels.cache.get(channel_id)
      ?.permissionsFor(member) ?? member.permissions
    : member.permissions;
  const MISSING = SCOPE.missing(
    new PermissionsBitField(perms)
  );

  return { allowed: MISSING.length === 0, missing: MISSING };
}
