import { EventEmitter } from 'node:events';

import type { Client } from 'discord.js';
import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { ModuleRegistry } from '@/registry/module-registry.js';
import type { NanoModule } from '@/types/nano-module.js';

function createFakeBot(): Client {
  const BOT = new EventEmitter() as unknown as Client;
  BOT.commands = new Collection();
  return BOT;
}

function createModule(overrides: Partial<NanoModule> = {}): NanoModule {
  return {
    name: 'test-module',
    version: '1.0.0',
    ...overrides,
  };
}

describe('ModuleRegistry', (): void => {
  it('registers a module and binds its commands', async (): Promise<void> => {
    const BOT = createFakeBot();
    const REGISTRY = new ModuleRegistry(BOT);
    const EXECUTE = vi.fn();
    const RESULT = await REGISTRY.register(createModule({
      commands: [{
        data: { name: 'test-cmd', toJSON: (): unknown => {
          return {};
        } },
        execute: EXECUTE,
      }],
    }), 'local');

    expect(RESULT.ok).toBe(true);
    expect(BOT.commands.has('test-cmd')).toBe(true);
    expect(REGISTRY.isCommandEnabled('test-cmd')).toBe(true);
  });

  it('rejects duplicate module names', async (): Promise<void> => {
    const REGISTRY = new ModuleRegistry(createFakeBot());

    await REGISTRY.register(createModule(), 'local');
    const SECOND = await REGISTRY.register(createModule(), 'local');

    expect(SECOND.ok).toBe(false);
  });

  it('gates events by module state', async (): Promise<void> => {
    const BOT = createFakeBot();
    const REGISTRY = new ModuleRegistry(BOT);
    const EXECUTE = vi.fn();

    await REGISTRY.register(createModule({
      events: [{ name: 'testEvent', execute: EXECUTE }],
    }), 'local');

    (BOT as unknown as EventEmitter).emit('testEvent', 'payload');
    expect(EXECUTE).toHaveBeenCalledTimes(1);

    await REGISTRY.disable('test-module');
    (BOT as unknown as EventEmitter).emit('testEvent', 'payload');
    expect(EXECUTE).toHaveBeenCalledTimes(1);

    await REGISTRY.enable('test-module');
    (BOT as unknown as EventEmitter).emit('testEvent', 'payload');
    expect(EXECUTE).toHaveBeenCalledTimes(2);
  });

  it('runs lifecycle hooks and reports state changes', async ():
  Promise<void> => {
    const REGISTRY = new ModuleRegistry(createFakeBot(), {
      onStateChange: vi.fn(),
    });
    const ON_ENABLE = vi.fn();
    const ON_DISABLE = vi.fn();

    await REGISTRY.register(createModule({
      onEnable: ON_ENABLE,
      onDisable: ON_DISABLE,
    }), 'local');
    expect(ON_ENABLE).toHaveBeenCalledTimes(1);

    await REGISTRY.disable('test-module');
    expect(ON_DISABLE).toHaveBeenCalledTimes(1);
  });

  it('honors a persisted disabled list', async (): Promise<void> => {
    const REGISTRY = new ModuleRegistry(createFakeBot(), {
      disabled: ['test-module'],
    });
    const ON_ENABLE = vi.fn();

    await REGISTRY.register(createModule({ onEnable: ON_ENABLE }), 'local');

    expect(ON_ENABLE).not.toHaveBeenCalled();
    expect(REGISTRY.isEnabled('test-module')).toBe(false);
    expect(REGISTRY.enabledCommands()).toEqual([]);
  });

  it('refuses to disable or remove protected modules', async ():
  Promise<void> => {
    const REGISTRY = new ModuleRegistry(createFakeBot());

    await REGISTRY.register(createModule({ name: 'nano' }), 'core', true);

    expect((await REGISTRY.disable('nano')).ok).toBe(false);
    expect((await REGISTRY.removeModule('nano')).ok).toBe(false);
  });

  it('removes a module, its commands, and its listeners', async ():
  Promise<void> => {
    const BOT = createFakeBot();
    const REGISTRY = new ModuleRegistry(BOT);
    const EXECUTE = vi.fn();

    await REGISTRY.register(createModule({
      commands: [{
        data: { name: 'test-cmd', toJSON: (): unknown => {
          return {};
        } },
        execute: EXECUTE,
      }],
      events: [{ name: 'testEvent', execute: EXECUTE }],
    }), 'local');

    const RESULT = await REGISTRY.removeModule('test-module');

    expect(RESULT.ok).toBe(true);
    expect(BOT.commands.has('test-cmd')).toBe(false);
    (BOT as unknown as EventEmitter).emit('testEvent');
    expect(EXECUTE).not.toHaveBeenCalled();
    expect(REGISTRY.get('test-module')).toBeUndefined();
  });

  it('reports health with built-in and custom checks', async ():
  Promise<void> => {
    const REGISTRY = new ModuleRegistry(createFakeBot(), {
      disabled: ['off-module'],
    });

    await REGISTRY.register(createModule({ name: 'plain' }), 'local');
    await REGISTRY.register(createModule({ name: 'off-module' }), 'local');
    await REGISTRY.register(createModule({
      name: 'custom',
      healthCheck: (): { status: 'degraded'; details: string } => {
        return { status: 'degraded', details: 'cache cold' };
      },
    }), 'local');

    const REPORTS = await REGISTRY.healthAll();

    expect(REPORTS).toContainEqual({
      name: 'plain',
      status: 'healthy',
      details: 'No custom health check.',
    });
    expect(REPORTS).toContainEqual({ name: 'off-module', status: 'disabled' });
    expect(REPORTS).toContainEqual({
      name: 'custom',
      status: 'degraded',
      details: 'cache cold',
    });
  });
});
