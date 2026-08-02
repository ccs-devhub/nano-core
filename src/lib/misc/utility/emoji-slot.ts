import { z } from 'zod';

/**
 * C3: named emoji slots. Modules refer to emojis by SLOT NAME; the
 * per-guild ids live in guild config under `emoji_slots`. Resolution
 * is pure, synchronous and infallible — existence checking is a
 * healthCheck concern (listEmojis cross-check), never the resolver's.
 */
export interface EmojiSlot {
  id?: string;
  name?: string;
  animated?: boolean;
  fallback: string;
}

export const EMOJI_SLOT_SCHEMA = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  animated: z.boolean().optional(),
  fallback: z.string(),
});

/** The config fragment modules embed under `emoji_slots`. */
export const EMOJI_SLOTS_SCHEMA = z.record(
  z.string(),
  EMOJI_SLOT_SCHEMA
);

export type EmojiSlots = z.infer<typeof EMOJI_SLOTS_SCHEMA>;

const DEFAULT_EMOJI_NAME = '_';

/** Render a slot: custom-emoji mention when an id is set, else the
 *  fallback text (or the caller's default). Never throws. */
export function resolveEmojiSlot(
  slot: EmojiSlot | undefined,
  default_fallback: string = ''
): string {
  if (!slot) {
    return default_fallback;
  }

  if (slot.id) {
    const NAME = slot.name ?? DEFAULT_EMOJI_NAME;
    const PREFIX = slot.animated ? 'a' : '';
    return `<${PREFIX}:${NAME}:${slot.id}>`;
  }
  return slot.fallback || default_fallback;
}
