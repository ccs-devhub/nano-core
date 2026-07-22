import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Message
} from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags
} from 'discord.js';

/**
 * Button-driven embed pagination with a bounded collector. Buttons
 * disable themselves when the collector times out, so no session leaks.
 */
export interface PaginateOptions {
  time_ms?: number;
  ephemeral?: boolean;
}

const DEFAULT_TIME_MS = 120000;
const PREV_ID = 'nano-page-prev';
const NEXT_ID = 'nano-page-next';
const COUNT_ID = 'nano-page-count';

export async function paginate(
  interaction: ChatInputCommandInteraction,
  pages: EmbedBuilder[],
  options: PaginateOptions = {}
): Promise<void> {
  if (pages.length === 0) {
    return;
  }

  const FLAGS: { flags?: MessageFlags.Ephemeral } = options.ephemeral
    ? { flags: MessageFlags.Ephemeral }
    : {};

  if (pages.length === 1) {
    await send(interaction, { embeds: [pages[0]], ...FLAGS });
    return;
  }

  let index = 0;
  const MESSAGE = await send(interaction, {
    embeds: [pages[0]],
    components: [buildRow(0, pages.length, false)],
    ...FLAGS,
  });
  const COLLECTOR = MESSAGE.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: options.time_ms ?? DEFAULT_TIME_MS,
  });

  COLLECTOR.on('collect', (press: ButtonInteraction): void => {
    void (async (): Promise<void> => {
      if (press.user.id !== interaction.user.id) {
        await press.reply({
          content: 'These buttons belong to someone else.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      index = press.customId === NEXT_ID
        ? Math.min(index + 1, pages.length - 1)
        : Math.max(index - 1, 0);
      await press.update({
        embeds: [pages[index]],
        components: [buildRow(index, pages.length, false)],
      });
    })();
  });

  COLLECTOR.on('end', (): void => {
    void interaction.editReply({
      components: [buildRow(index, pages.length, true)],
    }).catch((): void => {
      /* message deleted or interaction expired — nothing to disable */
    });
  });
}

async function send(
  interaction: ChatInputCommandInteraction,
  payload: Parameters<ChatInputCommandInteraction['reply']>[0]
): Promise<Message> {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(
      payload as Parameters<ChatInputCommandInteraction['editReply']>[0]
    );
  }

  await interaction.reply(payload);
  return interaction.fetchReply();
}

function buildRow(
  index: number,
  total: number,
  disabled: boolean
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(PREV_ID)
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || index === 0),
    new ButtonBuilder()
      .setCustomId(COUNT_ID)
      .setLabel(`${index + 1}/${total}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(NEXT_ID)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || index === total - 1)
  );
}
