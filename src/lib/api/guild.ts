import type { Client, Guild, OAuth2Guild } from 'discord.js';

import type { ChannelSummary } from '@/api/channel.js';
import { listChannels } from '@/api/channel.js';
import type { RoleSummary } from '@/api/role.js';
import { listRoles } from '@/api/role.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

export interface GuildSummary {
  id: string;
  name: string;
}

/**
 * Complete plain-JSON picture of a server: identity, channels, and
 * roles. The single entry point for an AI or organizer module that
 * needs to understand a guild before acting on it.
 */
export interface GuildSnapshot {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  created_at: string;
  channels: ChannelSummary[];
  roles: RoleSummary[];
}

/** Fetch a guild or throw. Internal building block for the API layer. */
export async function requireGuild(
  bot: Client,
  guild_id: string
): Promise<Guild> {
  return bot.guilds.fetch(guild_id);
}

/** List every guild the bot is a member of. */
export async function listGuilds(
  bot: Client
): Promise<NanoResult<GuildSummary[]>> {
  return runSafe(async (): Promise<GuildSummary[]> => {
    const GUILDS = await bot.guilds.fetch();
    return GUILDS.map((guild: OAuth2Guild): GuildSummary => {
      return { id: guild.id, name: guild.name };
    });
  });
}

/** Fetch the raw discord.js Guild object. */
export async function getGuild(
  bot: Client,
  guild_id: string
): Promise<NanoResult<Guild>> {
  return runSafe(async (): Promise<Guild> => {
    return requireGuild(bot, guild_id);
  });
}

/** Build a full GuildSnapshot: identity plus all channels and roles. */
export async function getGuildSnapshot(
  bot: Client,
  guild_id: string
): Promise<NanoResult<GuildSnapshot>> {
  return runSafe(async (): Promise<GuildSnapshot> => {
    const GUILD = await requireGuild(bot, guild_id);
    const CHANNELS = await listChannels(bot, guild_id);
    const ROLES = await listRoles(bot, guild_id);

    if (!CHANNELS.ok) {
      throw new Error(CHANNELS.error);
    }

    if (!ROLES.ok) {
      throw new Error(ROLES.error);
    }

    return {
      id: GUILD.id,
      name: GUILD.name,
      description: GUILD.description,
      member_count: GUILD.memberCount,
      created_at: GUILD.createdAt.toISOString(),
      channels: CHANNELS.data,
      roles: ROLES.data,
    };
  });
}
