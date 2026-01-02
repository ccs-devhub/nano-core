import type { Client } from 'discord.js';
import { REST, Routes } from 'discord.js';

export async function registerGCommands(
  bot: Client | undefined,
  token?: string,
  client_id?: string
): Promise<void> {
  if (!bot) {
    process.stdout.write(`[ERROR] registerGlobalCommands called
      without bot instance. Skipping.\n`);
    return;
  }

  if (!bot.commands) {
    process.stdout.write(`[ERROR] bot.commands is not initialized.
      Skipping command registration.\n`);
    return;
  }

  if (!token || !client_id) {
    process.stdout.write(`[ERROR] token or client_id missing.
      Skipping command registration.\n`);
    return;
  }

  const COMMANDS_PAYLOAD: unknown[] = Array.from(bot.commands.values())
    .map((cmd: any): unknown => {
      // guard: ensure data and toJSON exist
      if (cmd?.data && typeof cmd.data.toJSON === 'function') {
        process.stdout.write(`This is Command: ${cmd.data.name}\n`);
        return cmd.data.toJSON();
      }
      process.stdout.write('Skipping an item without valid .data.toJSON()\n');
      return null;
    })
    .filter(Boolean);

  if (COMMANDS_PAYLOAD.length === 0) {
    process.stdout.write(':: No commands to register globally.\n');
    return;
  }

  const REST_CLIENT = new REST({ version: '10' }).setToken(token);

  try {
    process.stdout.write(`:: Registering ${COMMANDS_PAYLOAD.length}
      global slash commands...\n`);

    const _data = await REST_CLIENT.put(
      Routes.applicationCommands(client_id),
      { body: COMMANDS_PAYLOAD }
    );

    process.stdout.write(`:: Successfully registered
      ${(_data as unknown[]).length} global commands.\n`);
  } catch (error: unknown) {
    process.stdout.write('[ERROR] Failed to register global commands:\n');
    process.stdout.write(`${String(error)}\n`);
  }
}
