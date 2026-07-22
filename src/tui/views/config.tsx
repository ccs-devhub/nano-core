import { Text } from 'ink';
import type { ReactElement } from 'react';

import { loadConfig, saveConfig } from '@/registry/nano-config.js';
import type { FormFieldSpec, FormValue } from '@/tui/components/form.js';
import { Form } from '@/tui/components/form.js';
import { Window } from '@/tui/components/window.js';
import { applyConfigValues } from '@/tui/state/config-save.js';

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

export function ConfigView(): ReactElement {
  const CONFIG = loadConfig();
  const FIELDS: FormFieldSpec[] = [
    {
      key: 'bot.name',
      label: 'Bot name',
      type: 'text',
      value: CONFIG.bot.name,
    },
    {
      key: 'bot.dev_guild_id',
      label: 'Dev guild id',
      type: 'text',
      value: CONFIG.bot.dev_guild_id ?? '',
      help: 'Test server id — commands appear instantly there. Get ' +
        'it: Discord > Settings > Advanced > Developer Mode, then ' +
        'right-click the server > Copy Server ID.',
    },
    {
      key: 'intents',
      label: 'Intents',
      type: 'text',
      value: CONFIG.intents.join(', '),
      help: 'Comma-separated gateway intent names (Guilds is always on).',
    },
    {
      key: 'database.driver',
      label: 'Database driver',
      type: 'select',
      options: ['sqlite', 'postgres'],
      value: CONFIG.database.driver,
    },
    {
      key: 'database.url',
      label: 'Database url/path',
      type: 'text',
      value: CONFIG.database.url ?? '',
      help: 'Default: data/nano.db',
    },
    {
      key: 'logging.level',
      label: 'Log level',
      type: 'select',
      options: LOG_LEVELS,
      value: CONFIG.logging.level,
    },
    {
      key: 'logging.pretty',
      label: 'Pretty logs',
      type: 'boolean',
      value: CONFIG.logging.pretty,
    },
    {
      key: 'logging.file',
      label: 'Log file',
      type: 'text',
      value: CONFIG.logging.file ?? '',
      help: 'Set e.g. .nano/nano.log to feed the Logs view.',
    },
    {
      key: 'store.registry_url',
      label: 'Store registry URL',
      type: 'text',
      value: CONFIG.store.registry_url,
    },
  ];

  const save = (values: Record<string, FormValue>): void => {
    saveConfig(applyConfigValues(loadConfig(), values));
  };

  return (
    <Window title="Bot configuration (nano.config.json)" grow>
      <Text dimColor>
        Secrets never live here: set DISCORD_TOKEN and CLIENT_ID in the
        environment (.env). Saves apply on the next bot start
        (npm run dev); the TUI reads them immediately.
      </Text>
      <Text> </Text>
      <Form fields={FIELDS} onSave={save} />
    </Window>
  );
}
