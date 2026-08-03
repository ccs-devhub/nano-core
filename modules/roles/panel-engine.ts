import type { RolesPanel } from './config.js';
import { TEXT_ROLES_DB_REQUIRED } from './constants.js';
import type { PanelRow } from './panels.js';
import {
  isCustomEmojiId,
  panelById,
  resolvePanel,
  setPanelMessage,
  setPanelStatus,
  upsertPanel
} from './panels.js';

import type { Client, NanoResult } from '@ccs-devhub/nano-core';
import {
  buildEmbed,
  buttonRow,
  chunk,
  err,
  reactToMessage,
  renderEmbedTemplate,
  resolveEmojiSlot,
  roleMention,
  runSafe
} from '@ccs-devhub/nano-core';

/**
 * R1: the panel messaging engine. Publish freezes the CURRENT
 * config into the row (config_json) and owns the message; refresh
 * re-renders from current config and republishes when the message
 * vanished (10008), so a deleted panel heals instead of breaking
 * silently. The panel message itself is sent directly (the core
 * payload is JSON-only and carries no component rows); the
 * never-ping law is honored explicitly on every send.
 */

const MODULE_NAME = 'roles';
const BUTTONS_PER_ROW = 5;
const UNKNOWN_MESSAGE_CODE = 10008;
const NO_MENTIONS = { parse: [], repliedUser: false } as const;

/** Render an emoji_slot for message text. */
export function emojiDisplay(slot: string | null): string {
  if (!slot) {
    return '';
  }

  if (isCustomEmojiId(slot)) {
    return resolveEmojiSlot({ id: slot, fallback: '' });
  }
  return slot;
}

interface PanelEmbed {
  data: unknown;
}

/**
 * The panel body: a guild template when configured (embed-styler,
 * C7 layering — config first), else the shipped default list.
 */
export function renderPanelMessage(
  panel: RolesPanel
): NanoResult<PanelEmbed> {
  if (panel.template) {
    return renderEmbedTemplate(panel.template, { panel_id: panel.id });
  }

  const LINES = panel.map.map(
    (entry: RolesPanel['map'][number]): string => {
      const EMOJI = emojiDisplay(entry.emoji_slot);
      const LABEL = entry.label ?? roleMention(entry.role_id);
      const HEAD = EMOJI ? `${EMOJI} **${LABEL}**` : `**${LABEL}**`;
      return entry.description
        ? `${HEAD}, ${entry.description}`
        : HEAD;
    }
  );
  return runSafeSync((): PanelEmbed => {
    return buildEmbed({ description: LINES.join('\n') });
  });
}

/* buildEmbed cannot throw since the truncation audit fix, but the
   engine never trusts that at a distance. */
function runSafeSync<T>(fn: () => T): NanoResult<T> {
  try {
    return { ok: true, data: fn() };
  } catch (error: unknown) {
    return err(error);
  }
}

/** Button rows for a button-surface panel, five per row. */
export function panelComponents(panel: RolesPanel): unknown[] {
  return chunk(panel.map, BUTTONS_PER_ROW).map(
    (entries: RolesPanel['map'][number][]): unknown => {
      return buttonRow(entries.map(
        (entry: RolesPanel['map'][number]): {
          module: string;
          action: string;
          args: string[];
          label: string;
          style: 'secondary';
          emoji?: string;
        } => {
          return {
            module: MODULE_NAME,
            action: 'pick',
            args: [panel.id, entry.role_id],
            label: entry.label ?? entry.role_id,
            style: 'secondary',
            emoji: entry.emoji_slot ?? undefined,
          };
        }
      ));
    }
  );
}

interface SendableChannel {
  isTextBased(): boolean;
  send(options: {
    embeds: unknown[];
    components?: unknown[];
    allowedMentions: typeof NO_MENTIONS;
  }): Promise<{ id: string }>;
  messages: {
    fetch(message_id: string): Promise<{
      edit(options: {
        embeds: unknown[];
        allowedMentions: typeof NO_MENTIONS;
      }): Promise<unknown>;
    }>;
  };
}

async function panelChannel(
  bot: Client,
  channel_id: string
): Promise<SendableChannel> {
  const CHANNEL = await bot.channels.fetch(channel_id) as
    unknown as SendableChannel | null;

  if (!CHANNEL || !CHANNEL.isTextBased()) {
    throw new Error(
      `Channel '${channel_id}' is not a text channel.`
    );
  }
  return CHANNEL;
}

async function sendPanelMessage(
  bot: Client,
  panel: RolesPanel
): Promise<string> {
  const RENDERED = renderPanelMessage(panel);

  if (!RENDERED.ok) {
    throw new Error(RENDERED.error);
  }

  const CHANNEL = await panelChannel(bot, panel.channel_id);
  const MESSAGE = await CHANNEL.send({
    embeds: [RENDERED.data],
    components: panel.surface === 'button'
      ? panelComponents(panel)
      : undefined,
    allowedMentions: NO_MENTIONS,
  });
  return MESSAGE.id;
}

/** Seed the map's reactions in order; failures are tolerated. */
async function seedReactions(
  bot: Client,
  panel: RolesPanel,
  message_id: string
): Promise<string[]> {
  const FAILURES: string[] = [];

  if (panel.surface !== 'reaction') {
    return FAILURES;
  }

  for (const _entry of panel.map) {
    if (!_entry.emoji_slot) {
      continue;
    }

    const REACTED = await reactToMessage(
      bot,
      panel.channel_id,
      message_id,
      _entry.emoji_slot
    );

    if (!REACTED.ok) {
      FAILURES.push(_entry.emoji_slot);
    }
  }
  return FAILURES;
}

export interface PanelPublishReceipt {
  message_id: string;
  republished: boolean;
  seed_failures: string[];
}

/** Publish a panel: send, freeze config into the row, seed. */
export async function publishPanel(
  bot: Client,
  guild_id: string,
  panel: RolesPanel
): Promise<NanoResult<PanelPublishReceipt>> {
  const DATABASE = bot.services.database;

  if (!DATABASE) {
    return err(TEXT_ROLES_DB_REQUIRED);
  }

  return runSafe(async (): Promise<PanelPublishReceipt> => {
    const MESSAGE_ID = await sendPanelMessage(bot, panel);
    upsertPanel(DATABASE.getDb(), {
      guild_id,
      panel_id: panel.id,
      channel_id: panel.channel_id,
      message_id: MESSAGE_ID,
      surface: panel.surface,
      config_json: JSON.stringify(resolvePanel(panel)),
      status: 'active',
      updated_at: Date.now(),
    });
    const SEED_FAILURES = await seedReactions(bot, panel, MESSAGE_ID);
    return {
      message_id: MESSAGE_ID,
      republished: false,
      seed_failures: SEED_FAILURES,
    };
  });
}

function isUnknownMessage(error: unknown): boolean {
  return (error as { code?: number } | null)?.code ===
    UNKNOWN_MESSAGE_CODE;
}

/**
 * Refresh a panel from CURRENT config: edit in place, or republish
 * when the message vanished (10008 — B12: the row is marked broken
 * first, then healed by the republish). Reactions are re-seeded
 * either way so the map stays pickable.
 */
export async function refreshPanel(
  bot: Client,
  guild_id: string,
  panel: RolesPanel
): Promise<NanoResult<PanelPublishReceipt>> {
  const DATABASE = bot.services.database;

  if (!DATABASE) {
    return err(TEXT_ROLES_DB_REQUIRED);
  }

  const ROW: PanelRow | null = panelById(
    DATABASE.getDb(),
    guild_id,
    panel.id
  );

  if (!ROW || !ROW.message_id) {
    return publishPanel(bot, guild_id, panel);
  }

  const MESSAGE_ID = ROW.message_id;
  return runSafe(async (): Promise<PanelPublishReceipt> => {
    const RENDERED = renderPanelMessage(panel);

    if (!RENDERED.ok) {
      throw new Error(RENDERED.error);
    }

    let republished = false;
    let current_message_id = MESSAGE_ID;

    try {
      const CHANNEL = await panelChannel(bot, panel.channel_id);
      const MESSAGE = await CHANNEL.messages.fetch(MESSAGE_ID);
      await MESSAGE.edit({
        embeds: [RENDERED.data],
        allowedMentions: NO_MENTIONS,
      });
    } catch (error: unknown) {
      if (!isUnknownMessage(error)) {
        throw error;
      }

      setPanelStatus(
        DATABASE.getDb(),
        guild_id,
        panel.id,
        'broken',
        Date.now()
      );
      current_message_id = await sendPanelMessage(bot, panel);
      republished = true;
    }

    upsertPanel(DATABASE.getDb(), {
      guild_id,
      panel_id: panel.id,
      channel_id: panel.channel_id,
      message_id: current_message_id,
      surface: panel.surface,
      config_json: JSON.stringify(resolvePanel(panel)),
      status: 'active',
      updated_at: Date.now(),
    });

    if (republished) {
      setPanelMessage(
        DATABASE.getDb(),
        guild_id,
        panel.id,
        current_message_id,
        Date.now()
      );
    }

    const SEED_FAILURES = await seedReactions(
      bot,
      panel,
      current_message_id
    );
    return {
      message_id: current_message_id,
      republished,
      seed_failures: SEED_FAILURES,
    };
  });
}
