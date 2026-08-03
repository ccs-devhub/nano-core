import type {
  RefusalReason,
  RoleChangeReport
} from './apply-role-change.js';
import { applyRoleChange } from './apply-role-change.js';
import {
  ROLES_VERSION,
  TEXT_ROLES_CARD_TITLE_GRANT,
  TEXT_ROLES_CARD_TITLE_REVOKE,
  TEXT_ROLES_CONFIRM_GRANT,
  TEXT_ROLES_CONFIRM_PRIVILEGED,
  TEXT_ROLES_CONFIRM_REASON,
  TEXT_ROLES_CONFIRM_REVOKE,
  TEXT_ROLES_FIELD_MEMBER,
  TEXT_ROLES_FIELD_MODERATOR,
  TEXT_ROLES_FIELD_ROLE,
  TEXT_ROLES_FIELD_RUN,
  TEXT_ROLES_GUILD_ONLY,
  TEXT_ROLES_HIERARCHY_BLOCKED,
  TEXT_ROLES_OUTCOME_GRANTED,
  TEXT_ROLES_OUTCOME_NOOP_GRANT,
  TEXT_ROLES_OUTCOME_NOOP_REVOKE,
  TEXT_ROLES_OUTCOME_REVOKED,
  TEXT_ROLES_REFUSAL_ABOVE_BOT,
  TEXT_ROLES_REFUSAL_EVERYONE,
  TEXT_ROLES_REFUSAL_MANAGED,
  TEXT_ROLES_REFUSAL_MISSING,
  TEXT_ROLES_REFUSAL_SANCTION,
  TEXT_ROLES_ROLE_UNREADABLE
} from './constants.js';

import type {
  ChatInputCommandInteraction,
  EmbedBuilder,
  Role,
  SlashCommandRoleOption,
  SlashCommandStringOption,
  SlashCommandSubcommandBuilder,
  SlashCommandUserOption
} from '@ccs-devhub/nano-core';
import {
  buildEmbed,
  confirmFlow,
  fillSlots,
  gridFields,
  moduleFooter,
  PermissionFlagsBits,
  roleMention,
  SlashCommandBuilder,
  TEXT_CONFIRM_CANCELLED,
  userMention
} from '@ccs-devhub/nano-core';

/**
 * The manual write surface (box 4 slice B): /roles grant|revoke.
 * Both paths run GR-L3 (list the role's privileged permissions
 * inside the confirm prompt) and EX6 (the actor's own hierarchy
 * bounds what they may hand out) BEFORE the Q2 confirm, then flow
 * through applyRoleChange with source 'manual' so the box-2
 * refusal matrix, suppression stamp and ledger do the rest.
 */

const MODULE_NAME = 'roles';

export type RoleCommandAction = 'grant' | 'revoke';

/**
 * GR-L3: the dangerous-permission denylist. A role carrying any of
 * these is listed inside the confirm prompt so the moderator sees
 * exactly what they hand out before pressing confirm.
 */
export const PRIVILEGED_ROLE_PERMISSIONS: readonly string[] = [
  'Administrator',
  'ManageRoles',
  'ManageGuild',
  'ManageChannels',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
  'ManageMessages',
  'MentionEveryone',
  'ManageWebhooks',
];

/** The privileged subset of a role's current permission names. */
export function privilegedPermissionNames(
  permissions: string[]
): string[] {
  return permissions.filter((name: string): boolean => {
    return PRIVILEGED_ROLE_PERMISSIONS.includes(name);
  });
}

/**
 * EX6: a moderator may only hand out roles strictly below their own
 * highest role, otherwise a grant is a self-escalation. The guild
 * owner outranks every role.
 */
export function actorHierarchyBlocked(
  actor_top_position: number,
  actor_is_owner: boolean,
  role_position: number
): boolean {
  if (actor_is_owner) {
    return false;
  }
  return role_position >= actor_top_position;
}

function humanizePermission(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** The Q2 confirm prompt, GR-L3 listing included. */
export function buildConfirmPreview(
  action: RoleCommandAction,
  member_mention: string,
  role_mention_text: string,
  privileged: string[],
  reason: string | null
): string {
  const TEMPLATE = action === 'grant'
    ? TEXT_ROLES_CONFIRM_GRANT
    : TEXT_ROLES_CONFIRM_REVOKE;
  const LINES = [fillSlots(TEMPLATE, {
    role: role_mention_text,
    member: member_mention,
  })];

  if (reason) {
    LINES.push(fillSlots(TEXT_ROLES_CONFIRM_REASON, { reason }));
  }

  if (privileged.length > 0) {
    LINES.push(fillSlots(TEXT_ROLES_CONFIRM_PRIVILEGED, {
      permissions: privileged.map(humanizePermission).join(' · '),
    }));
  }
  return LINES.join('\n');
}

const REFUSAL_TEXTS: Record<RefusalReason, string> = {
  missing: TEXT_ROLES_REFUSAL_MISSING,
  everyone: TEXT_ROLES_REFUSAL_EVERYONE,
  managed: TEXT_ROLES_REFUSAL_MANAGED,
  sanction: TEXT_ROLES_REFUSAL_SANCTION,
  above_bot: TEXT_ROLES_REFUSAL_ABOVE_BOT,
};

/** The outcome sentence, box-2 refusals mapped to module texts. */
export function outcomeText(
  action: RoleCommandAction,
  report: RoleChangeReport
): string {
  const REFUSED = report.refused[0];

  if (REFUSED) {
    return REFUSAL_TEXTS[REFUSED.reason];
  }

  if (report.noop) {
    return action === 'grant'
      ? TEXT_ROLES_OUTCOME_NOOP_GRANT
      : TEXT_ROLES_OUTCOME_NOOP_REVOKE;
  }
  return action === 'grant'
    ? TEXT_ROLES_OUTCOME_GRANTED
    : TEXT_ROLES_OUTCOME_REVOKED;
}

function memberOption(
  option: SlashCommandUserOption
): SlashCommandUserOption {
  return option.setName('member')
    .setDescription('The member whose roles change.')
    .setRequired(true);
}

function reasonOption(
  option: SlashCommandStringOption
): SlashCommandStringOption {
  return option.setName('reason')
    .setDescription('Why this change is made, shown in the outcome card.');
}

const DATA = new SlashCommandBuilder()
  .setName('roles')
  .setDescription(
    'Grant or remove a member role by hand, with a confirm step.'
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('grant')
        .setDescription('Grant a role to a member after a confirm step.')
        .addUserOption(memberOption)
        .addRoleOption((option: SlashCommandRoleOption):
        SlashCommandRoleOption => {
          return option.setName('role')
            .setDescription('The role to grant.')
            .setRequired(true);
        })
        .addStringOption(reasonOption);
    }
  )
  .addSubcommand(
    (sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder => {
      return sub.setName('revoke')
        .setDescription('Remove a role from a member after a confirm step.')
        .addUserOption(memberOption)
        .addRoleOption((option: SlashCommandRoleOption):
        SlashCommandRoleOption => {
          return option.setName('role')
            .setDescription('The role to remove.')
            .setRequired(true);
        })
        .addStringOption(reasonOption);
    }
  );

const HELP = {
  long:
    'Manual role management for moderators. Grants or removes one ' +
    'role for one member through the same guarded write path the ' +
    'panels and rules use. Every change asks for confirmation ' +
    'first, and the prompt lists any privileged permissions the ' +
    'role carries.',
  usage: '/roles <grant|revoke> <member> <role> [reason]',
  examples: ['/roles grant @member Speaker'],
  permissions:
    'You can only hand out roles that sit below your own highest ' +
    'role.',
  subcommands: {
    grant: {
      long:
        'Grants one role to one member. The confirm prompt lists ' +
        'any privileged permissions the role carries so you see ' +
        'what you hand out. The grant is refused when the role ' +
        'sits at or above your own highest role.',
      usage: '/roles grant <member> <role> [reason]',
      examples: ['/roles grant @member Speaker Hosting the weekly event'],
    },
    revoke: {
      long:
        'Removes one role from one member after confirmation. The ' +
        'ledger releases the row so the role does not return on a ' +
        'rejoin restore.',
      usage: '/roles revoke <member> <role> [reason]',
      examples: ['/roles revoke @member Speaker'],
    },
  },
};

function outcomeCard(
  interaction: ChatInputCommandInteraction,
  action: RoleCommandAction,
  report: RoleChangeReport,
  target_user_id: string,
  role_id: string,
  reason: string | null,
  run_tag: string
): EmbedBuilder {
  const TEXT = outcomeText(action, report);
  const DESCRIPTION = reason
    ? `${TEXT}\n${fillSlots(TEXT_ROLES_CONFIRM_REASON, { reason })}`
    : TEXT;
  return buildEmbed({
    title: action === 'grant'
      ? TEXT_ROLES_CARD_TITLE_GRANT
      : TEXT_ROLES_CARD_TITLE_REVOKE,
    description: DESCRIPTION,
    thumbnail_url: interaction.client.user?.displayAvatarURL(),
    footer_text: moduleFooter(MODULE_NAME, ROLES_VERSION),
    fields: gridFields([
      { name: TEXT_ROLES_FIELD_MEMBER, value: userMention(target_user_id) },
      { name: TEXT_ROLES_FIELD_ROLE, value: roleMention(role_id) },
      {
        name: TEXT_ROLES_FIELD_MODERATOR,
        value: userMention(interaction.user.id),
      },
      { name: TEXT_ROLES_FIELD_RUN, value: `\`${run_tag}\`` },
    ]),
  });
}

async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const GUILD = interaction.guild;

  if (!GUILD) {
    await interaction.editReply({ content: TEXT_ROLES_GUILD_ONLY });
    return;
  }

  const SUB = interaction.options.getSubcommand();
  const ACTION: RoleCommandAction = SUB === 'grant' ? 'grant' : 'revoke';
  const TARGET_USER = interaction.options.getUser('member', true);
  const ROLE_OPTION = interaction.options.getRole('role', true);
  const REASON = interaction.options.getString('reason');

  /* GR-L3 re-check at grant time: read the role LIVE so the
     privileged listing reflects its current bitfield, never the
     stale option payload. */
  let role: Role | null;

  try {
    role = await GUILD.roles.fetch(ROLE_OPTION.id);
  } catch {
    role = null;
  }

  if (!role) {
    await interaction.editReply({
      content: TEXT_ROLES_ROLE_UNREADABLE,
    });
    return;
  }

  /* EX6 before the confirm: the actor's reach bounds the change. */
  const ACTOR = await GUILD.members.fetch(interaction.user.id);
  const BLOCKED = actorHierarchyBlocked(
    ACTOR.roles.highest.position,
    GUILD.ownerId === interaction.user.id,
    role.position
  );

  if (BLOCKED) {
    await interaction.editReply({
      content: TEXT_ROLES_HIERARCHY_BLOCKED,
    });
    return;
  }

  const PRIVILEGED = privilegedPermissionNames(
    role.permissions.toArray()
  );
  const CONFIRM = await confirmFlow(interaction, {
    preview: buildConfirmPreview(
      ACTION,
      userMention(TARGET_USER.id),
      roleMention(role.id),
      PRIVILEGED,
      REASON
    ),
  });

  if (!CONFIRM.ok) {
    await interaction.editReply({ content: CONFIRM.error });
    return;
  }

  if (!CONFIRM.data.confirmed) {
    await interaction.editReply({ content: TEXT_CONFIRM_CANCELLED });
    return;
  }

  const CHANGE = ACTION === 'grant'
    ? { add: [role.id] }
    : { remove: [role.id] };
  const RESULT = await applyRoleChange(
    interaction.client,
    GUILD.id,
    TARGET_USER.id,
    CHANGE,
    'manual',
    interaction.user.id
  );

  if (!RESULT.ok) {
    await interaction.editReply({ content: RESULT.error });
    return;
  }

  await interaction.editReply({
    content: null,
    embeds: [outcomeCard(
      interaction,
      ACTION,
      RESULT.data,
      TARGET_USER.id,
      role.id,
      REASON,
      CONFIRM.data.run_tag
    )],
  });
}

export const ROLES_COMMAND = {
  data: DATA,
  help: HELP,
  defer: 'ephemeral' as const,
  execute,
};
