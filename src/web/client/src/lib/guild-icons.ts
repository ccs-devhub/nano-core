const DEFAULT_ICON_SIZE = 128;
const MONOGRAM_LENGTH = 2;

/** Discord CDN icon URL for a guild, or null when it has none. */
export function guildIconUrl(
  guild_id: string,
  icon: string | null,
  size = DEFAULT_ICON_SIZE
): string | null {
  if (!icon) {
    return null;
  }

  const EXT = icon.startsWith('a_') ? 'gif' : 'png';
  return 'https://cdn.discordapp.com/icons/' +
    `${guild_id}/${icon}.${EXT}?size=${size}`;
}

/** Two-letter monogram fallback for iconless guilds. */
export function guildMonogram(name: string): string {
  const WORDS = name.split(/\s+/).filter((word: string): boolean => {
    return word.length > 0;
  });

  if (WORDS.length === 0) {
    return '?';
  }

  if (WORDS.length === 1) {
    return WORDS[0].slice(0, MONOGRAM_LENGTH).toUpperCase();
  }
  return (WORDS[0][0] + WORDS[1][0]).toUpperCase();
}
