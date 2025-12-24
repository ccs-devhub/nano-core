import { Client, GatewayIntentBits } from 'discord.js';

import 'dotenv/config';

const BOT = new Client({
  intents: [GatewayIntentBits.Guilds],
});

BOT.once('ready', (): void => {
  process.stdout.write(`Logged in as ${BOT.user?.tag}\n`);
});

BOT.login(process.env.DISCORD_TOKEN);
