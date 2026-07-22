import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';

import { getLogger } from '@/services/logger.js';

/**
 * Centralized error handling: process guards, the canonical safe
 * interaction error reply, and per-module execution isolation so one
 * throwing module never crashes the bot.
 */
export interface ProcessGuardOptions {
  onFatal?: () => Promise<void> | void;
}

/**
 * Structural view of "anything that can be replied to" — commands,
 * context menus, components, and modals all satisfy it.
 */
export type ErrorReplyTarget = Pick<
  ChatInputCommandInteraction,
  'replied' | 'deferred' | 'reply' | 'followUp'
>;

const ERROR_REPLY = 'There was an error while executing this command.';

let guards_installed = false;

/** Install process-level guards exactly once. */
export function installProcessGuards(
  options: ProcessGuardOptions = {}
): void {
  if (guards_installed) {
    return;
  }
  guards_installed = true;

  process.on('unhandledRejection', (reason: unknown): void => {
    getLogger().error({ err: reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (error: Error): void => {
    getLogger().fatal({ err: error }, 'Uncaught exception — shutting down');
    Promise.resolve(options.onFatal?.())
      .finally((): void => {
        process.exit(1);
      });
  });
}

/** Reset guard state (tests only). */
export function resetProcessGuards(): void {
  guards_installed = false;
}

/**
 * The canonical error reply: works whether the interaction was already
 * replied to, deferred, or untouched. Never throws.
 */
export async function replyWithError(
  interaction: ErrorReplyTarget,
  message: string = ERROR_REPLY
): Promise<void> {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error: unknown) {
    getLogger().warn({ err: error }, 'Failed to send error reply');
  }
}

/**
 * Wrap a module handler so its throw is logged and answered, never
 * propagated to the gateway loop.
 */
export function wrapExecute<A extends unknown[]>(
  module_id: string,
  fn: (...args: A) => Promise<void> | void
): (...args: A) => Promise<void> {
  return async (...args: A): Promise<void> => {
    try {
      await fn(...args);
    } catch (error: unknown) {
      getLogger()
        .child({ module: module_id })
        .error({ err: error }, 'Module handler failed');
      const FIRST = args[0] as Partial<ErrorReplyTarget> | undefined;

      if (
        FIRST &&
        typeof FIRST.reply === 'function' &&
        typeof FIRST.followUp === 'function'
      ) {
        await replyWithError(FIRST as ErrorReplyTarget);
      }
    }
  };
}
