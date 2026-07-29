import type { Client, TextChannel, Webhook } from 'discord.js';

import type { NanoMessagePayload } from '@/api/message.js';
import { buildSendOptions } from '@/api/message.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/** Plain-JSON view of a webhook, safe for logs and AI consumers. */
export interface WebhookSummary {
  id: string;
  name: string;
  channel_id: string | null;
  url?: string;
}

export function toWebhookSummary(webhook: Webhook): WebhookSummary {
  return {
    id: webhook.id,
    name: webhook.name,
    channel_id: webhook.channelId,
    url: webhook.url,
  };
}

/** Create an incoming webhook on a text channel. */
export async function createWebhook(
  bot: Client,
  channel_id: string,
  name: string,
  avatar_url?: string
): Promise<NanoResult<WebhookSummary>> {
  return runSafe(async (): Promise<WebhookSummary> => {
    const CHANNEL = await requireWebhookChannel(bot, channel_id);
    const WEBHOOK = await CHANNEL.createWebhook({
      name,
      avatar: avatar_url,
    });
    return toWebhookSummary(WEBHOOK);
  });
}

/** Webhooks configured on a channel. */
export async function listWebhooks(
  bot: Client,
  channel_id: string
): Promise<NanoResult<WebhookSummary[]>> {
  return runSafe(async (): Promise<WebhookSummary[]> => {
    const CHANNEL = await requireWebhookChannel(bot, channel_id);
    const WEBHOOKS = await CHANNEL.fetchWebhooks();
    return Array.from(WEBHOOKS.values()).map(toWebhookSummary);
  });
}

/**
 * Send through a webhook, optionally masking the sender name/avatar —
 * the classic "speak as someone else" connection.
 */
export async function sendWebhookMessage(
  bot: Client,
  webhook_id: string,
  payload: string | NanoMessagePayload,
  mask?: { username?: string; avatar_url?: string }
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const WEBHOOK = await bot.fetchWebhook(webhook_id);
    const MESSAGE = await WEBHOOK.send({
      ...buildSendOptions(payload),
      username: mask?.username,
      avatarURL: mask?.avatar_url,
    });
    return MESSAGE.id;
  });
}

/** Delete a webhook by id. */
export async function deleteWebhook(
  bot: Client,
  webhook_id: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const WEBHOOK = await bot.fetchWebhook(webhook_id);
    await WEBHOOK.delete();
    return webhook_id;
  });
}

async function requireWebhookChannel(
  bot: Client,
  channel_id: string
): Promise<TextChannel> {
  const CHANNEL = await bot.channels.fetch(channel_id);

  if (!CHANNEL || !('fetchWebhooks' in CHANNEL)) {
    throw new Error(`Channel '${channel_id}' cannot have webhooks.`);
  }
  return CHANNEL as TextChannel;
}
