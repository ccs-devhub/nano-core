import { REST, Routes } from 'discord.js';

import { getLogger } from '@/services/logger.js';
import type { NanoCommand } from '@/types/nano-module.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * REST command synchronizer. Always DIFF before PUT: Discord caps
 * global command creates at 200/day/application, so an unchanged set
 * must never be re-registered. Guild scope registers instantly (use
 * `bot.dev_guild_id` while developing); global takes up to an hour.
 */
export interface SyncOptions {
  token: string;
  client_id: string;
  guild_id?: string;
  force?: boolean;
}

export interface SyncReport {
  count: number;
  skipped: boolean;
  scope: 'global' | 'guild';
}

const DISCORD_API_VERSION = '10';

export async function syncCommands(
  commands: NanoCommand[],
  options: SyncOptions
): Promise<NanoResult<SyncReport>> {
  const SCOPE = options.guild_id ? 'guild' : 'global';
  const ROUTE = options.guild_id
    ? Routes.applicationGuildCommands(options.client_id, options.guild_id)
    : Routes.applicationCommands(options.client_id);
  const PAYLOAD = commands.map((command: NanoCommand): unknown => {
    return command.data.toJSON();
  });
  const REST_CLIENT = new REST({ version: DISCORD_API_VERSION })
    .setToken(options.token);

  try {
    if (!options.force) {
      const REMOTE = await REST_CLIENT.get(ROUTE) as unknown[];

      if (commandsMatch(PAYLOAD, REMOTE)) {
        getLogger().info(
          `Slash commands unchanged (${PAYLOAD.length} ${SCOPE}) — ` +
          'skipping registration'
        );
        return ok({ count: PAYLOAD.length, skipped: true, scope: SCOPE });
      }
    }

    getLogger().info(
      `Registering ${PAYLOAD.length} ${SCOPE} slash command(s)`
    );
    const DATA = await REST_CLIENT.put(ROUTE, { body: PAYLOAD });
    const COUNT = Array.isArray(DATA) ? DATA.length : PAYLOAD.length;
    return ok({ count: COUNT, skipped: false, scope: SCOPE });
  } catch (error: unknown) {
    return err(error);
  }
}

/** Wipe every registered command in the given scope. */
export async function deleteAllCommands(
  options: SyncOptions
): Promise<NanoResult<number>> {
  const ROUTE = options.guild_id
    ? Routes.applicationGuildCommands(options.client_id, options.guild_id)
    : Routes.applicationCommands(options.client_id);
  const REST_CLIENT = new REST({ version: DISCORD_API_VERSION })
    .setToken(options.token);

  try {
    await REST_CLIENT.put(ROUTE, { body: [] });
    return ok(0);
  } catch (error: unknown) {
    return err(error);
  }
}

interface CommandLike {
  name?: string;
  description?: string;
  type?: number;
  options?: unknown[];
  default_member_permissions?: string | null;
}

const CHAT_INPUT_TYPE = 1;

/**
 * Conservative equality on the fields we author. A false negative just
 * causes a harmless PUT; a false positive would silently skip a real
 * change, so only exact normalized matches count.
 */
export function commandsMatch(local: unknown[], remote: unknown[]): boolean {
  if (local.length !== remote.length) {
    return false;
  }

  const REMOTE_BY_NAME = new Map(
    (remote as CommandLike[]).map((cmd: CommandLike): [string, string] => {
      return [cmd.name ?? '', normalize(cmd)];
    })
  );
  return (local as CommandLike[]).every((cmd: CommandLike): boolean => {
    return REMOTE_BY_NAME.get(cmd.name ?? '') === normalize(cmd);
  });
}

function normalize(command: CommandLike): string {
  return JSON.stringify({
    description: command.description ?? '',
    type: command.type ?? CHAT_INPUT_TYPE,
    options: normalizeOptions(command.options ?? []),
    perms: command.default_member_permissions ?? null,
  });
}

function normalizeOptions(options: unknown[]): unknown[] {
  return options.map((option: unknown): unknown => {
    const RAW = option as Record<string, unknown>;
    return {
      name: RAW.name,
      description: RAW.description,
      type: RAW.type,
      required: RAW.required ?? false,
      options: Array.isArray(RAW.options)
        ? normalizeOptions(RAW.options)
        : [],
      choices: RAW.choices ?? [],
      autocomplete: RAW.autocomplete ?? false,
    };
  });
}
