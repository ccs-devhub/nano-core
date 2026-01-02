import type { Interaction } from 'discord.js';

export default {
  name: 'interactionCreate',

  async execute(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const COMMAND = interaction.client.commands.get(
      interaction.commandName
    );

    if (!COMMAND) {
      return;
    }

    await COMMAND.execute(interaction);
  },
};
