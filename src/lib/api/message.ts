import type {
  Client,
  GuildTextBasedChannel,
  Message,
  TextBasedChannel
} from 'discord.js';

import type { EmbedSpec } from '@/api/embed.js';
import { buildEmbed } from '@/api/embed.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/** Plain-JSON view of a message, safe for logs and AI consumers. */
export interface MessageSummary {
  id: string;
  channel_id: string;
  author_id: string;
  author_tag: string;
  content: string;
  created_at: string;
  pinned: boolean;
}

/**
 * JSON-friendly outgoing message: plain text, a themed embed spec, or
 * both. Strings are accepted anywhere a payload is expected.
 */
export interface NanoMessagePayload {
  content?: string;
  embed?: EmbedSpec;
  theme?: string;
}

const DEFAULT_FETCH_LIMIT = 50;
const MAX_BULK_DELETE = 100;

export function toMessageSummary(message: Message): MessageSummary {
  return {
    id: message.id,
    channel_id: message.channelId,
    author_id: message.author.id,
    author_tag: message.author.tag,
    content: message.content,
    created_at: message.createdAt.toISOString(),
    pinned: message.pinned,
  };
}

/** Send text and/or a themed embed to a channel. */
export async function sendMessage(
  bot: Client,
  channel_id: string,
  payload: string | NanoMessagePayload
): Promise<NanoResult<MessageSummary>> {
  return runSafe(async (): Promise<MessageSummary> => {
    const CHANNEL = await requireTextChannel(bot, channel_id);

    if (!CHANNEL.isSendable()) {
      throw new Error(`Cannot send messages in channel '${channel_id}'.`);
    }

    const MESSAGE = await CHANNEL.send(buildSendOptions(payload));
    return toMessageSummary(MESSAGE);
  });
}

/** Edit a message previously sent by the bot. */
export async function editMessage(
  bot: Client,
  channel_id: string,
  message_id: string,
  payload: string | NanoMessagePayload
): Promise<NanoResult<MessageSummary>> {
  return runSafe(async (): Promise<MessageSummary> => {
    const CHANNEL = await requireTextChannel(bot, channel_id);
    const MESSAGE = await CHANNEL.messages.fetch(message_id);
    const EDITED = await MESSAGE.edit(buildSendOptions(payload));
    return toMessageSummary(EDITED);
  });
}

/** Delete a single message by id. */
export async function deleteMessage(
  bot: Client,
  channel_id: string,
  message_id: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const CHANNEL = await requireTextChannel(bot, channel_id);
    const MESSAGE = await CHANNEL.messages.fetch(message_id);
    await MESSAGE.delete();
    return message_id;
  });
}

/**
 * Bulk-delete up to 100 recent messages. Discord refuses messages
 * older than 14 days; those are skipped automatically.
 */
export async function bulkDeleteMessages(
  bot: Client,
  channel_id: string,
  count: number
): Promise<NanoResult<number>> {
  return runSafe(async (): Promise<number> => {
    const CHANNEL = await requireTextChannel(bot, channel_id);

    if (CHANNEL.isDMBased()) {
      throw new Error('Bulk delete is only available in guild channels.');
    }

    const GUILD_CHANNEL = CHANNEL as GuildTextBasedChannel;
    const AMOUNT = Math.max(1, Math.min(MAX_BULK_DELETE, count));
    const DELETED = await GUILD_CHANNEL.bulkDelete(AMOUNT, true);
    return DELETED.size;
  });
}

/** Fetch recent messages from a channel, newest first. */
export async function fetchMessages(
  bot: Client,
  channel_id: string,
  limit: number = DEFAULT_FETCH_LIMIT
): Promise<NanoResult<MessageSummary[]>> {
  return runSafe(async (): Promise<MessageSummary[]> => {
    const CHANNEL = await requireTextChannel(bot, channel_id);
    const MESSAGES = await CHANNEL.messages.fetch({ limit });
    return Array.from(MESSAGES.values()).map(toMessageSummary);
  });
}

/** Pin a message. */
export async function pinMessage(
  bot: Client,
  channel_id: string,
  message_id: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const CHANNEL = await requireTextChannel(bot, channel_id);
    const MESSAGE = await CHANNEL.messages.fetch(message_id);
    await MESSAGE.pin();
    return message_id;
  });
}

/** Unpin a message. */
export async function unpinMessage(
  bot: Client,
  channel_id: string,
  message_id: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const CHANNEL = await requireTextChannel(bot, channel_id);
    const MESSAGE = await CHANNEL.messages.fetch(message_id);
    await MESSAGE.unpin();
    return message_id;
  });
}

/** React to a message with a unicode or custom emoji. */
export async function reactToMessage(
  bot: Client,
  channel_id: string,
  message_id: string,
  emoji: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const CHANNEL = await requireTextChannel(bot, channel_id);
    const MESSAGE = await CHANNEL.messages.fetch(message_id);
    await MESSAGE.react(emoji);
    return message_id;
  });
}

async function requireTextChannel(
  bot: Client,
  channel_id: string
): Promise<TextBasedChannel> {
  const CHANNEL = await bot.channels.fetch(channel_id);

  if (!CHANNEL || !CHANNEL.isTextBased()) {
    throw new Error(`Channel '${channel_id}' is not a text channel.`);
  }
  return CHANNEL;
}

function buildSendOptions(
  payload: string | NanoMessagePayload
): { content?: string; embeds?: ReturnType<typeof buildEmbed>[] } {
  if (typeof payload === 'string') {
    return { content: payload };
  }

  return {
    content: payload.content,
    embeds: payload.embed
      ? [buildEmbed(payload.embed, payload.theme)]
      : undefined,
  };
}
