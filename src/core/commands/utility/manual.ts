import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandStringOption
} from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';

import type { EmbedFieldSpec } from '@/api/embed.js';
import { buildEmbed, gridFields, moduleFooter } from '@/api/embed.js';
import { paginate } from '@/api/paginate.js';
import {
  TEXT_NO_DESCRIPTION,
  TEXT_NONE
} from '@/constants/text.js';
import type { RegisteredModule } from '@/registry/module-registry.js';
import type {
  NanoCommand,
  NanoEvent,
  NanoTaskEntry
} from '@/types/nano-module.js';
import { moduleKind, taskDescription } from '@/types/nano-module.js';

const TEXT_UNKNOWN_MODULE =
  'No such module. Run /manual with no options for every dossier.';
const TEXT_STATE_ENABLED = 'ENABLED';
const TEXT_STATE_DISABLED = 'DISABLED';
const TEXT_PROTECTED_MARK = ' `protected`';
const TEXT_HEALTH_UNKNOWN = 'Health check unavailable.';
const FIELD_STATE = '**State:**';
const FIELD_KIND = '**Kind:**';
const FIELD_COMMANDS = '**Commands:**';
const FIELD_EVENTS = '**Events:**';
const FIELD_TASKS = '**Tasks:**';
const FIELD_HEALTH = '**Health:**';

const MAX_FIELD_VALUE = 1024;
const MAX_CHOICES = 25;

export default {
  data: new SlashCommandBuilder()
    .setName('manual')
    .setDescription(
      'Module dossiers with version, kind, commands, tasks and health.'
    )
    .addStringOption((option: SlashCommandStringOption):
    SlashCommandStringOption => {
      return option.setName('module')
        .setDescription('Module name (omit for every module)')
        .setAutocomplete(true);
    }),

  help: {
    long:
      'Renders a dossier for each installed module, its version, ' +
      'kind, the commands and events it contributes, its scheduled ' +
      'tasks and a live health probe. Pass a module name to open a ' +
      'single dossier.',
    usage: '/manual [module]',
    examples: ['/manual', '/manual core'],
  },

  defer: 'ephemeral' as const,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const NAME = interaction.options.getString('module');
    const REGISTRY = interaction.client.nano;
    const ENTRIES = NAME
      ? REGISTRY.list().filter((entry: RegisteredModule): boolean => {
        return entry.module.name === NAME;
      })
      : REGISTRY.list();

    if (ENTRIES.length === 0) {
      await interaction.editReply({ content: TEXT_UNKNOWN_MODULE });
      return;
    }

    const PAGES: EmbedBuilder[] = [];

    for (const _entry of ENTRIES) {
      PAGES.push(await buildDossier(interaction, _entry));
    }

    await paginate(interaction, PAGES, { ephemeral: true });
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const FOCUSED = interaction.options.getFocused().toLowerCase();
    const CHOICES = interaction.client.nano.list()
      .map((entry: RegisteredModule): string => {
        return entry.module.name;
      })
      .filter((name: string): boolean => {
        return name.toLowerCase().startsWith(FOCUSED);
      })
      .slice(0, MAX_CHOICES);

    await interaction.respond(
      CHOICES.map((name: string): { name: string; value: string } => {
        return { name, value: name };
      })
    );
  },
};

async function buildDossier(
  interaction: ChatInputCommandInteraction,
  entry: RegisteredModule
): Promise<EmbedBuilder> {
  const MODULE = entry.module;
  const STATE = entry.enabled ? TEXT_STATE_ENABLED : TEXT_STATE_DISABLED;
  const PROTECTED_MARK = entry.protected ? TEXT_PROTECTED_MARK : '';
  const HEALTH = await interaction.client.nano.health(MODULE.name);
  const DETAILS = HEALTH.ok && HEALTH.data.details
    ? ` · ${HEALTH.data.details}`
    : '';
  const HEALTH_TEXT = HEALTH.ok
    ? `\`${HEALTH.data.status.toUpperCase()}\`${DETAILS}`
    : TEXT_HEALTH_UNKNOWN;

  /* The house grid: State | Kind, then full-width inventories. */
  const FIELDS: EmbedFieldSpec[] = gridFields([
    {
      name: FIELD_STATE,
      value: `**[${STATE}]**${PROTECTED_MARK}`,
    },
    {
      name: FIELD_KIND,
      value: `**[${moduleKind(MODULE).toUpperCase()}]** ` +
        `\`${entry.origin}\``,
    },
  ]);
  FIELDS.push(
    { name: FIELD_COMMANDS, value: renderCommands(MODULE.commands ?? []) },
    { name: FIELD_EVENTS, value: renderEvents(MODULE.events ?? []) },
    { name: FIELD_TASKS, value: renderTasks(MODULE.tasks ?? {}) },
    { name: FIELD_HEALTH, value: HEALTH_TEXT.slice(0, MAX_FIELD_VALUE) }
  );
  return buildEmbed({
    title: `**${MODULE.name}** \`v${MODULE.version}\``,
    description: MODULE.description ?? TEXT_NO_DESCRIPTION,
    thumbnail_url: interaction.client.user?.displayAvatarURL(),
    footer_text: moduleFooter(MODULE.name, MODULE.version),
    fields: FIELDS,
  });
}

function renderCommands(commands: NanoCommand[]): string {
  if (commands.length === 0) {
    return TEXT_NONE;
  }
  return commands.map((command: NanoCommand): string => {
    return `\`/${command.data.name}\``;
  }).join(' ')
    .slice(0, MAX_FIELD_VALUE);
}

function renderEvents(events: NanoEvent[]): string {
  if (events.length === 0) {
    return TEXT_NONE;
  }
  return events.map((event: NanoEvent): string => {
    const NEEDS: string[] = [];

    if (event.intents?.length) {
      NEEDS.push(`intents: ${event.intents.join(', ')}`);
    }

    if (event.partials?.length) {
      NEEDS.push(`partials: ${event.partials.join(', ')}`);
    }

    const SUFFIX = NEEDS.length > 0 ? ` (${NEEDS.join('; ')})` : '';
    return `\`${event.name}\`${SUFFIX}`;
  }).join('\n')
    .slice(0, MAX_FIELD_VALUE);
}

function renderTasks(tasks: Record<string, NanoTaskEntry>): string {
  const NAMES = Object.keys(tasks);

  if (NAMES.length === 0) {
    return TEXT_NONE;
  }
  return NAMES.map((name: string): string => {
    const DESCRIPTION = taskDescription(tasks[name]);
    return DESCRIPTION ? `\`${name}\` · ${DESCRIPTION}` : `\`${name}\``;
  }).join('\n')
    .slice(0, MAX_FIELD_VALUE);
}
