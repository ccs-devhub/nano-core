/**
 * Public library surface of @ccs-devhub/nano-core. External modules
 * import everything they need from this barrel. discord.js formatters
 * and builders are re-exported so modules do not need a direct
 * discord.js version pin for the common cases.
 */
import '@/types/discord-augment.js';

export * from '@/api/audit-attribution.js';
export * from '@/api/channel.js';
export * from '@/api/component.js';
export * from '@/api/confirm.js';
export * from '@/api/dm.js';
export * from '@/api/embed.js';
export * from '@/api/embed-template.js';
export * from '@/api/emoji.js';
export * from '@/api/guild.js';
export * from '@/api/guild-config.js';
export * from '@/api/invite.js';
export * from '@/api/member.js';
export * from '@/api/message.js';
export * from '@/api/notice.js';
export * from '@/api/paginate.js';
export * from '@/api/presence.js';
export * from '@/api/role.js';
export * from '@/api/scheduled-event.js';
export * from '@/api/theme.js';
export * from '@/api/thread.js';
export * from '@/api/webhook.js';
export * from '@/constants/nano.js';
export * from '@/constants/text.js';
export * from '@/constants/ui.js';
export * from '@/misc/io/load-ts-modules.js';
export * from '@/misc/utility/command-sync.js';
export * from '@/misc/utility/custom-id.js';
export * from '@/misc/utility/emoji-slot.js';
export * from '@/misc/utility/format.js';
export * from '@/misc/utility/help-audit.js';
export * from '@/misc/utility/register-global-commands.js';
export * from '@/misc/utility/resolve-intents.js';
export * from '@/misc/utility/scale-options.js';
export * from '@/misc/utility/serial-queue.js';
export * from '@/registry/module-loader.js';
export * from '@/registry/module-registry.js';
/* GR5: the config READ surface only. The writers (saveConfig,
   setModuleState, addModuleEntry, removeModuleEntry,
   setModuleConfig) rewrite the HOST config and stay core-internal —
   an installed module must never flip host state. */
export type {
  ModuleEntry,
  ModuleProvenance,
  NanoConfig,
} from '@/registry/nano-config.js';
export {
  DEFAULT_REGISTRY_URL,
  defaultConfig,
  getModuleConfig,
  loadConfig,
  MODULE_ENTRY_SCHEMA,
  MODULE_PROVENANCE_SCHEMA,
  moduleEntryName,
  moduleEntrySpec,
  NANO_CONFIG_SCHEMA,
} from '@/registry/nano-config.js';
export * from '@/services/cache.js';
export * from '@/services/cooldown.js';
export * from '@/services/database.js';
export * from '@/services/errors.js';
export * from '@/services/guild-store.js';
export * from '@/services/lifecycle.js';
export * from '@/services/logger.js';
export * from '@/services/reconcile.js';
export * from '@/services/scheduler.js';
export * from '@/services/vitals.js';
export * from '@/types/nano-module.js';
export * from '@/types/nano-result.js';
export * from '@/types/nano-services.js';
export type {
  Attachment,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Guild,
  Role,
  SlashCommandAttachmentOption,
  SlashCommandChannelOption,
  SlashCommandStringOption,
  SlashCommandSubcommandBuilder,
} from 'discord.js';
export {
  bold,
  channelMention,
  ChannelType,
  codeBlock,
  escapeMarkdown,
  hyperlink,
  inlineCode,
  italic,
  PermissionFlagsBits,
  roleMention,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  userMention,
} from 'discord.js';
