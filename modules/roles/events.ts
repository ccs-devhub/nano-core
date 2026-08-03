import { MessageFlags } from 'discord.js';

import { applyRoleChange, ROLES_QUEUE } from './apply-role-change.js';
import type { RolesConfig } from './config.js';
import {
  TEXT_ROLES_DB_REQUIRED,
  TEXT_ROLES_PICK_GATE_AGE,
  TEXT_ROLES_PICK_GATE_SANCTIONED,
  TEXT_ROLES_PICK_GATE_TENURE,
  TEXT_ROLES_PICK_GRANTED,
  TEXT_ROLES_PICK_MAX,
  TEXT_ROLES_PICK_REMOVED,
  TEXT_ROLES_PICK_UNKNOWN
} from './constants.js';
import type {
  PickContext,
  PickRefusal,
  ResolvedPanel
} from './panels.js';
import {
  decidePick,
  decideUnpick,
  matchPanelEntry,
  panelById,
  panelByMessage,
  parseResolvedPanel
} from './panels.js';

import type {
  Client,
  NanoComponentInteraction
} from '@ccs-devhub/nano-core';
import {
  getModuleLogger,
  removeUserReaction,
  sendMemberNotice
} from '@ccs-devhub/nano-core';

/**
 * R1: the pick paths. Reactions route through a per-member+role
 * debounce (B15 — the LAST event inside the window is the member's
 * final intent, so add/remove flapping settles to one write), then
 * everything funnels into the slice-A decision engine and the
 * box-2 write path. Buttons answer ephemerally and validate every
 * pick against the PANEL ROW (EX3 — a forged customId cannot name
 * a role the row does not carry).
 */

const MODULE_NAME = 'roles';
const PICK_DEBOUNCE_MS = 2000;

const REFUSAL_TEXTS: Record<PickRefusal, string> = {
  unknown_role: TEXT_ROLES_PICK_UNKNOWN,
  gate_sanctioned: TEXT_ROLES_PICK_GATE_SANCTIONED,
  gate_age: TEXT_ROLES_PICK_GATE_AGE,
  gate_tenure: TEXT_ROLES_PICK_GATE_TENURE,
  max_picks: TEXT_ROLES_PICK_MAX,
};

export interface ReactionLike {
  partial: boolean;
  fetch(): Promise<ReactionLike>;
  emoji: { id: string | null; name: string | null };
  message: {
    id: string;
    guildId: string | null;
    channelId: string;
  };
}

export interface UserLike {
  id: string;
  bot: boolean;
}

interface ReactionRef {
  channel_id: string;
  message_id: string;
  emoji: string;
}

interface MemberView {
  held: string[];
  account_created_at: number;
  joined_at: number | null;
}

async function memberView(
  bot: Client,
  guild_id: string,
  user_id: string
): Promise<MemberView> {
  const GUILD = await bot.guilds.fetch(guild_id);
  const MEMBER = await GUILD.members.fetch(user_id);
  return {
    held: MEMBER.roles.cache.map((role: { id: string }): string => {
      return role.id;
    }),
    account_created_at: MEMBER.user?.createdTimestamp ?? 0,
    joined_at: MEMBER.joinedTimestamp ?? null,
  };
}

/** Refusal delivery on the reaction path: undo the pick, notice. */
async function refuseReactionPick(
  bot: Client,
  user_id: string,
  refusal: PickRefusal,
  reaction_ref: ReactionRef
): Promise<void> {
  const REMOVED = await removeUserReaction(
    bot,
    reaction_ref.channel_id,
    reaction_ref.message_id,
    reaction_ref.emoji,
    user_id
  );

  if (!REMOVED.ok) {
    getModuleLogger(MODULE_NAME).warn(
      { user_id, error: REMOVED.error },
      'Refused pick reaction could not be removed'
    );
  }

  const NOTICE = await sendMemberNotice(
    bot,
    user_id,
    REFUSAL_TEXTS[refusal]
  );

  if (!NOTICE.ok) {
    getModuleLogger(MODULE_NAME).info(
      { user_id, refusal },
      'Pick refusal notice undeliverable'
    );
  }
}

/**
 * The debounced pick execution: re-read the member, decide through
 * the pure engine, mutate through applyRoleChange only.
 */
export async function executePick(
  bot: Client,
  guild_id: string,
  user_id: string,
  panel: ResolvedPanel,
  role_id: string,
  action: 'add' | 'remove',
  reaction_ref: ReactionRef | null
): Promise<void> {
  const VIEW = await memberView(bot, guild_id, user_id);

  if (action === 'remove') {
    const CHANGE = decideUnpick(panel, VIEW.held, role_id);

    if (CHANGE.remove.length === 0) {
      return;
    }

    const APPLIED = await applyRoleChange(
      bot,
      guild_id,
      user_id,
      CHANGE,
      'panel'
    );

    if (!APPLIED.ok) {
      getModuleLogger(MODULE_NAME).warn(
        { guild_id, user_id, role_id, error: APPLIED.error },
        'Panel unpick failed'
      );
    }
    return;
  }

  const CONFIG = bot.services.guild_store
    .getGuildModuleConfig<RolesConfig>(guild_id, MODULE_NAME);
  const CONTEXT: PickContext = {
    held_role_ids: VIEW.held,
    account_created_at: VIEW.account_created_at,
    joined_at: VIEW.joined_at,
    sanctioned: VIEW.held.some((held: string): boolean => {
      return CONFIG.sanction_roles.includes(held);
    }),
    now: Date.now(),
  };
  const DECISION = decidePick(panel, CONTEXT, role_id);

  if (DECISION.refusal) {
    if (reaction_ref) {
      await refuseReactionPick(
        bot,
        user_id,
        DECISION.refusal,
        reaction_ref
      );
    }
    return;
  }

  if (
    DECISION.change.add.length === 0 &&
    DECISION.change.remove.length === 0
  ) {
    return;
  }

  const APPLIED = await applyRoleChange(
    bot,
    guild_id,
    user_id,
    DECISION.change,
    'panel'
  );

  if (!APPLIED.ok) {
    getModuleLogger(MODULE_NAME).warn(
      { guild_id, user_id, role_id, error: APPLIED.error },
      'Panel pick failed'
    );
  }
}

/**
 * Gateway entry for both reaction events. Self-catching, bot
 * -ignoring, partial-fetching; a message with no panel row is the
 * cheap exit. The final intent is debounced per member+role.
 */
export async function handleReactionEvent(
  bot: Client,
  reaction: ReactionLike,
  user: UserLike,
  action: 'add' | 'remove',
  debounce_ms: number = PICK_DEBOUNCE_MS
): Promise<void> {
  if (user.bot || user.id === (bot.user?.id ?? '')) {
    return;
  }

  let live = reaction;

  if (reaction.partial) {
    try {
      live = await reaction.fetch();
    } catch {
      return;
    }
  }

  const GUILD_ID = live.message.guildId;
  const DATABASE = bot.services.database;

  if (!GUILD_ID || !DATABASE) {
    return;
  }

  const ROW = panelByMessage(
    DATABASE.getDb(),
    GUILD_ID,
    live.message.id
  );

  if (!ROW || ROW.surface !== 'reaction') {
    return;
  }

  const PANEL = parseResolvedPanel(ROW.config_json);

  if (!PANEL.ok) {
    getModuleLogger(MODULE_NAME).warn(
      { guild_id: GUILD_ID, panel_id: ROW.panel_id },
      'Panel row unreadable — pick ignored'
    );
    return;
  }

  const ENTRY = matchPanelEntry(PANEL.data, live.emoji);

  if (!ENTRY) {
    return;
  }

  const REF: ReactionRef = {
    channel_id: live.message.channelId,
    message_id: live.message.id,
    emoji: live.emoji.id ?? live.emoji.name ?? '',
  };
  ROLES_QUEUE.debounce(
    `pick:${GUILD_ID}:${user.id}:${ENTRY.role_id}`,
    (): Promise<void> => {
      return executePick(
        bot,
        GUILD_ID,
        user.id,
        PANEL.data,
        ENTRY.role_id,
        action,
        REF
      );
    },
    debounce_ms
  );
}

/**
 * The button pick (customId roles:pick:<panel_id>:<role_id>).
 * Toggle semantics: held roles unpick, everything else runs the
 * gated pick. Refusals answer ephemerally and loudly (no ghost
 * state — the recoverability ruling).
 */
export async function pickComponent(
  interaction: NanoComponentInteraction,
  args: string[]
): Promise<void> {
  if (!interaction.isButton() || !interaction.guildId) {
    return;
  }

  const PANEL_ID = args[0];
  const ROLE_ID = args[1];
  const BOT = interaction.client;
  const DATABASE = BOT.services.database;

  if (!PANEL_ID || !ROLE_ID || !DATABASE) {
    await interaction.reply({
      content: TEXT_ROLES_DB_REQUIRED,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ROW = panelById(
    DATABASE.getDb(),
    interaction.guildId,
    PANEL_ID
  );
  const PANEL = ROW && ROW.surface === 'button' &&
    ROW.message_id === interaction.message.id
    ? parseResolvedPanel(ROW.config_json)
    : null;

  if (!PANEL || !PANEL.ok) {
    /* EX3: no live row behind the button — refuse loudly. */
    await interaction.reply({
      content: TEXT_ROLES_PICK_UNKNOWN,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const VIEW = await memberView(
    BOT,
    interaction.guildId,
    interaction.user.id
  );

  if (VIEW.held.includes(ROLE_ID)) {
    const CHANGE = decideUnpick(PANEL.data, VIEW.held, ROLE_ID);

    if (CHANGE.remove.length === 0) {
      await interaction.reply({
        content: TEXT_ROLES_PICK_UNKNOWN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const APPLIED = await applyRoleChange(
      BOT,
      interaction.guildId,
      interaction.user.id,
      CHANGE,
      'panel'
    );
    await interaction.reply({
      content: APPLIED.ok ? TEXT_ROLES_PICK_REMOVED : APPLIED.error,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const CONFIG = BOT.services.guild_store
    .getGuildModuleConfig<RolesConfig>(interaction.guildId, MODULE_NAME);
  const CONTEXT: PickContext = {
    held_role_ids: VIEW.held,
    account_created_at: VIEW.account_created_at,
    joined_at: VIEW.joined_at,
    sanctioned: VIEW.held.some((held: string): boolean => {
      return CONFIG.sanction_roles.includes(held);
    }),
    now: Date.now(),
  };
  const DECISION = decidePick(PANEL.data, CONTEXT, ROLE_ID);

  if (DECISION.refusal) {
    await interaction.reply({
      content: REFUSAL_TEXTS[DECISION.refusal],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const APPLIED = await applyRoleChange(
    BOT,
    interaction.guildId,
    interaction.user.id,
    DECISION.change,
    'panel'
  );
  await interaction.reply({
    content: APPLIED.ok ? TEXT_ROLES_PICK_GRANTED : APPLIED.error,
    flags: MessageFlags.Ephemeral,
  });
}
