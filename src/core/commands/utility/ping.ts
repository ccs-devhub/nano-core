import type { ChatInputCommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong!'),

  help: {
    long:
      'A liveness check. The bot answers immediately when it is ' +
      'online and processing interactions, use it to confirm the ' +
      'bot is responsive before debugging anything else.',
    usage: '/ping',
    examples: ['/ping'],
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply('Pong!');
  },
};
