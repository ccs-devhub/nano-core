import type { Client, Invite } from 'discord.js';

import { requireGuild } from '@/api/guild.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/** Plain-JSON view of an invite, safe for logs and AI consumers. */
export interface InviteSummary {
  code: string;
  url: string;
  channel_id: string | null;
  uses: number | null;
  max_uses: number | null;
  max_age_seconds: number | null;
  expires_at: string | null;
}

export interface CreateInviteSpec {
  max_age_seconds?: number;
  max_uses?: number;
  temporary?: boolean;
}

export function toInviteSummary(invite: Invite): InviteSummary {
  return {
    code: invite.code,
    url: invite.url,
    channel_id: invite.channelId,
    uses: invite.uses,
    max_uses: invite.maxUses,
    max_age_seconds: invite.maxAge,
    expires_at: invite.expiresAt?.toISOString() ?? null,
  };
}

/** Create an invite for a guild channel. */
export async function createInvite(
  bot: Client,
  channel_id: string,
  spec: CreateInviteSpec = {}
): Promise<NanoResult<InviteSummary>> {
  return runSafe(async (): Promise<InviteSummary> => {
    const CHANNEL = await bot.channels.fetch(channel_id);

    if (!CHANNEL || !('createInvite' in CHANNEL)) {
      throw new Error(`Channel '${channel_id}' cannot have invites.`);
    }

    const INVITE = await CHANNEL.createInvite({
      maxAge: spec.max_age_seconds,
      maxUses: spec.max_uses,
      temporary: spec.temporary,
    });
    return toInviteSummary(INVITE);
  });
}

/** Every active invite in a guild. */
export async function listInvites(
  bot: Client,
  guild_id: string
): Promise<NanoResult<InviteSummary[]>> {
  return runSafe(async (): Promise<InviteSummary[]> => {
    const GUILD = await requireGuild(bot, guild_id);
    const INVITES = await GUILD.invites.fetch();
    return Array.from(INVITES.values()).map(toInviteSummary);
  });
}

/** Revoke an invite by code. */
export async function deleteInvite(
  bot: Client,
  code: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const INVITE = await bot.fetchInvite(code);
    await INVITE.delete();
    return code;
  });
}
