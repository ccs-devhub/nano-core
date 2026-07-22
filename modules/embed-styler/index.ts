import type {
  ChatInputCommandInteraction,
  NanoModule,
  NanoTheme,
  SlashCommandStringOption
} from '@ccs-devhub/nano-core';
import {
  buildEmbed,
  listThemes,
  registerTheme,
  SlashCommandBuilder
} from '@ccs-devhub/nano-core';

/**
 * Example module (any license welcome — this one is MIT). Shows the
 * three extension points: a theme, a slash command, and a health check.
 * Real modules live in their own repo/package and import the same
 * helpers from '@ccs-devhub/nano-core'.
 */

const MIDNIGHT_THEME: NanoTheme = {
  name: 'midnight',
  color: '#2C2F33',
  footer_text: 'nano-core / embed-styler',
};

const EMBED_COMMAND = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Send a themed embed message.')
    .addStringOption((option: SlashCommandStringOption):
    SlashCommandStringOption => {
      return option.setName('title')
        .setDescription('Embed title')
        .setRequired(true);
    })
    .addStringOption((option: SlashCommandStringOption):
    SlashCommandStringOption => {
      return option.setName('description')
        .setDescription('Embed body text')
        .setRequired(true);
    })
    .addStringOption((option: SlashCommandStringOption):
    SlashCommandStringOption => {
      return option.setName('theme')
        .setDescription('Theme name (defaults to midnight)');
    }),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const TITLE = interaction.options.getString('title', true);
    const DESCRIPTION = interaction.options.getString('description', true);
    const THEME = interaction.options.getString('theme') ?? 'midnight';

    await interaction.reply({
      embeds: [
        buildEmbed({
          title: TITLE,
          description: DESCRIPTION,
          timestamp: true,
        }, THEME),
      ],
    });
  },
};

const MODULE: NanoModule = {
  name: 'embed-styler',
  version: '0.1.0',
  license: 'MIT',
  description: 'Example style module: themed embeds via /embed.',
  commands: [EMBED_COMMAND],

  onEnable: (): void => {
    registerTheme(MIDNIGHT_THEME);
  },

  healthCheck: (): { status: 'healthy' | 'degraded'; details?: string } => {
    if (listThemes().includes('midnight')) {
      return { status: 'healthy' };
    }
    return { status: 'degraded', details: 'midnight theme not registered.' };
  },
};

export default MODULE;
