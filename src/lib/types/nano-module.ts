import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  ContextMenuCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction
} from 'discord.js';

import type { CooldownSpec } from '@/services/cooldown.js';

/** Minimal shape a slash/context-menu command builder must expose. */
export interface NanoCommandData {
  name: string;
  toJSON(): unknown;
}

export type NanoCommandInteraction =
  | ChatInputCommandInteraction
  | ContextMenuCommandInteraction;

/**
 * A command contributed by a module. `defer` makes the dispatcher
 * defer the reply immediately (use editReply/followUp afterwards) —
 * set it when the handler may exceed Discord's 3-second ack window.
 */
export interface NanoCommand {
  data: NanoCommandData;
  cooldown?: CooldownSpec;
  defer?: boolean | 'ephemeral';
  execute(interaction: NanoCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

/** A single gateway event listener contributed by a module. */
export interface NanoEvent {
  name: string;
  once?: boolean;
  /** Gateway intents this listener needs (e.g. 'GuildMembers'). */
  intents?: string[];
  execute(...args: unknown[]): Promise<void> | void;
}

export type NanoComponentInteraction =
  | MessageComponentInteraction
  | ModalSubmitInteraction;

/**
 * Handler for buttons/selects/modals routed by the `module:action:args`
 * customId convention (see @/misc/utility/custom-id.js).
 */
export type NanoComponentHandler = (
  interaction: NanoComponentInteraction,
  args: string[]
) => Promise<void> | void;

/** Named handler for scheduler tasks (persistent one-shots re-arm). */
export type NanoTaskHandler = (payload?: unknown) => Promise<void> | void;

export type NanoHealthStatus = 'healthy' | 'degraded' | 'down' | 'disabled';

/**
 * What a module contributes to the bot. An `extension` adds core
 * capability without any slash command (e.g. the mcp bridge), a
 * `command` module only ships commands, and a `hybrid` does both.
 */
export type NanoModuleKind = 'extension' | 'command' | 'hybrid';

export interface NanoHealthReport {
  status: NanoHealthStatus;
  details?: string;
}

/**
 * The contract every nano-core module implements. A module is a plain
 * object (default export) bundling commands, events, component/task
 * handlers, lifecycle hooks and an optional health check. Modules may
 * use any license.
 */
export interface NanoModule {
  name: string;
  version: string;
  description?: string;
  license?: string;
  /** Declared kind; derived from the contents when omitted. */
  kind?: NanoModuleKind;
  commands?: NanoCommand[];
  events?: NanoEvent[];
  /** Component handlers keyed by action (customId `module:action`). */
  components?: Record<string, NanoComponentHandler>;
  /** Scheduler task handlers keyed by job name. */
  tasks?: Record<string, NanoTaskHandler>;
  /** Path to the module's declarative TUI panel manifest (JSON). */
  tui?: string;
  onEnable?(bot: Client): Promise<void> | void;
  onDisable?(bot: Client): Promise<void> | void;
  healthCheck?(bot: Client): Promise<NanoHealthReport> | NanoHealthReport;
}

/**
 * Resolve a module's kind: the declared field wins, otherwise derive
 * it — commands plus events/tasks make a hybrid, commands alone a
 * command module, anything else a core extension.
 */
export function moduleKind(module: NanoModule): NanoModuleKind {
  if (module.kind) {
    return module.kind;
  }

  const HAS_COMMANDS = (module.commands ?? []).length > 0;
  const HAS_CORE_HOOKS = (module.events ?? []).length > 0 ||
    Object.keys(module.tasks ?? {}).length > 0;

  if (HAS_COMMANDS && HAS_CORE_HOOKS) {
    return 'hybrid';
  }

  if (HAS_COMMANDS) {
    return 'command';
  }
  return 'extension';
}

/** Runtime guard used when loading untyped module files. */
export function isNanoCommand(value: unknown): value is NanoCommand {
  const CANDIDATE = value as NanoCommand | null;
  return typeof CANDIDATE?.data?.name === 'string' &&
    typeof CANDIDATE?.execute === 'function';
}

/** Runtime guard used when loading untyped event files. */
export function isNanoEvent(value: unknown): value is NanoEvent {
  const CANDIDATE = value as NanoEvent | null;
  return typeof CANDIDATE?.name === 'string' &&
    typeof CANDIDATE?.execute === 'function';
}

/** Runtime guard used when importing external modules. */
export function isNanoModule(value: unknown): value is NanoModule {
  const CANDIDATE = value as NanoModule | null;
  return typeof CANDIDATE?.name === 'string' &&
    typeof CANDIDATE?.version === 'string';
}
