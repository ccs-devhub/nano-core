import { randomUUID } from 'node:crypto';

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Message
} from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags
} from 'discord.js';

import {
  TEXT_CANCEL_LABEL,
  TEXT_CONFIRM_LABEL
} from '@/constants/text.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * C1: the confirm-flow primitive for destructive actions — dry-run
 * preview, an UNFORGEABLE confirm component (server-side random
 * token, the EX3 opaque-key law: a forged customId cannot guess it,
 * and the collector additionally binds to the invoking user), a
 * run-tag for the read-back report. Consumers: purge slow path,
 * /module reconcile, the cull, rollout GO gates.
 */
export interface ConfirmFlowOptions {
  /** The dry-run render: exactly what will happen if confirmed. */
  preview: string;
  confirm_label?: string;
  cancel_label?: string;
  time_ms?: number;
  ephemeral?: boolean;
}

export interface ConfirmOutcome {
  confirmed: boolean;
  /** Short tag naming this run in the read-back report. */
  run_tag: string;
}

const DEFAULT_TIME_MS = 60000;
const RUN_TAG_LENGTH = 8;
const CONFIRM_PREFIX = 'nano-confirm';

export async function confirmFlow(
  interaction: ChatInputCommandInteraction,
  options: ConfirmFlowOptions
): Promise<NanoResult<ConfirmOutcome>> {
  const TOKEN = randomUUID();
  const RUN_TAG = TOKEN.slice(0, RUN_TAG_LENGTH);
  const CONFIRM_ID = `${CONFIRM_PREFIX}:ok:${TOKEN}`;
  const CANCEL_ID = `${CONFIRM_PREFIX}:no:${TOKEN}`;
  const ROW = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CONFIRM_ID)
      .setLabel(options.confirm_label ?? TEXT_CONFIRM_LABEL)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(CANCEL_ID)
      .setLabel(options.cancel_label ?? TEXT_CANCEL_LABEL)
      .setStyle(ButtonStyle.Secondary)
  );
  const BODY = { content: options.preview, components: [ROW] };
  const WANTS_EPHEMERAL = options.ephemeral !== false;

  let message: Message;

  try {
    if (interaction.deferred || interaction.replied) {
      /* editReply CANNOT change ephemerality — the flag would be
         silently dropped and a destructive prompt could land in
         public. Refuse instead of degrading. */
      if (WANTS_EPHEMERAL && !interaction.ephemeral) {
        return err(
          'confirmFlow needs an ephemeral reply, defer with ' +
          'MessageFlags.Ephemeral or call it before replying.'
        );
      }

      message = await interaction.editReply(BODY as never);
    } else {
      await interaction.reply({
        ...BODY,
        ...(WANTS_EPHEMERAL ? { flags: MessageFlags.Ephemeral } : {}),
      } as never);
      message = await interaction.fetchReply();
    }
  } catch (error: unknown) {
    return err(`Confirm prompt could not be sent: ${String(error)}`);
  }

  try {
    const PRESS = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: options.time_ms ?? DEFAULT_TIME_MS,
      filter: (press: ButtonInteraction): boolean => {
        return press.user.id === interaction.user.id &&
          (press.customId === CONFIRM_ID ||
            press.customId === CANCEL_ID);
      },
    });
    await PRESS.update({ components: [] });
    return ok({
      confirmed: PRESS.customId === CONFIRM_ID,
      run_tag: RUN_TAG,
    });
  } catch {
    /* timeout — disarm the buttons, treat as declined */
    try {
      await interaction.editReply({ components: [] });
    } catch {
      /* message deleted or interaction expired */
    }
    return ok({ confirmed: false, run_tag: RUN_TAG });
  }
}
