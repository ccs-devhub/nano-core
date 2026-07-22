import type { NanoConfig } from '@/registry/nano-config.js';

/**
 * Apply the Config-view form values onto a loaded config. Pure and
 * exhaustive: every field the form edits is written here, empty
 * strings clear optional fields, and nothing else is touched — so a
 * save can never silently drop a change.
 */
export type ConfigFormValues = Record<string, string | number | boolean>;

export function applyConfigValues(
  config: NanoConfig,
  values: ConfigFormValues
): NanoConfig {
  const NEXT = structuredClone(config);

  NEXT.bot.name = String(values['bot.name'] ?? NEXT.bot.name).trim() ||
    'nano-bot';
  NEXT.bot.dev_guild_id =
    String(values['bot.dev_guild_id'] ?? '').trim() || undefined;
  NEXT.intents = String(values['intents'] ?? '')
    .split(',')
    .map((intent: string): string => {
      return intent.trim();
    })
    .filter(Boolean);

  if (NEXT.intents.length === 0) {
    NEXT.intents = ['Guilds'];
  }

  NEXT.database.driver =
    values['database.driver'] === 'postgres' ? 'postgres' : 'sqlite';
  NEXT.database.url =
    String(values['database.url'] ?? '').trim() || undefined;
  NEXT.logging.level =
    String(values['logging.level'] ?? '').trim() || 'info';
  NEXT.logging.pretty = values['logging.pretty'] === true;
  NEXT.logging.file =
    String(values['logging.file'] ?? '').trim() || undefined;
  NEXT.store.registry_url =
    String(values['store.registry_url'] ?? '').trim() ||
    NEXT.store.registry_url;
  return NEXT;
}
