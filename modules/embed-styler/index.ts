import type {
  Attachment,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  EmbedSpec,
  EmbedTemplate,
  NanoModule,
  NanoTheme,
  SlashCommandAttachmentOption,
  SlashCommandChannelOption,
  SlashCommandStringOption,
  SlashCommandSubcommandBuilder
} from '@ccs-devhub/nano-core';
import {
  buildEmbed,
  ChannelType,
  fillTemplateSlots,
  getEmbedTemplate,
  getModuleConfig,
  listEmbedTemplates,
  listThemes,
  PermissionFlagsBits,
  registerEmbedTemplate,
  registerTheme,
  sendMessage,
  SlashCommandBuilder
} from '@ccs-devhub/nano-core';

/**
 * embed-styler - the embed customization module (MIT). The core covers
 * embeds 100% with default styling; this module layers customization
 * on top: a theme, five ready-to-call templates, and /embed to fill a
 * template, attach an image, and send it to any channel.
 */
const MIDNIGHT_THEME: NanoTheme = {
  name: 'midnight',
  color: '#2C2F33',
  footer_text: 'nano-core / embed-styler',
};

const ALERT_COLOR = '#ED4245';
const NOTICE_COLOR = '#5865F2';
const WELCOME_COLOR = '#57F287';

/*
 * Shipped templates share a tiny slot convention: {{title}} and
 * {{message}} come from the command options; {{user}}, {{guild}} and
 * {{version}} are filled automatically or via the version option.
 */
const TEMPLATES: EmbedTemplate[] = [
  {
    name: 'announcement',
    description: 'Server announcement with an author header.',
    spec: {
      author_name: '{{guild}}',
      title: '{{title}}',
      description: '{{message}}',
      timestamp: true,
    },
  },
  {
    name: 'alert',
    description: 'Red attention banner for urgent notices.',
    spec: {
      color: ALERT_COLOR,
      title: '{{title}}',
      description: '{{message}}',
      footer_text: 'alert',
      timestamp: true,
    },
  },
  {
    name: 'notice',
    description: 'Neutral informational card.',
    spec: {
      color: NOTICE_COLOR,
      title: '{{title}}',
      description: '{{message}}',
      timestamp: true,
    },
  },
  {
    name: 'changelog',
    description: 'Release notes: version plus the changes list.',
    spec: {
      title: '{{version}} — {{title}}',
      description: '{{message}}',
      footer_text: 'changelog',
      timestamp: true,
    },
  },
  {
    name: 'welcome',
    description: 'Greets a member by name.',
    spec: {
      color: WELCOME_COLOR,
      title: 'Welcome {{user}}!',
      description: '{{message}}',
      timestamp: true,
    },
  },
];

const MAX_AUTOCOMPLETE_CHOICES = 25;

function templateOption(
  option: SlashCommandStringOption
): SlashCommandStringOption {
  return option.setName('template')
    .setDescription('Template to render (see /embed templates)')
    .setRequired(true)
    .setAutocomplete(true);
}

function fillOptions(
  sub: SlashCommandSubcommandBuilder
): SlashCommandSubcommandBuilder {
  return sub
    .addStringOption(templateOption)
    .addStringOption((option: SlashCommandStringOption):
    SlashCommandStringOption => {
      return option.setName('title')
        .setDescription('Fills {{title}}')
        .setRequired(true);
    })
    .addStringOption((option: SlashCommandStringOption):
    SlashCommandStringOption => {
      return option.setName('message')
        .setDescription('Fills {{message}}')
        .setRequired(true);
    })
    .addStringOption((option: SlashCommandStringOption):
    SlashCommandStringOption => {
      return option.setName('version')
        .setDescription('Fills {{version}} (changelog template)');
    })
    .addStringOption((option: SlashCommandStringOption):
    SlashCommandStringOption => {
      return option.setName('theme')
        .setDescription('Theme name (defaults to midnight)');
    })
    .addAttachmentOption((option: SlashCommandAttachmentOption):
    SlashCommandAttachmentOption => {
      return option.setName('image')
        .setDescription('Image shown inside the embed');
    });
}

const DATA = new SlashCommandBuilder()
  .setName('embed')
  .setDescription('Render and send template-based embeds.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand((sub: SlashCommandSubcommandBuilder):
  SlashCommandSubcommandBuilder => {
    return fillOptions(
      sub.setName('send')
        .setDescription('Send a filled template to a channel.')
    ).addChannelOption((option: SlashCommandChannelOption):
    SlashCommandChannelOption => {
      return option.setName('channel')
        .setDescription('Target channel (defaults to here)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    });
  })
  .addSubcommand((sub: SlashCommandSubcommandBuilder):
  SlashCommandSubcommandBuilder => {
    return fillOptions(
      sub.setName('preview')
        .setDescription('Render a template only you can see.')
    );
  })
  .addSubcommand((sub: SlashCommandSubcommandBuilder):
  SlashCommandSubcommandBuilder => {
    return sub.setName('templates')
      .setDescription('List every registered embed template.');
  });

function buildSpecFromOptions(
  interaction: ChatInputCommandInteraction
): { spec: EmbedSpec; theme?: string } | { error: string } {
  const TEMPLATE_NAME = interaction.options.getString('template', true);
  const TEMPLATE = getEmbedTemplate(TEMPLATE_NAME);

  if (!TEMPLATE) {
    const KNOWN = listEmbedTemplates()
      .map((template: EmbedTemplate): string => {
        return template.name;
      })
      .join(', ');
    return { error: `Unknown template '${TEMPLATE_NAME}'. Known: ${KNOWN}.` };
  }

  const IMAGE: Attachment | null = interaction.options
    .getAttachment('image');
  const FILLED = fillTemplateSlots(TEMPLATE.spec, {
    title: interaction.options.getString('title', true),
    message: interaction.options.getString('message', true),
    version: interaction.options.getString('version') ?? '',
    user: interaction.user.displayName,
    guild: interaction.guild?.name ?? '',
  });

  const CONFIGURED_THEME = getModuleConfig<{ default_theme?: string }>(
    'embed-styler'
  )?.default_theme;
  return {
    spec: IMAGE ? { ...FILLED, image_url: IMAGE.url } : FILLED,
    theme: interaction.options.getString('theme') ??
      CONFIGURED_THEME ?? 'midnight',
  };
}

async function handleSend(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const BUILT = buildSpecFromOptions(interaction);

  if ('error' in BUILT) {
    await interaction.editReply(BUILT.error);
    return;
  }

  const TARGET = interaction.options.getChannel('channel');
  const CHANNEL_ID = TARGET?.id ?? interaction.channelId;
  const SENT = await sendMessage(interaction.client, CHANNEL_ID, {
    embed: BUILT.spec,
    theme: BUILT.theme,
  });

  if (!SENT.ok) {
    await interaction.editReply(`Could not send: ${SENT.error}`);
    return;
  }
  await interaction.editReply(`Embed sent to <#${CHANNEL_ID}>.`);
}

async function handlePreview(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const BUILT = buildSpecFromOptions(interaction);

  if ('error' in BUILT) {
    await interaction.editReply(BUILT.error);
    return;
  }
  await interaction.editReply({
    embeds: [buildEmbed(BUILT.spec, BUILT.theme)],
  });
}

async function handleTemplates(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const LINES = listEmbedTemplates()
    .map((template: EmbedTemplate): string => {
      const SLOTS = (template.slots ?? []).join(', ') || 'none';
      return `- **${template.name}** — ` +
        `${template.description ?? 'No description.'} (slots: ${SLOTS})`;
    })
    .join('\n');
  await interaction.editReply({
    embeds: [buildEmbed({
      title: 'Embed templates',
      description: LINES,
      footer_text: `themes: ${listThemes().join(', ')}`,
    }, 'midnight')],
  });
}

const EMBED_COMMAND = {
  data: DATA,
  defer: 'ephemeral' as const,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const SUBCOMMAND = interaction.options.getSubcommand();

    if (SUBCOMMAND === 'send') {
      await handleSend(interaction);
      return;
    }

    if (SUBCOMMAND === 'preview') {
      await handlePreview(interaction);
      return;
    }
    await handleTemplates(interaction);
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const TYPED = interaction.options.getFocused().toLowerCase();
    const CHOICES = listEmbedTemplates()
      .map((template: EmbedTemplate): string => {
        return template.name;
      })
      .filter((name: string): boolean => {
        return name.toLowerCase().startsWith(TYPED);
      })
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map((name: string): { name: string; value: string } => {
        return { name, value: name };
      });
    await interaction.respond(CHOICES);
  },
};

const MODULE: NanoModule = {
  name: 'embed-styler',
  version: '0.2.0',
  license: 'MIT',
  kind: 'command',
  description: 'Embed customization with themes, five templates ' +
    'and the /embed command.',
  tui: 'nano-tui.json',
  commands: [EMBED_COMMAND],

  onEnable: (): void => {
    registerTheme(MIDNIGHT_THEME);

    for (const _template of TEMPLATES) {
      registerEmbedTemplate(_template);
    }
  },

  healthCheck: (): { status: 'healthy' | 'degraded'; details?: string } => {
    const MISSING = TEMPLATES
      .map((template: EmbedTemplate): string => {
        return template.name;
      })
      .filter((name: string): boolean => {
        return getEmbedTemplate(name) === undefined;
      });

    if (!listThemes().includes('midnight')) {
      return { status: 'degraded', details: 'midnight theme not registered.' };
    }

    if (MISSING.length > 0) {
      return {
        status: 'degraded',
        details: `templates not registered: ${MISSING.join(', ')}.`,
      };
    }
    return { status: 'healthy' };
  },
};

export default MODULE;
