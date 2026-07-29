import type { Client, PresenceStatusData } from 'discord.js';
import { ActivityType } from 'discord.js';

import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

export type NanoPresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';

export type NanoActivityKind =
  | 'playing'
  | 'listening'
  | 'watching'
  | 'competing'
  | 'custom';

export interface PresenceSpec {
  status?: NanoPresenceStatus;
  activity?: string;
  activity_kind?: NanoActivityKind;
}

const ACTIVITY_TYPES = new Map<NanoActivityKind, ActivityType>([
  ['playing', ActivityType.Playing],
  ['listening', ActivityType.Listening],
  ['watching', ActivityType.Watching],
  ['competing', ActivityType.Competing],
  ['custom', ActivityType.Custom],
]);

/** Set the bot's own status and activity line. */
export function setBotPresence(
  bot: Client,
  spec: PresenceSpec
): NanoResult<PresenceSpec> {
  if (!bot.user) {
    return err('Bot is not logged in — presence unavailable.');
  }

  bot.user.setPresence({
    status: spec.status as PresenceStatusData | undefined,
    activities: spec.activity
      ? [{
        name: spec.activity,
        type: ACTIVITY_TYPES.get(spec.activity_kind ?? 'custom'),
      }]
      : [],
  });
  return ok(spec);
}
