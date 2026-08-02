import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  ContextMenuCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction
} from 'discord.js';

import type { CooldownSpec } from '@/services/cooldown.js';
import type { NanoResult } from '@/types/nano-result.js';

/** Minimal shape a slash/context-menu command builder must expose. */
export interface NanoCommandData {
  name: string;
  toJSON(): unknown;
}

export type NanoCommandInteraction =
  | ChatInputCommandInteraction
  | ContextMenuCommandInteraction;

/**
 * One help card, rendered by /help as the detail view. Usage follows
 * the canonical grammar `<required> [optional]`; examples must be
 * realistic and guild-neutral. `permissions` is free text ONLY for
 * gates the builder cannot express — the enforced value is always
 * read from the builder's default_member_permissions.
 */
export interface NanoHelpCard {
  long: string;
  usage: string;
  examples: string[];
  permissions?: string;
}

/**
 * A command's full help surface. Commands with subcommands declare
 * one card per subcommand path (`'list'`, `'group add'`) so /help
 * can resolve `/help module sync` to exactly that card.
 */
export interface NanoCommandHelp extends NanoHelpCard {
  subcommands?: Record<string, NanoHelpCard>;
}

/**
 * A command contributed by a module. `defer` makes the dispatcher
 * defer the reply immediately (use editReply/followUp afterwards) —
 * set it when the handler may exceed Discord's 3-second ack window.
 */
export interface NanoCommand {
  data: NanoCommandData;
  help?: NanoCommandHelp;
  cooldown?: CooldownSpec;
  defer?: boolean | 'ephemeral';
  execute(interaction: NanoCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

/** A single gateway event listener contributed by a module. */
export interface NanoEvent {
  name: string;
  /** One line: what it reacts to and why it exists. */
  description?: string;
  once?: boolean;
  /** Gateway intents this listener needs (e.g. 'GuildMembers'). */
  intents?: string[];
  /**
   * Client partials this listener needs (e.g. 'Message', 'Reaction').
   * Partials are GLOBAL: once any module declares one, EVERY module's
   * listeners receive partial objects and must handle them.
   */
  partials?: string[];
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

/** A described scheduler task: the handler plus its one-line purpose. */
export interface NanoTask {
  description: string;
  run: NanoTaskHandler;
}

/**
 * Value shape of a module's `tasks` record: a bare handler keeps the
 * historical contract; the object form adds the description /help
 * and the completeness gate read.
 */
export type NanoTaskEntry = NanoTaskHandler | NanoTask;

/** The callable behind a task entry, whichever form it uses. */
export function taskHandler(entry: NanoTaskEntry): NanoTaskHandler {
  if (typeof entry === 'function') {
    return entry;
  }
  return entry.run;
}

/** The one-line description of a task entry, when declared. */
export function taskDescription(entry: NanoTaskEntry): string | undefined {
  if (typeof entry === 'function') {
    return undefined;
  }
  return entry.description;
}

export type ReconcileReason = 'boot' | 'enable' | 'manual';

export interface ReconcileReport {
  checked: number;
  fixed: number;
  skipped: number;
  unrecoverable: number;
  deferred: number;
}

export interface ReconcileDowntime {
  last_alive_at: number | null;
  /** Clamped to reconcile_max_lookback — never an unbounded dig. */
  down_ms: number | null;
  /** No ledger stamp yet: modules SEED, never flood (DB2-5). */
  first_boot: boolean;
}

export interface ReconcileContext {
  reason: ReconcileReason;
  downtime: ReconcileDowntime;
  /** THIS process/shard's guilds — reconcile is shard-correct. */
  guild_ids: string[];
}

/**
 * One catch-up task (the CATCH-UP LAW): compare Discord-now against
 * the module's own tables and heal the difference through the SAME
 * write paths the live handlers use — a STATE DIFF, never an event
 * replay. Tasks must be idempotent and read-current-before-write.
 */
export interface NanoReconcileTask {
  /** Charset [a-z0-9_-] (N16). */
  id: string;
  description: string;
  run(context: ReconcileContext):
  Promise<NanoResult<ReconcileReport>> | NanoResult<ReconcileReport>;
}

/** Plain-JSON record handed to post-command hooks (A2). */
export interface PostCommandContext {
  command_name: string;
  subcommand_path?: string;
  user_id: string;
  guild_id: string | null;
  channel_id: string | null;
  duration_ms: number;
}

/**
 * The post-command connection (A2): the kernel mandates ONE
 * interactionCreate listener total, so a module that reacts to
 * command use (XP, metrics) declares this hook instead of its own
 * listener. Runs after every SUCCESSFUL command execution — of ANY
 * module — in registration order; a hook failure is isolated and
 * never affects the command reply.
 */
export type PostCommandHook = (
  context: PostCommandContext
) => Promise<void> | void;

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
  /**
   * Numeric gauges the module wants surfaced by the vitals layer
   * (accumulator depth, queue depth, flush_ms, flush_failures...).
   */
  metrics?: Record<string, number>;
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
  tasks?: Record<string, NanoTaskEntry>;
  /** Observer invoked after every successful command execution (A2). */
  postCommand?: PostCommandHook;
  /** Catch-up tasks the core runs at boot/enable/manual trigger. */
  reconcile?: NanoReconcileTask[];
  /**
   * The API surface this module offers other modules, served through
   * ModuleRegistry.getModuleApi(). Consumers must resolve it lazily
   * at every call site — never capture it at onEnable.
   */
  provides?: Record<string, unknown>;
  /** Coarse contract version for `provides` (compared exactly). */
  api_version?: string;
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
