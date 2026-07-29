import type {
  Client,
  Guild,
  GuildAuditLogsEntry,
  GuildBan,
  OAuth2Guild
} from 'discord.js';
import {
  AuditLogEvent,
  GuildExplicitContentFilter,
  GuildMFALevel,
  GuildVerificationLevel
} from 'discord.js';

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
  verification_level: string;
  explicit_content_filter: string;
  mfa_level: string;
  rules_channel_id: string | null;
  public_updates_channel_id: string | null;
  system_channel_id: string | null;
  premium_subscription_count: number | null;
  features: string[];
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
      verification_level:
        GuildVerificationLevel[GUILD.verificationLevel],
      explicit_content_filter:
        GuildExplicitContentFilter[GUILD.explicitContentFilter],
      mfa_level: GuildMFALevel[GUILD.mfaLevel],
      rules_channel_id: GUILD.rulesChannelId,
      public_updates_channel_id: GUILD.publicUpdatesChannelId,
      system_channel_id: GUILD.systemChannelId,
      premium_subscription_count: GUILD.premiumSubscriptionCount,
      features: [...GUILD.features],
      channels: CHANNELS.data,
      roles: ROLES.data,
    };
  });
}

/** Plain-JSON view of a guild ban. */
export interface BanSummary {
  user_id: string;
  user_tag: string;
  reason: string | null;
}

/** Every ban in a guild. */
export async function listBans(
  bot: Client,
  guild_id: string
): Promise<NanoResult<BanSummary[]>> {
  return runSafe(async (): Promise<BanSummary[]> => {
    const GUILD = await requireGuild(bot, guild_id);
    const BANS = await GUILD.bans.fetch();
    return Array.from(BANS.values()).map((ban: GuildBan): BanSummary => {
      return {
        user_id: ban.user.id,
        user_tag: ban.user.tag,
        reason: ban.reason ?? null,
      };
    });
  });
}

/** Plain-JSON view of an audit-log entry. */
export interface AuditLogSummary {
  id: string;
  action: string;
  executor_id: string | null;
  target_id: string | null;
  reason: string | null;
  created_at: string;
}

const DEFAULT_AUDIT_LIMIT = 25;

/** Recent audit-log entries, newest first. */
export async function fetchAuditLog(
  bot: Client,
  guild_id: string,
  limit: number = DEFAULT_AUDIT_LIMIT
): Promise<NanoResult<AuditLogSummary[]>> {
  return runSafe(async (): Promise<AuditLogSummary[]> => {
    const GUILD = await requireGuild(bot, guild_id);
    const LOG = await GUILD.fetchAuditLogs({ limit });
    return Array.from(LOG.entries.values())
      .map((entry: GuildAuditLogsEntry): AuditLogSummary => {
        return {
          id: entry.id,
          action: AuditLogEvent[entry.action] ?? String(entry.action),
          executor_id: entry.executorId,
          target_id: entry.targetId,
          reason: entry.reason,
          created_at: entry.createdAt.toISOString(),
        };
      });
  });
}
