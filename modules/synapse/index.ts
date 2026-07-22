import type {
  AutocompleteInteraction,
  ChannelSummary,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Guild,
  MemberSummary,
  ModuleHealth,
  NanoCommandInteraction,
  NanoComponentInteraction,
  NanoModule,
  Role,
  RoleSummary,
  SlashCommandStringOption,
  SlashCommandSubcommandBuilder
} from '@ccs-devhub/nano-core';
import {
  buildEmbed,
  buttonRow,
  chunk,
  errorEmbed,
  getGuildSnapshot,
  getModuleLogger,
  listMembers,
  listRoles,
  paginate,
  SlashCommandBuilder
} from '@ccs-devhub/nano-core';

/**
 * synapse — the junction that fires signals through the core's body.
 * The base sensory module and reference implementation: it exercises
 * commands, subcommands, autocomplete, components, cooldowns, defer,
 * declared intents, the plain-ids API layer, pagination, and health.
 * License: MIT (modules may use any license).
 */
const MODULE_NAME = 'synapse';
const PAGE_SIZE = 12;
const AUTOCOMPLETE_LIMIT = 25;
const COOLDOWN_MS = 5000;
const COOLDOWN_USES = 3;
const DATE_LENGTH = 10;
const MS_PER_MINUTE = 60000;

const DATA = new SlashCommandBuilder()
  .setName('synapse')
  .setDescription('Base sensory module: scan and inspect this server.')
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('scan')
        .setDescription('Full server snapshot: channels, roles, counts.');
    }
  )
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('roles')
        .setDescription('List every role, highest first.')
        .addStringOption((option: SlashCommandStringOption):
        SlashCommandStringOption => {
          return option.setName('highlight')
            .setDescription('Role to highlight')
            .setAutocomplete(true);
        });
    }
  )
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('members')
        .setDescription(
          'List members (needs the GuildMembers privileged intent).'
        );
    }
  )
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('channels')
        .setDescription('List every channel in position order.');
    }
  )
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('vitals')
        .setDescription('Core health: ws ping, uptime, module reports.');
    }
  )
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('echo')
        .setDescription('Signal roundtrip test.')
        .addStringOption((option: SlashCommandStringOption):
        SlashCommandStringOption => {
          return option.setName('text')
            .setDescription('Text to echo back')
            .setRequired(true);
        });
    }
  );

async function execute(
  interaction: NanoCommandInteraction
): Promise<void> {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (!interaction.guildId) {
    await interaction.editReply({
      embeds: [errorEmbed('synapse only fires inside a server.')],
    });
    return;
  }

  const SUBCOMMAND = interaction.options.getSubcommand();

  if (SUBCOMMAND === 'scan') {
    await handleScan(interaction, interaction.guildId);
    return;
  }

  if (SUBCOMMAND === 'roles') {
    await handleRoles(interaction, interaction.guildId);
    return;
  }

  if (SUBCOMMAND === 'members') {
    await handleMembers(interaction, interaction.guildId);
    return;
  }

  if (SUBCOMMAND === 'channels') {
    await handleChannels(interaction, interaction.guildId);
    return;
  }

  if (SUBCOMMAND === 'vitals') {
    await handleVitals(interaction);
    return;
  }

  const TEXT = interaction.options.getString('text', true);
  const LATENCY = Date.now() - interaction.createdTimestamp;
  await interaction.editReply({
    embeds: [buildEmbed({
      title: 'echo',
      description: TEXT,
      fields: [{ name: 'roundtrip', value: `${LATENCY}ms`, inline: true }],
      timestamp: true,
    })],
  });
}

async function handleScan(
  interaction: ChatInputCommandInteraction,
  guild_id: string
): Promise<void> {
  const PAGES = await buildScanPages(interaction.client, guild_id);

  if (!PAGES.length) {
    await interaction.editReply({
      embeds: [errorEmbed('Scan failed — check the bot permissions.')],
    });
    return;
  }

  await interaction.editReply({
    embeds: [PAGES[0]],
    components: [buttonRow([{
      module: MODULE_NAME,
      action: 'rescan',
      args: [guild_id],
      label: 'Rescan',
      style: 'primary',
    }])],
  });

  if (PAGES.length > 1) {
    await paginate(interaction, PAGES);
  }
}

async function buildScanPages(
  bot: Client,
  guild_id: string
): Promise<EmbedBuilder[]> {
  const SNAPSHOT = await getGuildSnapshot(bot, guild_id);

  if (!SNAPSHOT.ok) {
    return [];
  }

  const DATA_PAGE = buildEmbed({
    title: `scan: ${SNAPSHOT.data.name}`,
    description: SNAPSHOT.data.description ?? 'No description.',
    fields: [
      {
        name: 'members',
        value: String(SNAPSHOT.data.member_count),
        inline: true,
      },
      {
        name: 'channels',
        value: String(SNAPSHOT.data.channels.length),
        inline: true,
      },
      {
        name: 'roles',
        value: String(SNAPSHOT.data.roles.length),
        inline: true,
      },
      {
        name: 'created',
        value: SNAPSHOT.data.created_at.slice(0, DATE_LENGTH),
        inline: true,
      },
    ],
    timestamp: true,
  });
  const CHANNEL_PAGES = chunk(SNAPSHOT.data.channels, PAGE_SIZE)
    .map((page: ChannelSummary[], index: number): EmbedBuilder => {
      return buildEmbed({
        title: `channels (page ${index + 1})`,
        description: page.map((channel: ChannelSummary): string => {
          return `${channel.position}. ${channel.name} [${channel.type}]`;
        }).join('\n'),
      });
    });
  return [DATA_PAGE, ...CHANNEL_PAGES];
}

async function handleRoles(
  interaction: ChatInputCommandInteraction,
  guild_id: string
): Promise<void> {
  const ROLES = await listRoles(interaction.client, guild_id);

  if (!ROLES.ok) {
    await interaction.editReply({ embeds: [errorEmbed(ROLES.error)] });
    return;
  }

  const HIGHLIGHT = interaction.options.getString('highlight');
  const PAGES = chunk(ROLES.data, PAGE_SIZE).map(
    (page: RoleSummary[], index: number): EmbedBuilder => {
      return buildEmbed({
        title: `roles (page ${index + 1})`,
        description: page.map((role: RoleSummary): string => {
          const MARK = role.id === HIGHLIGHT ? ' <<' : '';
          return `${role.position}. ${role.name} (${role.color})${MARK}`;
        }).join('\n'),
      });
    }
  );
  await paginate(interaction, PAGES);
}

async function handleMembers(
  interaction: ChatInputCommandInteraction,
  guild_id: string
): Promise<void> {
  const MEMBERS = await listMembers(interaction.client, guild_id);

  if (!MEMBERS.ok) {
    await interaction.editReply({
      embeds: [errorEmbed(
        `${MEMBERS.error} (is the GuildMembers intent enabled in ` +
        'nano.config.json AND the developer portal?)'
      )],
    });
    return;
  }

  const PAGES = chunk(MEMBERS.data, PAGE_SIZE).map(
    (page: MemberSummary[], index: number): EmbedBuilder => {
      return buildEmbed({
        title: `members (page ${index + 1})`,
        description: page.map((member: MemberSummary): string => {
          const BOT_MARK = member.is_bot ? ' [bot]' : '';
          return `${member.display_name} (${member.username})${BOT_MARK}`;
        }).join('\n'),
      });
    }
  );
  await paginate(interaction, PAGES);
}

async function handleChannels(
  interaction: ChatInputCommandInteraction,
  guild_id: string
): Promise<void> {
  const PAGES = await buildScanPages(interaction.client, guild_id);
  await paginate(interaction, PAGES.slice(1));
}

async function handleVitals(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const SERVICES = interaction.client.services;
  const REGISTRY = interaction.client.nano;
  const HEALTH = await SERVICES.lifecycle.getHealth(REGISTRY);
  const MODULE_LINES = HEALTH.modules.map(
    (report: ModuleHealth): string => {
      const DETAILS = report.details ? ` — ${report.details}` : '';
      return `${report.name}: ${report.status}${DETAILS}`;
    }
  ).join('\n');

  await interaction.editReply({
    embeds: [buildEmbed({
      title: 'vitals',
      fields: [
        { name: 'status', value: HEALTH.status, inline: true },
        { name: 'ws ping', value: `${HEALTH.ws_ping_ms}ms`, inline: true },
        {
          name: 'uptime',
          value: `${Math.floor(HEALTH.uptime_ms / MS_PER_MINUTE)}m`,
          inline: true,
        },
        { name: 'guilds', value: String(HEALTH.guild_count), inline: true },
        { name: 'modules', value: MODULE_LINES || 'none' },
      ],
      timestamp: true,
    })],
  });
}

async function autocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const GUILD: Guild | null = interaction.guild;
  const FOCUSED = interaction.options.getFocused().toLowerCase();
  const CHOICES = GUILD
    ? GUILD.roles.cache
      .filter((role: Role): boolean => {
        return role.name.toLowerCase().includes(FOCUSED);
      })
      .map((role: Role): { name: string; value: string } => {
        return { name: role.name, value: role.id };
      })
      .slice(0, AUTOCOMPLETE_LIMIT)
    : [];
  await interaction.respond(CHOICES);
}

async function rescan(
  interaction: NanoComponentInteraction,
  args: string[]
): Promise<void> {
  if (!interaction.isButton() || !args[0]) {
    return;
  }

  const PAGES = await buildScanPages(interaction.client, args[0]);

  if (PAGES.length > 0) {
    await interaction.update({ embeds: [PAGES[0]] });
  }
}

const MODULE: NanoModule = {
  name: MODULE_NAME,
  version: '0.1.0',
  license: 'MIT',
  description:
    'Base sensory module: scan guilds, roles, members, channels; ' +
    'core vitals and echo tests.',

  commands: [{
    data: DATA,
    defer: true,
    cooldown: {
      scope: 'user',
      delay_ms: COOLDOWN_MS,
      limit: COOLDOWN_USES,
    },
    execute,
    autocomplete,
  }],

  components: { rescan },

  events: [
    {
      name: 'guildMemberAdd',
      intents: ['GuildMembers'],
      execute: (...args: unknown[]): void => {
        const MEMBER = args[0] as { user?: { tag?: string } };
        getModuleLogger(MODULE_NAME).info(
          { user: MEMBER.user?.tag },
          'Member joined'
        );
      },
    },
    {
      name: 'guildMemberRemove',
      intents: ['GuildMembers'],
      execute: (...args: unknown[]): void => {
        const MEMBER = args[0] as { user?: { tag?: string } };
        getModuleLogger(MODULE_NAME).info(
          { user: MEMBER.user?.tag },
          'Member left'
        );
      },
    },
  ],

  healthCheck: (): { status: 'healthy' } => {
    return { status: 'healthy' };
  },
};

export default MODULE;
