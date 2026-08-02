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

/**
 * Fill `{slot}` placeholders in a template (the C5/C7 replacer). A
 * slot the caller did not resolve stays visible in the output — a
 * constant physically cannot invent a value.
 */
export function fillSlots(
  template: string,
  slots: Record<string, string | number>
): string {
  return template.replace(
    /\{([a-z0-9_]+)\}/g,
    (match: string, name: string): string => {
      const VALUE = slots[name];
      return VALUE === undefined ? match : String(VALUE);
    }
  );
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
