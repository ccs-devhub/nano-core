import { describe, expect, it } from 'vitest';

import { defaultConfig } from '@/registry/nano-config.js';
import { applyConfigValues } from '@/tui/state/config-save.js';

describe('applyConfigValues (Config view save)', (): void => {
  it('writes every form field into the config', (): void => {
    const NEXT = applyConfigValues(defaultConfig(), {
      'bot.name': 'my-bot',
      'bot.dev_guild_id': '123456',
      intents: 'Guilds, GuildMembers',
      'database.driver': 'postgres',
      'database.url': 'postgres://localhost/nano',
      'logging.level': 'debug',
      'logging.pretty': true,
      'logging.file': '.nano/nano.log',
      'store.registry_url': 'https://example.test/registry.json',
    });

    expect(NEXT.bot.name).toBe('my-bot');
    expect(NEXT.bot.dev_guild_id).toBe('123456');
    expect(NEXT.intents).toEqual(['Guilds', 'GuildMembers']);
    expect(NEXT.database.driver).toBe('postgres');
    expect(NEXT.database.url).toBe('postgres://localhost/nano');
    expect(NEXT.logging.level).toBe('debug');
    expect(NEXT.logging.pretty).toBe(true);
    expect(NEXT.logging.file).toBe('.nano/nano.log');
    expect(NEXT.store.registry_url)
      .toBe('https://example.test/registry.json');
  });

  it('clears optional fields when emptied', (): void => {
    const BASE = defaultConfig();
    BASE.bot.dev_guild_id = 'old';
    BASE.database.url = 'old.db';
    BASE.logging.file = 'old.log';

    const NEXT = applyConfigValues(BASE, {
      'bot.name': 'nano-bot',
      'bot.dev_guild_id': '  ',
      intents: 'Guilds',
      'database.driver': 'sqlite',
      'database.url': '',
      'logging.level': 'info',
      'logging.pretty': false,
      'logging.file': '',
      'store.registry_url': BASE.store.registry_url,
    });

    expect(NEXT.bot.dev_guild_id).toBeUndefined();
    expect(NEXT.database.url).toBeUndefined();
    expect(NEXT.logging.file).toBeUndefined();
  });

  it('never leaves broken required values', (): void => {
    const NEXT = applyConfigValues(defaultConfig(), {
      'bot.name': '   ',
      intents: ' , , ',
      'database.driver': 'not-a-driver',
      'logging.level': '',
      'logging.pretty': false,
      'store.registry_url': '',
    });

    expect(NEXT.bot.name).toBe('nano-bot');
    expect(NEXT.intents).toEqual(['Guilds']);
    expect(NEXT.database.driver).toBe('sqlite');
    expect(NEXT.logging.level).toBe('info');
    expect(NEXT.store.registry_url)
      .toBe(defaultConfig().store.registry_url);
  });

  it('does not touch sections outside the form', (): void => {
    const BASE = defaultConfig();
    BASE.modules = ['./modules/synapse'];
    BASE.disabled = ['embed-styler'];
    BASE.module_config = { synapse: { page_size: 10 } };

    const NEXT = applyConfigValues(BASE, {
      'bot.name': 'renamed',
      intents: 'Guilds',
      'database.driver': 'sqlite',
      'logging.level': 'info',
      'logging.pretty': false,
      'store.registry_url': BASE.store.registry_url,
    });

    expect(NEXT.modules).toEqual(['./modules/synapse']);
    expect(NEXT.disabled).toEqual(['embed-styler']);
    expect(NEXT.module_config).toEqual({ synapse: { page_size: 10 } });
  });
});
