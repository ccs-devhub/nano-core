import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Client,
  Collection,
  GatewayIntentBits
} from 'discord.js';

import { loadModules } from '@/misc/io/load-ts-modules.js';
import { registerGCommands } from '@/misc/utility/register-global-commands.js';

import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BOT: Client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const TOKEN: string | undefined = process.env.DISCORD_TOKEN;
const CLIENT_ID: string | undefined = process.env.CLIENT_ID;

BOT.commands = new Collection<string, unknown>();

const CORE_COMMANDS_PATH: string = join(__dirname, 'core', 'commands');
const CORE_EVENTS_PATH: string = join(__dirname, 'core', 'events');

const _commands = await loadModules(CORE_COMMANDS_PATH);
const _events = await loadModules(CORE_EVENTS_PATH);

for (const _command of _commands) {
  if (_command?.data && _command.execute) {
    process.stdout.write(`COMMAND [${_command?.data.name}]: Initialized\n`);
    BOT.commands.set(_command.data.name, _command);
  }
}

/* Register commands only if we have the token and client id */
if (!TOKEN || !CLIENT_ID) {
  process.stdout.write(`[ERROR] DISCORD_TOKEN or CLIENT_ID is missing.
    Skipping command registration.\n`);
} else {
  await registerGCommands(BOT, TOKEN, CLIENT_ID);
}

for (const _event of _events) {
  if (_event?.name && _event.execute) {
    process.stdout.write(`EVENT [${_event?.name}]: Initialized\n`);
    if (_event?.once) {
      BOT.once(_event.name, (...args: any[]): any => {
        return _event.execute(...args);
      });
    } else {
      BOT.on(_event.name, (...args: any[]): any => {
        return _event.execute(...args);
      });
    }
  }
}

/* Start the bot (use the TOKEN variable so it's consistent) */
if (TOKEN) {
  await BOT.login(TOKEN);
} else {
  process.stdout.write('[ERROR] No token provided — bot login skipped.\n');
}
