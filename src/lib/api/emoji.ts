import type { Client, GuildEmoji, Sticker } from 'discord.js';

import { requireGuild } from '@/api/guild.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/** Plain-JSON view of a custom emoji. */
export interface EmojiSummary {
  id: string;
  name: string | null;
  animated: boolean;
  url: string;
  /** Paste-ready mention, e.g. `<:party:1234>`. */
  mention: string;
}

/** Plain-JSON view of a guild sticker. */
export interface StickerSummary {
  id: string;
  name: string;
  description: string | null;
  url: string;
}

export function toEmojiSummary(emoji: GuildEmoji): EmojiSummary {
  return {
    id: emoji.id,
    name: emoji.name,
    animated: emoji.animated ?? false,
    url: emoji.imageURL(),
    mention: emoji.toString(),
  };
}

export function toStickerSummary(sticker: Sticker): StickerSummary {
  return {
    id: sticker.id,
    name: sticker.name,
    description: sticker.description,
    url: sticker.url,
  };
}

/** Every custom emoji in a guild. */
export async function listEmojis(
  bot: Client,
  guild_id: string
): Promise<NanoResult<EmojiSummary[]>> {
  return runSafe(async (): Promise<EmojiSummary[]> => {
    const GUILD = await requireGuild(bot, guild_id);
    const EMOJIS = await GUILD.emojis.fetch();
    return Array.from(EMOJIS.values()).map(toEmojiSummary);
  });
}

/** Every sticker uploaded to a guild. */
export async function listStickers(
  bot: Client,
  guild_id: string
): Promise<NanoResult<StickerSummary[]>> {
  return runSafe(async (): Promise<StickerSummary[]> => {
    const GUILD = await requireGuild(bot, guild_id);
    const STICKERS = await GUILD.stickers.fetch();
    return Array.from(STICKERS.values()).map(toStickerSummary);
  });
}

/** Upload a custom emoji from an image URL. */
export async function createEmoji(
  bot: Client,
  guild_id: string,
  name: string,
  image_url: string,
  reason?: string
): Promise<NanoResult<EmojiSummary>> {
  return runSafe(async (): Promise<EmojiSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const EMOJI = await GUILD.emojis.create({
      name,
      attachment: image_url,
      reason,
    });
    return toEmojiSummary(EMOJI);
  });
}

/** Delete a custom emoji by id. */
export async function deleteEmoji(
  bot: Client,
  guild_id: string,
  emoji_id: string,
  reason?: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    await GUILD.emojis.delete(emoji_id, reason);
    return emoji_id;
  });
}
