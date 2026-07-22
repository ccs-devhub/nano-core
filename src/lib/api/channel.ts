import type {
  Client,
  GuildChannelEditOptions,
  GuildChannelTypes,
  NonThreadGuildBasedChannel
} from 'discord.js';
import { ChannelType } from 'discord.js';

import { requireGuild } from '@/api/guild.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/** Plain-JSON view of a guild channel, safe for logs and AI consumers. */
export interface ChannelSummary {
  id: string;
  name: string;
  type: string;
  parent_id: string | null;
  position: number;
}

export interface CreateChannelOptions {
  name: string;
  type?: string;
  parent_id?: string;
  topic?: string;
  position?: number;
}

export interface EditChannelOptions {
  name?: string;
  topic?: string;
  parent_id?: string | null;
  position?: number;
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

    const EDITED = await CHANNEL.edit(PAYLOAD);
    return toChannelSummary(EDITED);
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
