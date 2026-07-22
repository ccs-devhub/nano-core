import type {
  ChatInputCommandInteraction,
  SlashCommandStringOption,
  SlashCommandSubcommandBuilder
} from 'discord.js';
import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';

import type { EmbedFieldSpec } from '@/api/embed.js';
import { buildEmbed } from '@/api/embed.js';
import { registerGlobalCommands } from
  '@/misc/utility/register-global-commands.js';
import type {
  ModuleHealth,
  RegisteredModule
} from '@/registry/module-registry.js';

const MAX_EMBED_FIELDS = 25;

const DATA = new SlashCommandBuilder()
  .setName('module')
  .setDescription('Manage nano-core modules.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('list')
        .setDescription('List every registered module and its state.');
    }
  )
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('enable')
        .setDescription('Enable a module.')
        .addStringOption((option: SlashCommandStringOption):
        SlashCommandStringOption => {
          return option.setName('name')
            .setDescription('Module name')
            .setRequired(true);
        });
    }
  )
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('disable')
        .setDescription('Disable a module without removing it.')
        .addStringOption((option: SlashCommandStringOption):
        SlashCommandStringOption => {
          return option.setName('name')
            .setDescription('Module name')
            .setRequired(true);
        });
    }
  )
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('health')
        .setDescription('Report module health.')
        .addStringOption((option: SlashCommandStringOption):
        SlashCommandStringOption => {
          return option.setName('name')
            .setDescription('Module name (omit for all modules)');
        });
    }
  )
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('sync')
        .setDescription('Re-register slash commands for enabled modules.');
    }
  );

export default {
  data: DATA,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const SUBCOMMAND = interaction.options.getSubcommand();

    if (SUBCOMMAND === 'list') {
      await handleList(interaction);
      return;
    }

    if (SUBCOMMAND === 'enable' || SUBCOMMAND === 'disable') {
      await handleToggle(interaction, SUBCOMMAND === 'enable');
      return;
    }

    if (SUBCOMMAND === 'health') {
      await handleHealth(interaction);
      return;
    }

    if (SUBCOMMAND === 'sync') {
      await handleSync(interaction);
    }
  },
};

async function handleList(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const MODULES = interaction.client.nano.list();
  const FIELDS: EmbedFieldSpec[] = MODULES.slice(0, MAX_EMBED_FIELDS)
    .map((entry: RegisteredModule): EmbedFieldSpec => {
      const STATE = entry.enabled ? 'enabled' : 'disabled';
      const PROTECTED_MARK = entry.protected ? ', protected' : '';
      return {
        name: `${entry.module.name}@${entry.module.version}`,
        value: `${entry.module.description ?? 'No description.'}\n` +
          `State: ${STATE} (${entry.origin}${PROTECTED_MARK})`,
      };
    });

  await interaction.reply({
    embeds: [
      buildEmbed({
        title: 'nano-core modules',
        description: `${MODULES.length} module(s) registered.`,
        fields: FIELDS,
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleToggle(
  interaction: ChatInputCommandInteraction,
  enable: boolean
): Promise<void> {
  const NAME = interaction.options.getString('name', true);
  const RESULT = enable
    ? await interaction.client.nano.enable(NAME)
    : await interaction.client.nano.disable(NAME);
  const ACTION = enable ? 'enabled' : 'disabled';
  const CONTENT = RESULT.ok
    ? `Module '${NAME}' ${ACTION}. Run /module sync to update slash commands.`
    : RESULT.error;

  await interaction.reply({
    content: CONTENT,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHealth(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const NAME = interaction.options.getString('name');
  const REPORTS: ModuleHealth[] = [];

  if (NAME) {
    const RESULT = await interaction.client.nano.health(NAME);

    if (!RESULT.ok) {
      await interaction.reply({
        content: RESULT.error,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    REPORTS.push(RESULT.data);
  } else {
    REPORTS.push(...await interaction.client.nano.healthAll());
  }

  const FIELDS: EmbedFieldSpec[] = REPORTS.slice(0, MAX_EMBED_FIELDS)
    .map((report: ModuleHealth): EmbedFieldSpec => {
      const DETAILS = report.details ? `\n${report.details}` : '';
      return {
        name: report.name,
        value: `Status: ${report.status}${DETAILS}`,
      };
    });

  await interaction.reply({
    embeds: [buildEmbed({ title: 'Module health', fields: FIELDS })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSync(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const TOKEN = process.env.DISCORD_TOKEN;
  const CLIENT_ID = process.env.CLIENT_ID;

  if (!TOKEN || !CLIENT_ID) {
    await interaction.reply({
      content: 'DISCORD_TOKEN or CLIENT_ID is missing. Cannot sync.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const RESULT = await registerGlobalCommands(
    interaction.client.nano.enabledCommands(),
    TOKEN,
    CLIENT_ID
  );
  const CONTENT = RESULT.ok
    ? `Registered ${RESULT.data} slash command(s).`
    : `Sync failed: ${RESULT.error}`;

  await interaction.editReply({ content: CONTENT });
}
