import type { AnyThreadChannel, Client, TextChannel } from 'discord.js';

import { requireGuild } from '@/api/guild.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/** Plain-JSON view of a thread, safe for logs and AI consumers. */
export interface ThreadSummary {
  id: string;
  name: string;
  parent_id: string | null;
  archived: boolean;
  locked: boolean;
  member_count: number | null;
  message_count: number | null;
}

export interface CreateThreadSpec {
  name: string;
  /** Start the thread from this message instead of the channel. */
  message_id?: string;
  auto_archive_minutes?: number;
}

export function toThreadSummary(thread: AnyThreadChannel): ThreadSummary {
  return {
    id: thread.id,
    name: thread.name,
    parent_id: thread.parentId,
    archived: thread.archived ?? false,
    locked: thread.locked ?? false,
    member_count: thread.memberCount,
    message_count: thread.messageCount,
  };
}

/** Create a thread on a text channel (or under one of its messages). */
export async function createThread(
  bot: Client,
  channel_id: string,
  spec: CreateThreadSpec
): Promise<NanoResult<ThreadSummary>> {
  return runSafe(async (): Promise<ThreadSummary> => {
    const CHANNEL = await bot.channels.fetch(channel_id);

    if (!CHANNEL || !('threads' in CHANNEL)) {
      throw new Error(`Channel '${channel_id}' cannot host threads.`);
    }

    const PARENT = CHANNEL as TextChannel;
    const THREAD = spec.message_id
      ? await (await PARENT.messages.fetch(spec.message_id)).startThread({
        name: spec.name,
        autoArchiveDuration: spec.auto_archive_minutes,
      })
      : await PARENT.threads.create({
        name: spec.name,
        autoArchiveDuration: spec.auto_archive_minutes,
      });
    return toThreadSummary(THREAD);
  });
}

/** Every active thread in a guild. */
export async function listThreads(
  bot: Client,
  guild_id: string
): Promise<NanoResult<ThreadSummary[]>> {
  return runSafe(async (): Promise<ThreadSummary[]> => {
    const GUILD = await requireGuild(bot, guild_id);
    const ACTIVE = await GUILD.channels.fetchActiveThreads();
    return Array.from(ACTIVE.threads.values()).map(toThreadSummary);
  });
}

/** Archive or unarchive a thread. */
export async function setThreadArchived(
  bot: Client,
  thread_id: string,
  archived: boolean
): Promise<NanoResult<ThreadSummary>> {
  return runSafe(async (): Promise<ThreadSummary> => {
    const CHANNEL = await bot.channels.fetch(thread_id);

    if (!CHANNEL || !CHANNEL.isThread()) {
      throw new Error(`Channel '${thread_id}' is not a thread.`);
    }

    await CHANNEL.setArchived(archived);
    return toThreadSummary(CHANNEL);
  });
}
