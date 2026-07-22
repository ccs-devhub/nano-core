import { SnowflakeUtil } from 'discord.js';

/**
 * Small general formatters. discord.js already ships time(), mention
 * and markdown helpers — those are re-exported by the barrel, never
 * rewritten here.
 */
const DEFAULT_SUFFIX = '...';

/** The creation Date encoded in any Discord snowflake id. */
export function snowflakeToDate(id: string): Date {
  return new Date(Number(SnowflakeUtil.timestampFrom(id)));
}

/** Split an array into fixed-size chunks (last one may be smaller). */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }

  const CHUNKS: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    CHUNKS.push(items.slice(index, index + size));
  }
  return CHUNKS;
}

/** Cut a string to a maximum length, appending a suffix when cut. */
export function truncate(
  text: string,
  max_length: number,
  suffix: string = DEFAULT_SUFFIX
): string {
  if (text.length <= max_length) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max_length - suffix.length))}${suffix}`;
}
