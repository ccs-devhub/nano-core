import type { Client, GuildScheduledEvent } from 'discord.js';
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel
} from 'discord.js';

import { requireGuild } from '@/api/guild.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/** Plain-JSON view of a scheduled event. */
export interface ScheduledEventSummary {
  id: string;
  name: string;
  description: string | null;
  start_at: string | null;
  end_at: string | null;
  channel_id: string | null;
  location: string | null;
  status: string;
  interested_count: number | null;
}

/**
 * Voice events need `channel_id`; external events need `location`
 * and `end_at`. Times are ISO strings.
 */
export interface CreateScheduledEventSpec {
  name: string;
  start_at: string;
  end_at?: string;
  description?: string;
  channel_id?: string;
  location?: string;
}

export function toScheduledEventSummary(
  event: GuildScheduledEvent
): ScheduledEventSummary {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    start_at: event.scheduledStartAt?.toISOString() ?? null,
    end_at: event.scheduledEndAt?.toISOString() ?? null,
    channel_id: event.channelId,
    location: event.entityMetadata?.location ?? null,
    status: String(event.status),
    interested_count: event.userCount,
  };
}

/** Every scheduled event in a guild. */
export async function listScheduledEvents(
  bot: Client,
  guild_id: string
): Promise<NanoResult<ScheduledEventSummary[]>> {
  return runSafe(async (): Promise<ScheduledEventSummary[]> => {
    const GUILD = await requireGuild(bot, guild_id);
    const EVENTS = await GUILD.scheduledEvents.fetch();
    return Array.from(EVENTS.values()).map(toScheduledEventSummary);
  });
}

/** Create a voice-channel or external scheduled event. */
export async function createScheduledEvent(
  bot: Client,
  guild_id: string,
  spec: CreateScheduledEventSpec
): Promise<NanoResult<ScheduledEventSummary>> {
  return runSafe(async (): Promise<ScheduledEventSummary> => {
    const GUILD = await requireGuild(bot, guild_id);

    if (!spec.channel_id && !(spec.location && spec.end_at)) {
      throw new Error(
        'Provide channel_id (voice event) or location plus end_at ' +
        '(external event).'
      );
    }

    const EVENT = await GUILD.scheduledEvents.create({
      name: spec.name,
      description: spec.description,
      scheduledStartTime: spec.start_at,
      scheduledEndTime: spec.end_at,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: spec.channel_id
        ? GuildScheduledEventEntityType.Voice
        : GuildScheduledEventEntityType.External,
      channel: spec.channel_id,
      entityMetadata: spec.location
        ? { location: spec.location }
        : undefined,
    });
    return toScheduledEventSummary(EVENT);
  });
}

/** Cancel a scheduled event by id. */
export async function deleteScheduledEvent(
  bot: Client,
  guild_id: string,
  event_id: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    const EVENT = await GUILD.scheduledEvents.fetch(event_id);
    await EVENT.delete();
    return event_id;
  });
}
