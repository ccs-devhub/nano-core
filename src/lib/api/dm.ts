import type { Client } from 'discord.js';

import type { MessageSummary, NanoMessagePayload } from '@/api/message.js';
import { buildSendOptions, toMessageSummary } from '@/api/message.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/**
 * Send a direct message to a user by id. Fails cleanly when the user
 * blocks DMs or shares no guild with the bot.
 */
export async function sendDirectMessage(
  bot: Client,
  user_id: string,
  payload: string | NanoMessagePayload
): Promise<NanoResult<MessageSummary>> {
  return runSafe(async (): Promise<MessageSummary> => {
    const USER = await bot.users.fetch(user_id);
    const MESSAGE = await USER.send(buildSendOptions(payload));
    return toMessageSummary(MESSAGE);
  });
}
