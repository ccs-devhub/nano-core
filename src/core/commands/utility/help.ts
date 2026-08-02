import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandStringOption
} from 'discord.js';
import {
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder
} from 'discord.js';

import type { EmbedFieldSpec } from '@/api/embed.js';
import { buildEmbed, gridFields, moduleFooter } from '@/api/embed.js';
import { paginate } from '@/api/paginate.js';
import { NANO_REPO_URL } from '@/constants/nano.js';
import {
  TEXT_HELP_ABOUT,
  TEXT_HELP_COMMANDS_INTRO,
  TEXT_HELP_COOLDOWN_LABEL,
  TEXT_HELP_DISABLED_SUFFIX,
  TEXT_HELP_EVERYONE,
  TEXT_HELP_EXAMPLES_LABEL,
  TEXT_HELP_GREETINGS,
  TEXT_HELP_MODULE_LABEL,
  TEXT_HELP_NSFW_MARK,
  TEXT_HELP_PERMISSIONS_LABEL,
  TEXT_HELP_PROPERTIES_LABEL,
  TEXT_HELP_RESTRICTED,
  TEXT_HELP_SCOPE_GLOBAL,
  TEXT_HELP_SCOPE_GUILD,
  TEXT_HELP_SCOPE_LABEL,
  TEXT_HELP_SYNTAX_LABEL,
  TEXT_HELP_TIP,
  TEXT_NO_DESCRIPTION
} from '@/constants/text.js';
import { fillSlots } from '@/misc/utility/format.js';
import { subcommandPaths } from '@/misc/utility/help-audit.js';
import type { RegisteredModule } from '@/registry/module-registry.js';
import { styleGreetings, styleText } from '@/registry/nano-style.js';
import type {
  NanoCommand,
  NanoCommandHelp,
  NanoHelpCard
} from '@/types/nano-module.js';

const TEXT_UNKNOWN_COMMAND =
  'No such command. Run /help with no options for the full index.';
const TEXT_DISABLED_NOTE =
  'The owning module is currently disabled.';

const MODULES_PER_PAGE = 8;
const MAX_FIELD_VALUE = 1024;
const MAX_CHOICES = 25;
const MS_PER_SECOND = 1000;
/* Past this many subcommands the Properties row goes full-width. */
const WIDE_PROPERTIES_THRESHOLD = 2;
const OVERFLOW_MARK = 'and more, +';
const OVERFLOW_COUNT_DIGITS = 8;
const OVERFLOW_RESERVE = OVERFLOW_MARK.length + OVERFLOW_COUNT_DIGITS;

interface SubcommandJson {
  type?: number;
  name?: string;
  description?: string;
  required?: boolean;
  options?: SubcommandJson[];
}

interface CommandJson {
  description?: string;
  default_member_permissions?: string | null;
  dm_permission?: boolean | null;
  contexts?: number[] | null;
  nsfw?: boolean;
  options?: SubcommandJson[];
}

const CONTEXT_GUILD = 0;

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription(
      'Browse every command as a grouped index or a detail card.'
    )
    .addStringOption((option: SlashCommandStringOption):
    SlashCommandStringOption => {
      return option.setName('command')
        .setDescription('Command name, optionally with a subcommand path')
        .setAutocomplete(true);
    }),

  help: {
    long:
      'Lists every command this bot serves, grouped by the module ' +
      'that owns it. Pass a command name or a full subcommand path ' +
      'to open the detail card with syntax, examples, module, ' +
      'permissions and scope.',
    usage: '/help [command]',
    examples: ['/help', '/help ping', '/help module sync'],
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const QUERY = interaction.options.getString('command');

    if (!QUERY) {
      await replyWithIndex(interaction);
      return;
    }

    await replyWithCard(interaction, QUERY);
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const FOCUSED = interaction.options.getFocused().toLowerCase();
    const CHOICES = listCommandPaths(interaction)
      .filter((path: string): boolean => {
        return path.toLowerCase().startsWith(FOCUSED);
      })
      .slice(0, MAX_CHOICES);

    await interaction.respond(
      CHOICES.map((path: string): { name: string; value: string } => {
        return { name: path, value: path };
      })
    );
  },
};

/** Join tokens without ever cutting one in half mid-backtick. */
function joinWithinLimit(names: string[]): string {
  const KEPT: string[] = [];
  let length = 0;

  for (const _name of names) {
    const NEXT = length + _name.length + 1;

    /* Reserve room for the marker AND its count digits + space, so
       the finished field can never exceed the field-value limit. */
    if (NEXT > MAX_FIELD_VALUE - OVERFLOW_RESERVE) {
      KEPT.push(`${OVERFLOW_MARK}${names.length - KEPT.length}`);
      break;
    }

    KEPT.push(_name);
    length = NEXT;
  }
  return KEPT.join(' ');
}

/** Every invocable path: command names plus their subcommand paths. */
function listCommandPaths(
  interaction: AutocompleteInteraction | ChatInputCommandInteraction
): string[] {
  const PATHS: string[] = [];

  for (const _command of interaction.client.commands.values()) {
    PATHS.push(_command.data.name);

    for (const _sub of subcommandPaths(_command)) {
      PATHS.push(`${_command.data.name} ${_sub}`);
    }
  }
  return PATHS;
}

async function replyWithIndex(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const ENTRIES = interaction.client.nano.list()
    .filter((entry: RegisteredModule): boolean => {
      return (entry.module.commands ?? []).length > 0;
    });
  const TOTAL = ENTRIES.reduce(
    (count: number, entry: RegisteredModule): number => {
      return count + (entry.module.commands ?? []).length;
    },
    0
  );
  /* Greeting picked at random from the pool ([help] greetings in
     nano.style.toml replaces it wholesale); the other three parts
     are [text] keys. One slot map serves all of them. */
  const SLOTS = {
    user: interaction.user.username,
    bot: interaction.client.user?.username ?? 'nano',
    guild: interaction.guild?.name ?? 'this server',
    count: TOTAL,
    repo_url: NANO_REPO_URL,
  };
  const POOL = styleGreetings(TEXT_HELP_GREETINGS);
  const GREETING = POOL[Math.floor(Math.random() * POOL.length)];
  const INTRO = [
    GREETING,
    styleText('help_about', TEXT_HELP_ABOUT),
    styleText('help_tip', TEXT_HELP_TIP),
    styleText('help_commands_intro', TEXT_HELP_COMMANDS_INTRO),
  ]
    .map((part: string): string => {
      return fillSlots(part, SLOTS);
    })
    .join('\n\n');
  const FIELDS = ENTRIES.map((entry: RegisteredModule): EmbedFieldSpec => {
    const COMMANDS = entry.module.commands ?? [];
    const NAMES = COMMANDS.map((command: NanoCommand): string => {
      return `\`${command.data.name}\``;
    });
    const MARK = entry.enabled ? '' : TEXT_HELP_DISABLED_SUFFIX;
    return {
      name: `**[${entry.module.name.toUpperCase()}]** · ` +
        `${COMMANDS.length}${MARK}`,
      value: joinWithinLimit(NAMES),
    };
  });
  const THUMBNAIL = interaction.client.user?.displayAvatarURL();
  const PAGES: EmbedBuilder[] = [];

  for (let start = 0; start < FIELDS.length; start += MODULES_PER_PAGE) {
    PAGES.push(buildEmbed({
      description: INTRO,
      thumbnail_url: THUMBNAIL,
      footer_text: moduleFooter(),
      fields: FIELDS.slice(start, start + MODULES_PER_PAGE),
    }));
  }

  await paginate(interaction, PAGES, { ephemeral: true });
}

async function replyWithCard(
  interaction: ChatInputCommandInteraction,
  query: string
): Promise<void> {
  const TOKENS = query.trim().replace(/^\//, '')
    .split(/\s+/);
  const [COMMAND_NAME, ...SUB_TOKENS] = TOKENS;
  const COMMAND = interaction.client.commands.get(COMMAND_NAME);
  const SUB_PATH = SUB_TOKENS.join(' ');

  if (
    !COMMAND ||
    (SUB_PATH && !subcommandPaths(COMMAND).includes(SUB_PATH))
  ) {
    await interaction.reply({
      content: TEXT_UNKNOWN_COMMAND,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [buildCard(interaction, COMMAND, SUB_PATH)],
    flags: MessageFlags.Ephemeral,
  });
}

function buildCard(
  interaction: ChatInputCommandInteraction,
  command: NanoCommand,
  sub_path: string
): EmbedBuilder {
  const JSON_DATA = command.data.toJSON() as CommandJson;
  const HELP: NanoCommandHelp | undefined = command.help;
  const CARD: NanoHelpCard | undefined = sub_path
    ? HELP?.subcommands?.[sub_path]
    : HELP;
  const TITLE = sub_path
    ? `**/${command.data.name} ${sub_path}**`
    : `**/${command.data.name}**`;
  const LONG = CARD?.long ||
    (sub_path
      ? subcommandDescription(JSON_DATA, sub_path)
      : JSON_DATA.description) ||
    TEXT_NO_DESCRIPTION;
  const OWNER = findOwner(interaction, command.data.name);
  const NOTE = OWNER && !OWNER.enabled ? `\n\n${TEXT_DISABLED_NOTE}` : '';
  /* Declared usage wins; without help metadata the syntax derives
     from the builder so the card never shows a bare command that
     actually takes subcommands or arguments. */
  /* `||` not `??`: an empty declared usage falls back to the
     builder-derived shape rather than rendering a blank Syntax. */
  const USAGE = (CARD?.usage || '') ||
    deriveSyntax(command.data.name, JSON_DATA, sub_path);
  /* Examples live in the DESCRIPTION — and only the ones that say
     more than the bare usage already does. NOTE goes BEFORE the
     examples so a truncated examples block never swallows it. */
  const EXAMPLES = renderExamples(CARD?.examples ?? [], USAGE);
  const BODY = `${LONG}${NOTE}${EXAMPLES}`;

  /* The house grid. Syntax carries the full invocation shape, and
     a command with MORE THAN TWO subcommands gets Command
     Properties on its own full-width row so the long shape never
     wraps inside a half column. */
  const SUBCOMMANDS = subcommandPaths(command);
  const WIDE_PROPERTIES = !sub_path &&
    SUBCOMMANDS.length > WIDE_PROPERTIES_THRESHOLD;
  const PROPERTIES = [`${TEXT_HELP_SYNTAX_LABEL} \`${USAGE}\``];

  if (command.cooldown) {
    const SECONDS = command.cooldown.delay_ms / MS_PER_SECOND;
    PROPERTIES.push(`${TEXT_HELP_COOLDOWN_LABEL} \`${SECONDS}s\``);
  }

  const PROPERTIES_FIELD: EmbedFieldSpec = {
    name: TEXT_HELP_PROPERTIES_LABEL,
    value: PROPERTIES.join('\n'),
  };
  const DETAILS: EmbedFieldSpec[] = [
    {
      name: TEXT_HELP_MODULE_LABEL,
      value: renderModule(OWNER),
    },
    {
      name: TEXT_HELP_PERMISSIONS_LABEL,
      value: renderPermissions(JSON_DATA, CARD, sub_path ? undefined : HELP),
    },
    {
      name: TEXT_HELP_SCOPE_LABEL,
      value: renderScope(JSON_DATA),
    },
  ];
  const FIELDS = WIDE_PROPERTIES
    ? [PROPERTIES_FIELD, ...gridFields(DETAILS)]
    : gridFields([PROPERTIES_FIELD, ...DETAILS]);
  return buildEmbed({
    title: TITLE,
    description: BODY,
    thumbnail_url: interaction.client.user?.displayAvatarURL(),
    footer_text: moduleFooter(OWNER?.module.name, OWNER?.module.version),
    fields: FIELDS,
  });
}

/** The owning module, live from the registry: name, version, state. */
function renderModule(owner: RegisteredModule | undefined): string {
  if (!owner) {
    return '**[CORE]**';
  }

  const MARK = owner.enabled ? '' : TEXT_HELP_DISABLED_SUFFIX;
  return `**[${owner.module.name.toUpperCase()}]** ` +
    `\`v${owner.module.version}\`${MARK}`;
}

/** Where the command works, from the builder's own declarations. */
function renderScope(json_data: CommandJson): string {
  const GUILD_ONLY = json_data.dm_permission === false ||
    (Array.isArray(json_data.contexts) &&
      json_data.contexts.length === 1 &&
      json_data.contexts[0] === CONTEXT_GUILD);
  const SCOPE = GUILD_ONLY
    ? TEXT_HELP_SCOPE_GUILD
    : TEXT_HELP_SCOPE_GLOBAL;
  return json_data.nsfw ? `${SCOPE}${TEXT_HELP_NSFW_MARK}` : SCOPE;
}

const SUBCOMMAND_TYPE = 1;
const SUBCOMMAND_GROUP_TYPE = 2;
const SUB_TYPES = [SUBCOMMAND_TYPE, SUBCOMMAND_GROUP_TYPE];

/** The invocation shape straight from the builder declarations. */
function deriveSyntax(
  name: string,
  json_data: CommandJson,
  sub_path: string
): string {
  if (sub_path) {
    const NODE = locateSubcommand(json_data, sub_path);
    const ARGS = renderArguments(NODE?.options ?? []);
    return ARGS ? `/${name} ${sub_path} ${ARGS}` : `/${name} ${sub_path}`;
  }

  const OPTIONS = json_data.options ?? [];
  const SUBS: string[] = [];

  for (const _option of OPTIONS) {
    if (_option.type === SUBCOMMAND_TYPE && _option.name) {
      SUBS.push(_option.name);
      continue;
    }

    /* A group is NOT directly invocable — list its leaf paths so
       the syntax matches what the user must actually type. */
    if (_option.type === SUBCOMMAND_GROUP_TYPE && _option.name) {
      for (const _nested of _option.options ?? []) {
        if (_nested.type === SUBCOMMAND_TYPE && _nested.name) {
          SUBS.push(`${_option.name} ${_nested.name}`);
        }
      }
    }
  }

  if (SUBS.length > 0) {
    return `/${name} <${SUBS.join('|')}>`;
  }

  const ARGS = renderArguments(OPTIONS);
  return ARGS ? `/${name} ${ARGS}` : `/${name}`;
}

function renderArguments(options: SubcommandJson[]): string {
  return options
    .filter((option: SubcommandJson): boolean => {
      return !SUB_TYPES.includes(option.type ?? 0);
    })
    .map((option: SubcommandJson): string => {
      return option.required
        ? `<${option.name}>`
        : `[${option.name}]`;
    })
    .join(' ');
}

function locateSubcommand(
  json_data: CommandJson,
  sub_path: string
): SubcommandJson | undefined {
  const [HEAD, TAIL] = sub_path.split(' ');

  for (const _option of json_data.options ?? []) {
    if (_option.name !== HEAD) {
      continue;
    }

    if (!TAIL) {
      return _option;
    }

    return (_option.options ?? []).find(
      (nested: SubcommandJson): boolean => {
        return nested.name === TAIL;
      }
    );
  }
  return undefined;
}

function subcommandDescription(
  json_data: CommandJson,
  sub_path: string
): string | undefined {
  const [HEAD, TAIL] = sub_path.split(' ');

  for (const _option of json_data.options ?? []) {
    if (_option.name !== HEAD) {
      continue;
    }

    if (!TAIL) {
      return _option.description;
    }

    for (const _nested of _option.options ?? []) {
      if (_nested.name === TAIL) {
        return _nested.description;
      }
    }
  }
  return undefined;
}

/**
 * WHO can use the command, derived automatically. The ENFORCED
 * builder value renders first, in the house audience voice —
 * humanized permission names, dash-separated, italic-bold
 * (the Synchronous "Pilares - Inmortales" pattern). help.permissions
 * free text follows only for gates the builder cannot express
 * (e.g. a bot-owner check). No gate at all = Everyone.
 */
function renderPermissions(
  json_data: CommandJson,
  card: NanoHelpCard | undefined,
  help: NanoCommandHelp | undefined
): string {
  const PARTS: string[] = [];
  const RAW = json_data.default_member_permissions;
  /* '0' is the owner-only idiom: a real gate that decodes to an
     EMPTY name list, so it must never render empty markdown. */
  const NAMES = RAW
    ? new PermissionsBitField(BigInt(RAW)).toArray()
      .map(humanizePermission)
    : [];

  if (NAMES.length > 0) {
    PARTS.push(`_***${NAMES.join(' - ')}***_`);
  } else if (RAW) {
    PARTS.push(TEXT_HELP_RESTRICTED);
  }

  const FREE_TEXT = card?.permissions ?? help?.permissions;

  if (FREE_TEXT) {
    PARTS.push(FREE_TEXT);
  }
  return PARTS.length > 0 ? PARTS.join('\n') : TEXT_HELP_EVERYONE;
}

/** 'ManageGuild' -> 'Manage Guild' (readable audience names). */
function humanizePermission(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * The description-level examples block. An example that only repeats
 * the bare usage adds nothing and is dropped; when nothing remains,
 * no block renders at all.
 */
function renderExamples(examples: string[], usage: string): string {
  const MEANINGFUL = examples
    .map((example: string): string => {
      return example.trim();
    })
    .filter((example: string): boolean => {
      return example.length > 0 && example !== usage.trim();
    });

  if (MEANINGFUL.length === 0) {
    return '';
  }

  const LINES = MEANINGFUL.map((example: string): string => {
    return `\`${example}\``;
  }).join('\n')
    .slice(0, MAX_FIELD_VALUE);
  return `\n\n${TEXT_HELP_EXAMPLES_LABEL}\n${LINES}`;
}

function findOwner(
  interaction: ChatInputCommandInteraction,
  command_name: string
): RegisteredModule | undefined {
  return interaction.client.nano.list()
    .find((entry: RegisteredModule): boolean => {
      return (entry.module.commands ?? []).some(
        (command: NanoCommand): boolean => {
          return command.data.name === command_name;
        }
      );
    });
}
