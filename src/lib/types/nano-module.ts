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
