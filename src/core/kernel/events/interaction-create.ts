import type {
  AutocompleteInteraction,
  Interaction
} from 'discord.js';
import { MessageFlags } from 'discord.js';

import { parseCustomId } from '@/misc/utility/custom-id.js';
import { replyWithError } from '@/services/errors.js';
import { getLogger } from '@/services/logger.js';
import type {
  NanoCommandInteraction,
  NanoComponentInteraction
} from '@/types/nano-module.js';

/**
 * The single interaction router: slash commands, context menus,
 * autocomplete, buttons, every select menu variant, and modals. One
 * listener total; per-type handlers below.
 */
const MS_PER_SECOND = 1000;
const DISABLED_REPLY = 'This command belongs to a disabled module.';

export default {
  name: 'interactionCreate',

  async execute(interaction: Interaction): Promise<void> {
    if (
      interaction.isChatInputCommand() ||
      interaction.isContextMenuCommand()
    ) {
      await handleCommand(interaction);
      return;
    }

    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }

    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      await handleComponent(interaction);
    }
  },
};

async function handleCommand(
  interaction: NanoCommandInteraction
): Promise<void> {
  const COMMAND = interaction.client.commands.get(interaction.commandName);

  if (!COMMAND) {
    return;
  }

  const REGISTRY = interaction.client.nano;

  if (REGISTRY && !REGISTRY.isCommandEnabled(interaction.commandName)) {
    await interaction.reply({
      content: DISABLED_REPLY,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const COOLDOWNS = interaction.client.services?.cooldowns;

  if (COOLDOWNS?.hasCooldown(interaction.commandName)) {
    const VERDICT = COOLDOWNS.consume(interaction.commandName, {
      user_id: interaction.user.id,
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
    });

    if (!VERDICT.allowed) {
      const SECONDS = Math.ceil(VERDICT.retry_after_ms / MS_PER_SECOND);
      await interaction.reply({
        content: `Slow down — try again in ${SECONDS}s.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  try {
    if (COMMAND.defer) {
      await interaction.deferReply(
        COMMAND.defer === 'ephemeral'
          ? { flags: MessageFlags.Ephemeral }
          : {}
      );
    }

    await COMMAND.execute(interaction);
  } catch (error: unknown) {
    getLogger().error(
      { err: error, command: interaction.commandName },
      'Command failed'
    );
    await replyWithError(interaction);
  }
}

async function handleAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const COMMAND = interaction.client.commands.get(interaction.commandName);
  const REGISTRY = interaction.client.nano;
  const ENABLED = !REGISTRY ||
    REGISTRY.isCommandEnabled(interaction.commandName);

  try {
    if (!COMMAND?.autocomplete || !ENABLED) {
      await interaction.respond([]);
      return;
    }

    await COMMAND.autocomplete(interaction);
  } catch (error: unknown) {
    getLogger().warn(
      { err: error, command: interaction.commandName },
      'Autocomplete failed'
    );

    if (!interaction.responded) {
      try {
        await interaction.respond([]);
      } catch {
        /* the 3s window closed — nothing left to do */
      }
    }
  }
}

async function handleComponent(
  interaction: NanoComponentInteraction
): Promise<void> {
  const PARSED = parseCustomId(interaction.customId);

  if (!PARSED) {
    return;
  }

  const REGISTRY = interaction.client.nano;

  if (!REGISTRY) {
    return;
  }

  const HANDLER = REGISTRY.getComponentHandler(PARSED.module, PARSED.action);

  if (!HANDLER) {
    const ENTRY = REGISTRY.get(PARSED.module);

    if (ENTRY && !ENTRY.enabled) {
      await interaction.reply({
        content: DISABLED_REPLY,
        flags: MessageFlags.Ephemeral,
      });
    }
    /* Unknown ids stay silent: collectors manage their own components. */
    return;
  }

  try {
    await HANDLER(interaction, PARSED.args);
  } catch (error: unknown) {
    getLogger().error(
      { err: error, custom_id: interaction.customId },
      'Component handler failed'
    );
    await replyWithError(interaction);
  }
}
