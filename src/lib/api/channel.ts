import type {
  Client,
  GuildChannelEditOptions,
  GuildChannelTypes,
  NonThreadGuildBasedChannel,
  OverwriteResolvable,
  PermissionOverwriteOptions,
  PermissionOverwrites
} from 'discord.js';
import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits
} from 'discord.js';

import { requireGuild } from '@/api/guild.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/** One channel permission overwrite, decoded for AI consumers. */
export interface PermissionOverwriteSummary {
  id: string;
  type: 'role' | 'member';
  allow: string[];
  deny: string[];
}

/** Plain-JSON view of a guild channel, safe for logs and AI consumers. */
export interface ChannelSummary {
  id: string;
  name: string;
  type: string;
  parent_id: string | null;
  position: number;
  topic: string | null;
  nsfw: boolean;
  rate_limit_per_user: number | null;
  default_thread_rate_limit_per_user: number | null;
  bitrate: number | null;
  user_limit: number | null;
  permission_overwrites: PermissionOverwriteSummary[];
}

/** One overwrite to WRITE: plain permission names in allow/deny. */
export interface PermissionOverwriteInput {
  id: string;
  type?: 'role' | 'member';
  allow?: string[];
  deny?: string[];
}

export interface CreateChannelOptions {
  name: string;
  type?: string;
  parent_id?: string;
  topic?: string;
  position?: number;
  rate_limit_per_user?: number;
  default_thread_rate_limit_per_user?: number;
  permission_overwrites?: PermissionOverwriteInput[];
}

export interface SetChannelPermissionsOptions {
  overwrites: PermissionOverwriteInput[];
  replace?: boolean;
  reason?: string;
}

export interface EditChannelOptions {
  name?: string;
  topic?: string;
  parent_id?: string | null;
  position?: number;
  rate_limit_per_user?: number;
  default_thread_rate_limit_per_user?: number;
}

function toOverwriteSummary(
  overwrite: PermissionOverwrites
): PermissionOverwriteSummary {
  return {
    id: overwrite.id,
    type: overwrite.type === OverwriteType.Role ? 'role' : 'member',
    allow: overwrite.allow.toArray(),
    deny: overwrite.deny.toArray(),
  };
}

export function assertPermissionName(
  name: string
): keyof typeof PermissionFlagsBits {
  if (!(name in PermissionFlagsBits)) {
    throw new Error(`Unknown permission '${name}'.`);
  }
  return name as keyof typeof PermissionFlagsBits;
}

function resolveOverwriteType(
  type_name?: 'role' | 'member'
): OverwriteType {
  return type_name === 'member'
    ? OverwriteType.Member
    : OverwriteType.Role;
}

function toOverwriteResolvable(
  input: PermissionOverwriteInput
): OverwriteResolvable {
  return {
    id: input.id,
    type: resolveOverwriteType(input.type),
    allow: (input.allow ?? []).map(assertPermissionName),
    deny: (input.deny ?? []).map(assertPermissionName),
  };
}

function toPermissionOptions(
  input: PermissionOverwriteInput
): PermissionOverwriteOptions {
  const OPTIONS: PermissionOverwriteOptions = {};

  for (const NAME of input.allow ?? []) {
    OPTIONS[assertPermissionName(NAME)] = true;
  }

  for (const NAME of input.deny ?? []) {
    OPTIONS[assertPermissionName(NAME)] = false;
  }
  return OPTIONS;
}

export function toChannelSummary(
  channel: NonThreadGuildBasedChannel
): ChannelSummary {
  return {
    id: channel.id,
    name: channel.name,
    type: ChannelType[channel.type],
    parent_id: channel.parentId,
    position: channel.position,
    topic: 'topic' in channel ? channel.topic : null,
    nsfw: 'nsfw' in channel ? channel.nsfw : false,
    rate_limit_per_user:
      'rateLimitPerUser' in channel ? channel.rateLimitPerUser : null,
    default_thread_rate_limit_per_user:
      'defaultThreadRateLimitPerUser' in channel
        ? channel.defaultThreadRateLimitPerUser ?? null
        : null,
    bitrate: 'bitrate' in channel ? channel.bitrate : null,
    user_limit: 'userLimit' in channel ? channel.userLimit : null,
    permission_overwrites: Array.from(
      channel.permissionOverwrites.cache.values()
    ).map(toOverwriteSummary),
  };
}

/** List every channel of a guild, ordered by position. */
export async function listChannels(
  bot: Client,
  guild_id: string
): Promise<NanoResult<ChannelSummary[]>> {
  return runSafe(async (): Promise<ChannelSummary[]> => {
    const GUILD = await requireGuild(bot, guild_id);
    const CHANNELS = await GUILD.channels.fetch();
    return Array.from(CHANNELS.values())
      .filter((
        channel: NonThreadGuildBasedChannel | null
      ): channel is NonThreadGuildBasedChannel => {
        return channel !== null;
      })
      .map(toChannelSummary)
      .sort((a: ChannelSummary, b: ChannelSummary): number => {
        return a.position - b.position;
      });
  });
}

/** Fetch a single channel by id. */
export async function getChannel(
  bot: Client,
  guild_id: string,
  channel_id: string
): Promise<NanoResult<ChannelSummary>> {
  return runSafe(async (): Promise<ChannelSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const CHANNEL = await GUILD.channels.fetch(channel_id);

    if (!CHANNEL || CHANNEL.isThread()) {
      throw new Error(`Channel '${channel_id}' not found.`);
    }
    return toChannelSummary(CHANNEL);
  });
}

/** Create a channel. `type` accepts ChannelType names like 'GuildText'. */
export async function createChannel(
  bot: Client,
  guild_id: string,
  options: CreateChannelOptions
): Promise<NanoResult<ChannelSummary>> {
  return runSafe(async (): Promise<ChannelSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const CHANNEL = await GUILD.channels.create({
      name: options.name,
      type: resolveChannelType(options.type) as GuildChannelTypes,
      parent: options.parent_id,
      topic: options.topic,
      position: options.position,
      rateLimitPerUser: options.rate_limit_per_user,
      defaultThreadRateLimitPerUser:
        options.default_thread_rate_limit_per_user,
      permissionOverwrites: options.permission_overwrites?.map(
        toOverwriteResolvable
      ),
    });
    return toChannelSummary(CHANNEL);
  });
}

/** Edit name, topic, parent category, or position of a channel. */
export async function editChannel(
  bot: Client,
  guild_id: string,
  channel_id: string,
  options: EditChannelOptions
): Promise<NanoResult<ChannelSummary>> {
  return runSafe(async (): Promise<ChannelSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const CHANNEL = await GUILD.channels.fetch(channel_id);

    if (!CHANNEL || CHANNEL.isThread()) {
      throw new Error(`Channel '${channel_id}' not found.`);
    }

    const PAYLOAD: GuildChannelEditOptions = {};

    if (options.name !== undefined) {
      PAYLOAD.name = options.name;
    }

    if (options.topic !== undefined) {
      PAYLOAD.topic = options.topic;
    }

    if (options.parent_id !== undefined) {
      PAYLOAD.parent = options.parent_id;
    }

    if (options.position !== undefined) {
      PAYLOAD.position = options.position;
    }

    if (options.rate_limit_per_user !== undefined) {
      PAYLOAD.rateLimitPerUser = options.rate_limit_per_user;
    }

    if (options.default_thread_rate_limit_per_user !== undefined) {
      PAYLOAD.defaultThreadRateLimitPerUser =
        options.default_thread_rate_limit_per_user;
    }

    const EDITED = await CHANNEL.edit(PAYLOAD);
    return toChannelSummary(EDITED);
  });
}

/**
 * Write channel permission overwrites. Default mode upserts each listed
 * role/member EXACTLY as given (unlisted permissions go neutral); an
 * entry with empty allow AND deny clears that target's overwrite.
 * `replace: true` swaps the channel's entire overwrite list instead.
 */
export async function setChannelPermissions(
  bot: Client,
  guild_id: string,
  channel_id: string,
  options: SetChannelPermissionsOptions
): Promise<NanoResult<ChannelSummary>> {
  return runSafe(async (): Promise<ChannelSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const CHANNEL = await GUILD.channels.fetch(channel_id);

    if (!CHANNEL || CHANNEL.isThread()) {
      throw new Error(`Channel '${channel_id}' not found.`);
    }

    if (options.replace) {
      await CHANNEL.permissionOverwrites.set(
        options.overwrites.map(toOverwriteResolvable),
        options.reason
      );
    } else {
      for (const ENTRY of options.overwrites) {
        const IS_CLEAR = (ENTRY.allow ?? []).length === 0
          && (ENTRY.deny ?? []).length === 0;

        if (IS_CLEAR) {
          await CHANNEL.permissionOverwrites.delete(
            ENTRY.id, options.reason
          );
        } else {
          await CHANNEL.permissionOverwrites.create(
            ENTRY.id,
            toPermissionOptions(ENTRY),
            {
              type: resolveOverwriteType(ENTRY.type),
              reason: options.reason,
            }
          );
        }
      }
    }

    const FRESH = await GUILD.channels.fetch(channel_id, { force: true });

    if (!FRESH || FRESH.isThread()) {
      throw new Error(`Channel '${channel_id}' not found after update.`);
    }
    return toChannelSummary(FRESH);
  });
}

/** Delete a channel by id. */
export async function deleteChannel(
  bot: Client,
  guild_id: string,
  channel_id: string,
  reason?: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    const CHANNEL = await GUILD.channels.fetch(channel_id);

    if (!CHANNEL) {
      throw new Error(`Channel '${channel_id}' not found.`);
    }

    await CHANNEL.delete(reason);
    return channel_id;
  });
}

function resolveChannelType(type_name?: string): ChannelType {
  if (!type_name) {
    return ChannelType.GuildText;
  }

  const RESOLVED = ChannelType[type_name as keyof typeof ChannelType];

  if (typeof RESOLVED !== 'number') {
    throw new Error(`Unknown channel type '${type_name}'.`);
  }
  return RESOLVED;
}
