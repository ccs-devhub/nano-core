import type { Client } from 'discord.js';
import { userMention } from 'discord.js';

import { sendDirectMessage } from '@/api/dm.js';
import type { NanoMessagePayload } from '@/api/message.js';
import { sendMessage } from '@/api/message.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * C4: member notices. DM first; when the DM fails (50007 closed DMs
 * etc.) degrade to the fallback channel with the mention line
 * prepended. LAW: notice failure NEVER blocks enforcement — callers
 * treat an err as "not notified", not as a reason to abort; ban DMs
 * are attempted BEFORE the ban lands (after it there is no mutual
 * guild).
 */
export interface MemberNoticeOptions {
  fallback_channel_id?: string;
  fallback_content?: string;
}

export interface MemberNoticeReceipt {
  delivered_via: 'dm' | 'channel';
  message_id: string;
}

export async function sendMemberNotice(
  bot: Client,
  user_id: string,
  payload: NanoMessagePayload | string,
  options: MemberNoticeOptions = {}
): Promise<NanoResult<MemberNoticeReceipt>> {
  const NORMALIZED: NanoMessagePayload = typeof payload === 'string'
    ? { content: payload }
    : payload;
  const DM = await sendDirectMessage(bot, user_id, NORMALIZED);

  if (DM.ok) {
    return ok({ delivered_via: 'dm', message_id: DM.data.id });
  }

  if (!options.fallback_channel_id) {
    return err(`DM failed and no fallback channel set: ${DM.error}`);
  }

  const MENTION_LINE = userMention(user_id);
  const CONTENT = options.fallback_content ?? NORMALIZED.content ?? '';
  const CHANNEL = await sendMessage(bot, options.fallback_channel_id, {
    ...NORMALIZED,
    content: `${MENTION_LINE}\n${CONTENT}`,
  });

  if (!CHANNEL.ok) {
    return err(
      `DM and channel fallback both failed: ${DM.error} / ` +
      `${CHANNEL.error}`
    );
  }
  return ok({
    delivered_via: 'channel',
    message_id: CHANNEL.data.id,
  });
}
