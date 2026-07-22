import { EventEmitter } from 'node:events';

import type { Client } from 'discord.js';
import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import dispatcher from '@/core/kernel/events/interaction-create.js';
import { ModuleRegistry } from '@/registry/module-registry.js';
import { CooldownManager } from '@/services/cooldown.js';
import type { NanoCommand, NanoModule } from '@/types/nano-module.js';

interface FakeClientBundle {
  client: Client;
  registry: ModuleRegistry;
  cooldowns: CooldownManager;
}

function createClient(): FakeClientBundle {
  const CLIENT = new EventEmitter() as unknown as Client;
  CLIENT.commands = new Collection();
  const COOLDOWNS = new CooldownManager();
  const REGISTRY = new ModuleRegistry(CLIENT, { cooldowns: COOLDOWNS });
  CLIENT.nano = REGISTRY;
  (CLIENT as { services: unknown }).services = {
    cooldowns: COOLDOWNS,
    scheduler: null,
    cache: null,
    lifecycle: null,
    database: null,
  };
  return { client: CLIENT, registry: REGISTRY, cooldowns: COOLDOWNS };
}

interface FakeInteraction {
  reply: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  respond?: ReturnType<typeof vi.fn>;
  replied: boolean;
  deferred: boolean;
  [key: string]: unknown;
}

function baseInteraction(
  client: Client,
  overrides: Record<string, unknown>
): FakeInteraction {
  return {
    client,
    user: { id: 'u1' },
    guildId: 'g1',
    channelId: 'c1',
    replied: false,
    deferred: false,
    reply: vi.fn(async (): Promise<void> => {}),
    deferReply: vi.fn(async (): Promise<void> => {}),
    followUp: vi.fn(async (): Promise<void> => {}),
    isChatInputCommand: (): boolean => {
      return false;
    },
    isContextMenuCommand: (): boolean => {
      return false;
    },
    isAutocomplete: (): boolean => {
      return false;
    },
    isMessageComponent: (): boolean => {
      return false;
    },
    isModalSubmit: (): boolean => {
      return false;
    },
    ...overrides,
  };
}

function slashInteraction(
  client: Client,
  command_name: string
): FakeInteraction {
  return baseInteraction(client, {
    commandName: command_name,
    isChatInputCommand: (): boolean => {
      return true;
    },
  });
}

function moduleWithCommand(
  execute: ReturnType<typeof vi.fn>,
  extras: Partial<NanoModule> = {}
): NanoModule {
  return {
    name: 'test-module',
    version: '1.0.0',
    commands: [{
      data: { name: 'probe', toJSON: (): unknown => {
        return {};
      } },
      cooldown: { scope: 'user', delay_ms: 60000 },
      execute: execute as unknown as NanoCommand['execute'],
    }],
    ...extras,
  };
}

describe('kernel dispatcher', (): void => {
  it('routes slash commands to their module command', async ():
  Promise<void> => {
    const { client: _client, registry: _registry } = createClient();
    const EXECUTE = vi.fn(async (): Promise<void> => {});
    await _registry.register(moduleWithCommand(EXECUTE), 'local');

    const INTERACTION = slashInteraction(_client, 'probe');
    await dispatcher.execute(INTERACTION as never);

    expect(EXECUTE).toHaveBeenCalledTimes(1);
  });

  it('enforces cooldowns between calls', async (): Promise<void> => {
    const { client: _client, registry: _registry } = createClient();
    const EXECUTE = vi.fn(async (): Promise<void> => {});
    await _registry.register(moduleWithCommand(EXECUTE), 'local');

    await dispatcher.execute(slashInteraction(_client, 'probe') as never);
    const SECOND = slashInteraction(_client, 'probe');
    await dispatcher.execute(SECOND as never);

    expect(EXECUTE).toHaveBeenCalledTimes(1);
    expect(SECOND.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Slow down'),
      })
    );
  });

  it('blocks commands of disabled modules', async (): Promise<void> => {
    const { client: _client, registry: _registry } = createClient();
    const EXECUTE = vi.fn(async (): Promise<void> => {});
    await _registry.register(moduleWithCommand(EXECUTE), 'local');
    await _registry.disable('test-module');

    const INTERACTION = slashInteraction(_client, 'probe');
    await dispatcher.execute(INTERACTION as never);

    expect(EXECUTE).not.toHaveBeenCalled();
    expect(INTERACTION.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('disabled module'),
      })
    );
  });

  it('answers failures with the safe error reply', async ():
  Promise<void> => {
    const { client: _client, registry: _registry } = createClient();
    const EXECUTE = vi.fn(async (): Promise<void> => {
      throw new Error('module exploded');
    });
    await _registry.register(moduleWithCommand(EXECUTE), 'local');

    const INTERACTION = slashInteraction(_client, 'probe');
    await dispatcher.execute(INTERACTION as never);

    expect(INTERACTION.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('error'),
      })
    );
  });

  it('routes components via the module:action convention', async ():
  Promise<void> => {
    const { client: _client, registry: _registry } = createClient();
    const HANDLER = vi.fn(async (): Promise<void> => {});
    await _registry.register({
      name: 'test-module',
      version: '1.0.0',
      components: { rescan: HANDLER },
    }, 'local');

    const INTERACTION = baseInteraction(_client, {
      customId: 'test-module:rescan:g1',
      isMessageComponent: (): boolean => {
        return true;
      },
    });
    await dispatcher.execute(INTERACTION as never);

    expect(HANDLER).toHaveBeenCalledWith(INTERACTION, ['g1']);
  });

  it('stays silent for collector-managed custom ids', async ():
  Promise<void> => {
    const { client: _client } = createClient();
    const INTERACTION = baseInteraction(_client, {
      customId: 'nano-page-next',
      isMessageComponent: (): boolean => {
        return true;
      },
    });

    await dispatcher.execute(INTERACTION as never);

    expect(INTERACTION.reply).not.toHaveBeenCalled();
  });

  it('answers autocomplete with empty choices on failure', async ():
  Promise<void> => {
    const { client: _client, registry: _registry } = createClient();
    await _registry.register({
      name: 'test-module',
      version: '1.0.0',
      commands: [{
        data: { name: 'probe', toJSON: (): unknown => {
          return {};
        } },
        execute: vi.fn(async (): Promise<void> => {}) as
          unknown as NanoCommand['execute'],
        autocomplete: vi.fn(async (): Promise<void> => {
          throw new Error('autocomplete broke');
        }) as unknown as NanoCommand['autocomplete'],
      }],
    }, 'local');

    const RESPOND = vi.fn(async (): Promise<void> => {});
    const INTERACTION = baseInteraction(_client, {
      commandName: 'probe',
      responded: false,
      respond: RESPOND,
      isAutocomplete: (): boolean => {
        return true;
      },
    });
    await dispatcher.execute(INTERACTION as never);

    expect(RESPOND).toHaveBeenCalledWith([]);
  });
});
