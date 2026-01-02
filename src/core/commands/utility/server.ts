import type { ChatInputCommandInteraction, Guild } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Provides information about the server.'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const GUILD: Guild | null = interaction.guild;
    if (!GUILD) {
      await interaction.reply('This command can only be used in a server.');
      return;
    }
    await interaction.reply(
      `This server is ${GUILD.name} and has ${GUILD.memberCount} members.`
    );
  },
};
