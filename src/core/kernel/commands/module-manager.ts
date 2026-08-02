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

import { confirmFlow } from '@/api/confirm.js';
import type { EmbedFieldSpec } from '@/api/embed.js';
import { buildEmbed, moduleFooter } from '@/api/embed.js';
import {
  TEXT_CONFIRM_CANCELLED,
  TEXT_OWNER_ONLY
} from '@/constants/text.js';
import { syncCommands } from '@/misc/utility/command-sync.js';
import { fillSlots } from '@/misc/utility/format.js';
import type {
  ModuleHealth,
  RegisteredModule
} from '@/registry/module-registry.js';
import { loadConfig } from '@/registry/nano-config.js';
import { isApplicationOwner } from '@/services/permission.js';
import type { ReconcileRunResult } from '@/services/reconcile.js';
import { moduleKind } from '@/types/nano-module.js';

const MAX_EMBED_FIELDS = 25;
const MAX_MESSAGE_LENGTH = 2000;
const REPORT_CUT = '\n... report truncated, see the logs.';

const DATA = new SlashCommandBuilder()
  .setName('module')
  .setDescription('Inspect and maintain nano-core modules.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('list')
        .setDescription('List every registered module and its state.');
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
  )
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('reconcile')
        .setDescription('Run a manual catch-up pass (bot owner only).');
    }
  );

const HELP = {
  long:
    'Inspects the module system. List what is installed, probe ' +
    'module health, re-register slash commands after a host-side ' +
    'change, or run a manual catch-up pass. Enabling or disabling ' +
    'modules rewrites the host configuration for every server this ' +
    'bot serves, so that stays with the host operator and the nano ' +
    'CLI.',
  usage: '/module <list|health|sync|reconcile>',
  examples: ['/module list', '/module health'],
  subcommands: {
    list: {
      long: 'Lists every registered module with its version, origin, ' +
        'kind and enabled state.',
      usage: '/module list',
      examples: ['/module list'],
    },
    health: {
      long: 'Runs the health check of one module, or of every module ' +
        'when no name is given, and reports status plus details.',
      usage: '/module health [name]',
      examples: ['/module health', '/module health synapse'],
    },
    sync: {
      long: 'Re-registers the slash commands of every enabled module ' +
        'with Discord, using the same scope as boot.',
      usage: '/module sync',
      examples: ['/module sync'],
    },
    reconcile: {
      long: 'Runs one manual catch-up pass. Every enabled module ' +
        'diffs the live server state against its own records and ' +
        'heals the difference through its normal write paths. Asks ' +
        'for confirmation first and reports what each task fixed.',
      usage: '/module reconcile',
      examples: ['/module reconcile'],
      permissions: 'Bot owner only, runs across every server this ' +
        'bot serves.',
    },
  },
};

export default {
  data: DATA,

  help: HELP,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const SUBCOMMAND = interaction.options.getSubcommand();

    if (SUBCOMMAND === 'list') {
      await handleList(interaction);
      return;
    }

    if (SUBCOMMAND === 'health') {
      await handleHealth(interaction);
      return;
    }

    if (SUBCOMMAND === 'sync') {
      await handleSync(interaction);
      return;
    }

    if (SUBCOMMAND === 'reconcile') {
      await handleReconcile(interaction);
    }
  },
};

async function handleList(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const MODULES = interaction.client.nano.list();
  const FIELDS: EmbedFieldSpec[] = MODULES.slice(0, MAX_EMBED_FIELDS)
    .map((entry: RegisteredModule): EmbedFieldSpec => {
      const STATE = entry.enabled ? 'ENABLED' : 'DISABLED';
      const PROTECTED_MARK = entry.protected ? ' `protected`' : '';
      return {
        name: `**${entry.module.name}** \`v${entry.module.version}\``,
        value: `${entry.module.description ?? 'No description.'}\n` +
          `**State:** **[${STATE}]** \`${entry.origin}\` ` +
          `**[${moduleKind(entry.module).toUpperCase()}]**` +
          `${PROTECTED_MARK}`,
      };
    });

  await interaction.reply({
    embeds: [
      buildEmbed({
        title: '**nano-core modules**',
        description: `**${MODULES.length}** module(s) registered.`,
        thumbnail_url: interaction.client.user?.displayAvatarURL(),
        footer_text: moduleFooter(),
        fields: FIELDS,
      }),
    ],
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
        name: `**${report.name}**`,
        value: `**Status:** \`${report.status.toUpperCase()}\`` +
          `${DETAILS}`,
      };
    });

  await interaction.reply({
    embeds: [
      buildEmbed({
        title: '**Module health**',
        thumbnail_url: interaction.client.user?.displayAvatarURL(),
        footer_text: moduleFooter(),
        fields: FIELDS,
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

const RECONCILE_PREVIEW =
  'Manual reconcile: {tasks} task(s) across {modules} enabled ' +
  'module(s) will diff live server state and heal differences ' +
  'through their normal write paths. Proceed?';
const RECONCILE_EMPTY = 'No reconcile tasks are registered.';
const RECONCILE_HEADER = 'Run {run_tag}: {count} task(s).';

async function handleReconcile(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const IS_OWNER = await isApplicationOwner(
    interaction.client,
    interaction.user.id
  );

  if (!IS_OWNER) {
    await interaction.reply({
      content: TEXT_OWNER_ONLY,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const MODULES = interaction.client.nano.list()
    .filter((entry: RegisteredModule): boolean => {
      return entry.enabled &&
        (entry.module.reconcile ?? []).length > 0;
    });
  const TASK_COUNT = MODULES.reduce(
    (total: number, entry: RegisteredModule): number => {
      return total + (entry.module.reconcile ?? []).length;
    },
    0
  );
  const CONFIRM = await confirmFlow(interaction, {
    preview: fillSlots(RECONCILE_PREVIEW, {
      tasks: TASK_COUNT,
      modules: MODULES.length,
    }),
  });

  if (!CONFIRM.ok) {
    return;
  }

  if (!CONFIRM.data.confirmed) {
    await interaction.editReply({ content: TEXT_CONFIRM_CANCELLED });
    return;
  }

  const RESULTS = await interaction.client.services.reconcile
    .run('manual');
  const LINES = RESULTS.map((result: ReconcileRunResult): string => {
    if (!result.ok) {
      return `${result.module_name}/${result.task_id}: FAILED - ` +
        `${result.error ?? 'unknown'}`;
    }

    const REPORT = result.report;
    return `${result.module_name}/${result.task_id}: ` +
      `checked ${REPORT?.checked ?? 0}, fixed ${REPORT?.fixed ?? 0}, ` +
      `skipped ${REPORT?.skipped ?? 0}, ` +
      `unrecoverable ${REPORT?.unrecoverable ?? 0}, ` +
      `deferred ${REPORT?.deferred ?? 0}`;
  });
  const HEADER = fillSlots(RECONCILE_HEADER, {
    run_tag: CONFIRM.data.run_tag,
    count: RESULTS.length,
  });

  const BODY = LINES.length > 0
    ? `${HEADER}\n${LINES.join('\n')}`
    : `${HEADER}\n${RECONCILE_EMPTY}`;
  /* The pass already mutated live state, so the report must never
     be lost to a 2000-char message rejection. */
  await interaction.editReply({
    content: BODY.length > MAX_MESSAGE_LENGTH
      ? `${BODY.slice(0, MAX_MESSAGE_LENGTH - REPORT_CUT.length)}${ 
        REPORT_CUT}`
      : BODY,
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

  /* Same scope as boot: guild while bot.dev_guild_id is set. A sync
   * that ignored the scope would leak every command globally. */
  const RESULT = await syncCommands(
    interaction.client.nano.enabledCommands(),
    {
      token: TOKEN,
      client_id: CLIENT_ID,
      guild_id: loadConfig().bot.dev_guild_id,
      force: true,
    }
  );
  const CONTENT = RESULT.ok
    ? `Registered ${RESULT.data.count} slash command(s) ` +
      `(${RESULT.data.scope} scope).`
    : `Sync failed: ${RESULT.error}`;

  await interaction.editReply({ content: CONTENT });
}
