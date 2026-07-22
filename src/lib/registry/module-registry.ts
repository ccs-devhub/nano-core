import type { Client } from 'discord.js';

import type { CooldownManager } from '@/services/cooldown.js';
import type {
  NanoCommand,
  NanoComponentHandler,
  NanoHealthReport,
  NanoModule,
  NanoTaskHandler
} from '@/types/nano-module.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

export type ModuleOrigin = 'core' | 'npm' | 'local';

export interface RegisteredModule {
  module: NanoModule;
  origin: ModuleOrigin;
  enabled: boolean;
  protected: boolean;
}

export interface ModuleHealth extends NanoHealthReport {
  name: string;
}

export interface ModuleRegistryOptions {
  disabled?: string[];
  onStateChange?: (module_name: string, enabled: boolean) => void;
  cooldowns?: CooldownManager;
}

interface BoundListener {
  event_name: string;
  listener: (...args: unknown[]) => Promise<void>;
}

/**
 * Runtime heart of nano-core: tracks every registered module, owns the
 * enable/disable/remove lifecycle, gates commands and events by module
 * state, and answers health queries.
 */
export class ModuleRegistry {
  private bot: Client;
  private options: ModuleRegistryOptions;
  private modules: Map<string, RegisteredModule> = new Map();
  private command_owner: Map<string, string> = new Map();
  private listeners: Map<string, BoundListener[]> = new Map();

  constructor(bot: Client, options: ModuleRegistryOptions = {}) {
    this.bot = bot;
    this.options = options;
  }

  /**
   * Register a module: bind its commands and events, honor persisted
   * disabled state, and run onEnable when active. Protected modules
   * (the kernel) can never be disabled or removed.
   */
  async register(
    module: NanoModule,
    origin: ModuleOrigin,
    protect: boolean = false
  ): Promise<NanoResult<string>> {
    if (!module?.name || !module?.version) {
      return err('Module is missing a name or version.');
    }

    if (this.modules.has(module.name)) {
      return err(`Module '${module.name}' is already registered.`);
    }

    const ENABLED = !(this.options.disabled ?? []).includes(module.name);
    this.modules.set(module.name, {
      module,
      origin,
      enabled: ENABLED,
      protected: protect,
    });
    this.bindCommands(module);
    this.bindEvents(module);

    if (ENABLED && module.onEnable) {
      await module.onEnable(this.bot);
    }

    const STATE = ENABLED ? '' : ', disabled';
    const LABEL = `${module.name}@${module.version}`;
    process.stdout.write(
      `  · module ${LABEL} (${origin}${STATE})\n`
    );
    return ok(module.name);
  }

  list(): RegisteredModule[] {
    return Array.from(this.modules.values());
  }

  get(module_name: string): RegisteredModule | undefined {
    return this.modules.get(module_name);
  }

  isEnabled(module_name: string): boolean {
    return this.modules.get(module_name)?.enabled === true;
  }

  /** A command is blocked only when its owning module is disabled. */
  isCommandEnabled(command_name: string): boolean {
    const OWNER = this.command_owner.get(command_name);

    if (!OWNER) {
      return true;
    }
    return this.isEnabled(OWNER);
  }

  /**
   * The component handler for a `module:action` customId. Only served
   * while the owning module is enabled.
   */
  getComponentHandler(
    module_name: string,
    action: string
  ): NanoComponentHandler | undefined {
    if (!this.isEnabled(module_name)) {
      return undefined;
    }
    return this.modules.get(module_name)?.module.components?.[action];
  }

  /** A module's named scheduler task (enabled modules only). */
  getTask(
    module_name: string,
    task_name: string
  ): NanoTaskHandler | undefined {
    if (!this.isEnabled(module_name)) {
      return undefined;
    }
    return this.modules.get(module_name)?.module.tasks?.[task_name];
  }

  /** All commands belonging to currently enabled modules. */
  enabledCommands(): NanoCommand[] {
    const COMMANDS: NanoCommand[] = [];

    for (const _entry of this.modules.values()) {
      if (_entry.enabled) {
        COMMANDS.push(...(_entry.module.commands ?? []));
      }
    }
    return COMMANDS;
  }

  async enable(module_name: string): Promise<NanoResult<string>> {
    const ENTRY = this.modules.get(module_name);

    if (!ENTRY) {
      return err(`Module '${module_name}' is not registered.`);
    }

    if (ENTRY.enabled) {
      return ok(module_name);
    }

    ENTRY.enabled = true;

    try {
      await ENTRY.module.onEnable?.(this.bot);
    } catch (error: unknown) {
      ENTRY.enabled = false;
      return err(`onEnable failed for '${module_name}': ${String(error)}`);
    }

    this.options.onStateChange?.(module_name, true);
    return ok(module_name);
  }

  async disable(module_name: string): Promise<NanoResult<string>> {
    const ENTRY = this.modules.get(module_name);

    if (!ENTRY) {
      return err(`Module '${module_name}' is not registered.`);
    }

    if (ENTRY.protected) {
      return err(
        `Module '${module_name}' is protected and cannot be disabled.`
      );
    }

    if (!ENTRY.enabled) {
      return ok(module_name);
    }

    ENTRY.enabled = false;

    try {
      await ENTRY.module.onDisable?.(this.bot);
    } catch (error: unknown) {
      process.stdout.write(
        `[WARN] onDisable failed for '${module_name}': ${String(error)}\n`
      );
    }

    this.options.onStateChange?.(module_name, false);
    return ok(module_name);
  }

  /** Unbind a module's commands and events and drop it from the registry. */
  async removeModule(module_name: string): Promise<NanoResult<string>> {
    const ENTRY = this.modules.get(module_name);

    if (!ENTRY) {
      return err(`Module '${module_name}' is not registered.`);
    }

    if (ENTRY.protected) {
      return err(
        `Module '${module_name}' is protected and cannot be removed.`
      );
    }

    if (ENTRY.enabled) {
      try {
        await ENTRY.module.onDisable?.(this.bot);
      } catch (error: unknown) {
        process.stdout.write(
          `[WARN] onDisable failed for '${module_name}': ${String(error)}\n`
        );
      }
    }

    for (const _bound of this.listeners.get(module_name) ?? []) {
      this.bot.removeListener(_bound.event_name, _bound.listener);
    }
    this.listeners.delete(module_name);

    for (const [_command, _owner] of this.command_owner.entries()) {
      if (_owner === module_name) {
        this.command_owner.delete(_command);
        this.bot.commands.delete(_command);
      }
    }

    this.modules.delete(module_name);
    return ok(module_name);
  }

  /** Health of a single module: built-in state plus its own check. */
  async health(module_name: string): Promise<NanoResult<ModuleHealth>> {
    const ENTRY = this.modules.get(module_name);

    if (!ENTRY) {
      return err(`Module '${module_name}' is not registered.`);
    }

    if (!ENTRY.enabled) {
      return ok({ name: module_name, status: 'disabled' });
    }

    if (!ENTRY.module.healthCheck) {
      return ok({
        name: module_name,
        status: 'healthy',
        details: 'No custom health check.',
      });
    }

    try {
      const REPORT = await ENTRY.module.healthCheck(this.bot);
      return ok({ name: module_name, ...REPORT });
    } catch (error: unknown) {
      return ok({
        name: module_name,
        status: 'down',
        details: String(error),
      });
    }
  }

  /** Health reports for every registered module. */
  async healthAll(): Promise<ModuleHealth[]> {
    const REPORTS: ModuleHealth[] = [];

    for (const _name of this.modules.keys()) {
      const RESULT = await this.health(_name);

      if (RESULT.ok) {
        REPORTS.push(RESULT.data);
      }
    }
    return REPORTS;
  }

  private bindCommands(module: NanoModule): void {
    for (const _command of module.commands ?? []) {
      const COMMAND_NAME = _command.data.name;

      if (this.command_owner.has(COMMAND_NAME)) {
        const OWNER = this.command_owner.get(COMMAND_NAME);
        process.stdout.write(
          `[WARN] Command /${COMMAND_NAME} already owned by '${OWNER}'.\n`
        );
        continue;
      }

      this.command_owner.set(COMMAND_NAME, module.name);
      this.bot.commands.set(COMMAND_NAME, _command);

      if (_command.cooldown) {
        this.options.cooldowns?.defineCooldown(
          COMMAND_NAME,
          _command.cooldown
        );
      }
    }
  }

  private bindEvents(module: NanoModule): void {
    const BOUND: BoundListener[] = [];

    for (const _event of module.events ?? []) {
      const LISTENER = async (...args: unknown[]): Promise<void> => {
        if (!this.isEnabled(module.name)) {
          return;
        }
        await _event.execute(...args);
      };

      if (_event.once) {
        this.bot.once(_event.name, LISTENER);
      } else {
        this.bot.on(_event.name, LISTENER);
      }

      BOUND.push({ event_name: _event.name, listener: LISTENER });
    }

    this.listeners.set(module.name, BOUND);
  }
}
