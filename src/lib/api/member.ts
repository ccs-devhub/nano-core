import type { Client, GuildMember, Role } from 'discord.js';

import { requireGuild } from '@/api/guild.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/** Plain-JSON view of a guild member, safe for logs and AI consumers. */
export interface MemberSummary {
  id: string;
  username: string;
  display_name: string;
  is_bot: boolean;
  joined_at: string | null;
  role_ids: string[];
}

export interface BanOptions {
  reason?: string;
  delete_message_seconds?: number;
}

const DEFAULT_LIST_LIMIT = 50;

export function toMemberSummary(member: GuildMember): MemberSummary {
  return {
    id: member.id,
    username: member.user.username,
    display_name: member.displayName,
    is_bot: member.user.bot,
    joined_at: member.joinedAt?.toISOString() ?? null,
    role_ids: member.roles.cache.map((role: Role): string => {
      return role.id;
    }),
  };
}

/** Fetch a single guild member by user id. */
export async function getMember(
  bot: Client,
  guild_id: string,
  user_id: string
): Promise<NanoResult<MemberSummary>> {
  return runSafe(async (): Promise<MemberSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const MEMBER = await GUILD.members.fetch(user_id);
    return toMemberSummary(MEMBER);
  });
}

/**
 * List guild members. Requires the privileged GuildMembers gateway
 * intent to be enabled in nano.config.json and the developer portal.
 */
export async function listMembers(
  bot: Client,
  guild_id: string,
  limit: number = DEFAULT_LIST_LIMIT
): Promise<NanoResult<MemberSummary[]>> {
  return runSafe(async (): Promise<MemberSummary[]> => {
    const GUILD = await requireGuild(bot, guild_id);
    const MEMBERS = await GUILD.members.fetch({ limit });
    return Array.from(MEMBERS.values()).map(toMemberSummary);
  });
}

/** Kick a member from the guild. */
export async function kickMember(
  bot: Client,
  guild_id: string,
  user_id: string,
  reason?: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    const MEMBER = await GUILD.members.fetch(user_id);
    await MEMBER.kick(reason);
    return user_id;
  });
}

/** Ban a user, optionally pruning their recent messages. */
export async function banMember(
  bot: Client,
  guild_id: string,
  user_id: string,
  options: BanOptions = {}
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    await GUILD.bans.create(user_id, {
      reason: options.reason,
      deleteMessageSeconds: options.delete_message_seconds,
    });
    return user_id;
  });
}

/** Lift a ban by user id. */
export async function unbanMember(
  bot: Client,
  guild_id: string,
  user_id: string,
  reason?: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    await GUILD.bans.remove(user_id, reason);
    return user_id;
  });
}

/** Timeout a member for `duration_ms`; pass null to clear the timeout. */
export async function timeoutMember(
  bot: Client,
  guild_id: string,
  user_id: string,
  duration_ms: number | null,
  reason?: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    const MEMBER = await GUILD.members.fetch(user_id);
    await MEMBER.timeout(duration_ms, reason);
    return user_id;
  });
}

/** Change (or clear, with null) a member's nickname. */
export async function setNickname(
  bot: Client,
  guild_id: string,
  user_id: string,
  nickname: string | null,
  reason?: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    const MEMBER = await GUILD.members.fetch(user_id);
    await MEMBER.setNickname(nickname, reason);
    return user_id;
  });
}
