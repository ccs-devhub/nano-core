import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('user')
    .setDescription('Provides information about the user.'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const USER_NAME: string = interaction.user.username;
    const GUILD_MEMBER: GuildMember |
      null = interaction.member as GuildMember | null;
    const JOINED_AT: Date | undefined = GUILD_MEMBER?.joinedAt;

    await interaction.reply(
      `This command was run by ${USER_NAME}, who joined on
        ${JOINED_AT?.toLocaleString() ?? 'unknown date'}.`
    );
  },
};
