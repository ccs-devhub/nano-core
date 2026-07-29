import type {
  AutoModerationRule,
  AutoModerationRuleCreateOptions,
  AutoModerationRuleEditOptions,
  Client,
  GuildEditOptions,
  GuildOnboardingPrompt,
  GuildOnboardingPromptOption,
  WelcomeChannel
} from 'discord.js';
import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  GuildExplicitContentFilter,
  GuildMFALevel,
  GuildOnboardingMode,
  GuildOnboardingPromptType,
  GuildPremiumTier,
  GuildVerificationLevel
} from 'discord.js';

import { requireGuild } from '@/api/guild.js';
import type { NanoResult } from '@/types/nano-result.js';
import { runSafe } from '@/types/nano-result.js';

/**
 * Guild-level configuration surface: server settings, AutoMod rules,
 * the welcome screen, native onboarding (Channels & Roles), incident
 * actions, and custom emojis. Everything the Discord API exposes for
 * "Server Settings" style administration, as plain JSON.
 */

function resolveEnum(
  table: Record<string, string | number>,
  name: string,
  label: string
): number {
  const VALUE = table[name];

  if (typeof VALUE !== 'number') {
    throw new Error(`Unknown ${label} '${name}'.`);
  }
  return VALUE;
}

/* ------------------------------------------------------------------ */
/* Server settings                                                     */
/* ------------------------------------------------------------------ */

/** Plain-JSON view of the editable server settings. */
export interface GuildSettingsSummary {
  id: string;
  name: string;
  description: string | null;
  verification_level: string;
  explicit_content_filter: string;
  mfa_level: string;
  rules_channel_id: string | null;
  public_updates_channel_id: string | null;
  safety_alerts_channel_id: string | null;
  system_channel_id: string | null;
  system_channel_flags: string[];
  afk_channel_id: string | null;
  afk_timeout_seconds: number;
  premium_tier: string;
  premium_subscription_count: number | null;
  vanity_url_code: string | null;
  invites_disabled_until: string | null;
  dms_disabled_until: string | null;
  features: string[];
}

export interface EditGuildSettingsOptions {
  description?: string | null;
  verification_level?: string;
  explicit_content_filter?: string;
  rules_channel_id?: string | null;
  public_updates_channel_id?: string | null;
  safety_alerts_channel_id?: string | null;
  system_channel_id?: string | null;
  afk_channel_id?: string | null;
  afk_timeout_seconds?: number;
  reason?: string;
}

async function buildSettingsSummary(
  bot: Client,
  guild_id: string
): Promise<GuildSettingsSummary> {
  const GUILD = await requireGuild(bot, guild_id);
  return {
    id: GUILD.id,
    name: GUILD.name,
    description: GUILD.description,
    verification_level:
      GuildVerificationLevel[GUILD.verificationLevel],
    explicit_content_filter:
      GuildExplicitContentFilter[GUILD.explicitContentFilter],
    mfa_level: GuildMFALevel[GUILD.mfaLevel],
    rules_channel_id: GUILD.rulesChannelId,
    public_updates_channel_id: GUILD.publicUpdatesChannelId,
    safety_alerts_channel_id: GUILD.safetyAlertsChannelId,
    system_channel_id: GUILD.systemChannelId,
    system_channel_flags: GUILD.systemChannelFlags.toArray(),
    afk_channel_id: GUILD.afkChannelId,
    afk_timeout_seconds: GUILD.afkTimeout,
    premium_tier: GuildPremiumTier[GUILD.premiumTier],
    premium_subscription_count: GUILD.premiumSubscriptionCount,
    vanity_url_code: GUILD.vanityURLCode,
    invites_disabled_until:
      GUILD.incidentsData?.invitesDisabledUntil?.toISOString() ?? null,
    dms_disabled_until:
      GUILD.incidentsData?.dmsDisabledUntil?.toISOString() ?? null,
    features: [...GUILD.features],
  };
}

/** Read the server settings (Server Settings > Overview / Safety). */
export async function getGuildSettings(
  bot: Client,
  guild_id: string
): Promise<NanoResult<GuildSettingsSummary>> {
  return runSafe(async (): Promise<GuildSettingsSummary> => {
    return buildSettingsSummary(bot, guild_id);
  });
}

/**
 * Edit server settings. Enum fields take names: verification_level
 * accepts None/Low/Medium/High/VeryHigh; explicit_content_filter
 * accepts Disabled/MembersWithoutRoles/AllMembers. The 2FA
 * requirement (mfa_level) is guild-owner-only and NOT editable here.
 */
export async function editGuildSettings(
  bot: Client,
  guild_id: string,
  options: EditGuildSettingsOptions
): Promise<NanoResult<GuildSettingsSummary>> {
  return runSafe(async (): Promise<GuildSettingsSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const PAYLOAD: GuildEditOptions = {};

    if (options.description !== undefined) {
      PAYLOAD.description = options.description;
    }

    if (options.verification_level !== undefined) {
      PAYLOAD.verificationLevel = resolveEnum(
        GuildVerificationLevel,
        options.verification_level,
        'verification level'
      );
    }

    if (options.explicit_content_filter !== undefined) {
      PAYLOAD.explicitContentFilter = resolveEnum(
        GuildExplicitContentFilter,
        options.explicit_content_filter,
        'content filter'
      );
    }

    if (options.rules_channel_id !== undefined) {
      PAYLOAD.rulesChannel = options.rules_channel_id;
    }

    if (options.public_updates_channel_id !== undefined) {
      PAYLOAD.publicUpdatesChannel = options.public_updates_channel_id;
    }

    if (options.safety_alerts_channel_id !== undefined) {
      PAYLOAD.safetyAlertsChannel = options.safety_alerts_channel_id;
    }

    if (options.system_channel_id !== undefined) {
      PAYLOAD.systemChannel = options.system_channel_id;
    }

    if (options.afk_channel_id !== undefined) {
      PAYLOAD.afkChannel = options.afk_channel_id;
    }

    if (options.afk_timeout_seconds !== undefined) {
      PAYLOAD.afkTimeout = options.afk_timeout_seconds;
    }

    if (options.reason !== undefined) {
      PAYLOAD.reason = options.reason;
    }

    await GUILD.edit(PAYLOAD);
    return buildSettingsSummary(bot, guild_id);
  });
}

/* ------------------------------------------------------------------ */
/* Incident actions (anti-raid)                                        */
/* ------------------------------------------------------------------ */

/** Current anti-raid incident state, ISO timestamps or null. */
export interface IncidentActionsSummary {
  invites_disabled_until: string | null;
  dms_disabled_until: string | null;
}

export interface SetIncidentActionsOptions {
  invites_disabled_until?: string | null;
  dms_disabled_until?: string | null;
}

/**
 * Pause invites and/or DMs guild-wide (anti-raid). Timestamps are ISO
 * 8601, at most 24 hours in the future; null lifts the pause.
 */
export async function setIncidentActions(
  bot: Client,
  guild_id: string,
  options: SetIncidentActionsOptions
): Promise<NanoResult<IncidentActionsSummary>> {
  return runSafe(async (): Promise<IncidentActionsSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const RESULT = await GUILD.setIncidentActions({
      invitesDisabledUntil: options.invites_disabled_until === undefined
        ? undefined
        : toDateOrNull(options.invites_disabled_until),
      dmsDisabledUntil: options.dms_disabled_until === undefined
        ? undefined
        : toDateOrNull(options.dms_disabled_until),
    });
    return {
      invites_disabled_until:
        RESULT.invitesDisabledUntil?.toISOString() ?? null,
      dms_disabled_until:
        RESULT.dmsDisabledUntil?.toISOString() ?? null,
    };
  });
}

function toDateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

/* ------------------------------------------------------------------ */
/* AutoMod rules                                                       */
/* ------------------------------------------------------------------ */

/** One AutoMod action, decoded. */
export interface AutoModActionSummary {
  type: string;
  channel_id: string | null;
  duration_seconds: number | null;
  custom_message: string | null;
}

/** Plain-JSON view of an AutoMod rule. */
export interface AutoModRuleSummary {
  id: string;
  name: string;
  enabled: boolean;
  event_type: string;
  trigger_type: string;
  keyword_filter: string[];
  regex_patterns: string[];
  presets: string[];
  allow_list: string[];
  mention_total_limit: number | null;
  mention_raid_protection: boolean;
  actions: AutoModActionSummary[];
  exempt_role_ids: string[];
  exempt_channel_ids: string[];
}

/** One AutoMod action to write. */
export interface AutoModActionInput {
  type: string;
  channel_id?: string;
  duration_seconds?: number;
  custom_message?: string;
}

export interface AutoModRuleOptions {
  name?: string;
  trigger_type?: string;
  enabled?: boolean;
  keyword_filter?: string[];
  regex_patterns?: string[];
  presets?: string[];
  allow_list?: string[];
  mention_total_limit?: number;
  mention_raid_protection?: boolean;
  actions?: AutoModActionInput[];
  exempt_role_ids?: string[];
  exempt_channel_ids?: string[];
  reason?: string;
}

function toAutoModRuleSummary(
  rule: AutoModerationRule
): AutoModRuleSummary {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    event_type: AutoModerationRuleEventType[rule.eventType],
    trigger_type: AutoModerationRuleTriggerType[rule.triggerType],
    keyword_filter: [...rule.triggerMetadata.keywordFilter],
    regex_patterns: [...rule.triggerMetadata.regexPatterns],
    presets: rule.triggerMetadata.presets.map(
      (preset: AutoModerationRuleKeywordPresetType): string => {
        return AutoModerationRuleKeywordPresetType[preset];
      }
    ),
    allow_list: [...rule.triggerMetadata.allowList],
    mention_total_limit: rule.triggerMetadata.mentionTotalLimit,
    mention_raid_protection:
      rule.triggerMetadata.mentionRaidProtectionEnabled,
    actions: rule.actions.map(
      (action: AutoModerationRule['actions'][number]):
      AutoModActionSummary => {
        return {
          type: AutoModerationActionType[action.type],
          channel_id: action.metadata.channelId ?? null,
          duration_seconds: action.metadata.durationSeconds ?? null,
          custom_message: action.metadata.customMessage ?? null,
        };
      }
    ),
    exempt_role_ids: Array.from(rule.exemptRoles.keys()),
    exempt_channel_ids: Array.from(rule.exemptChannels.keys()),
  };
}

function toActionOptions(
  inputs: AutoModActionInput[]
): AutoModerationRuleCreateOptions['actions'] {
  return inputs.map(
    (input: AutoModActionInput):
    AutoModerationRuleCreateOptions['actions'][number] => {
      return {
        type: resolveEnum(
          AutoModerationActionType, input.type, 'AutoMod action'
        ),
        metadata: {
          channel: input.channel_id,
          durationSeconds: input.duration_seconds,
          customMessage: input.custom_message,
        },
      };
    }
  );
}

function toTriggerMetadata(
  options: AutoModRuleOptions
): AutoModerationRuleCreateOptions['triggerMetadata'] {
  return {
    keywordFilter: options.keyword_filter,
    regexPatterns: options.regex_patterns,
    presets: options.presets?.map((name: string): number => {
      return resolveEnum(
        AutoModerationRuleKeywordPresetType, name, 'keyword preset'
      );
    }),
    allowList: options.allow_list,
    mentionTotalLimit: options.mention_total_limit,
    mentionRaidProtectionEnabled: options.mention_raid_protection,
  };
}

/** Every AutoMod rule of a guild. */
export async function listAutoModRules(
  bot: Client,
  guild_id: string
): Promise<NanoResult<AutoModRuleSummary[]>> {
  return runSafe(async (): Promise<AutoModRuleSummary[]> => {
    const GUILD = await requireGuild(bot, guild_id);
    const RULES = await GUILD.autoModerationRules.fetch();
    return Array.from(RULES.values()).map(toAutoModRuleSummary);
  });
}

/**
 * Create an AutoMod rule. trigger_type accepts Keyword, Spam,
 * KeywordPreset, MentionSpam, or MemberProfile; action types accept
 * BlockMessage, SendAlertMessage, or Timeout.
 */
export async function createAutoModRule(
  bot: Client,
  guild_id: string,
  options: AutoModRuleOptions
): Promise<NanoResult<AutoModRuleSummary>> {
  return runSafe(async (): Promise<AutoModRuleSummary> => {
    const GUILD = await requireGuild(bot, guild_id);

    if (!options.name || !options.trigger_type || !options.actions) {
      throw new Error(
        'AutoMod create needs name, trigger_type, and actions.'
      );
    }

    const RULE = await GUILD.autoModerationRules.create({
      name: options.name,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: resolveEnum(
        AutoModerationRuleTriggerType,
        options.trigger_type,
        'AutoMod trigger'
      ),
      triggerMetadata: toTriggerMetadata(options),
      actions: toActionOptions(options.actions),
      enabled: options.enabled ?? true,
      exemptRoles: options.exempt_role_ids,
      exemptChannels: options.exempt_channel_ids,
      reason: options.reason,
    });
    return toAutoModRuleSummary(RULE);
  });
}

/** Edit an AutoMod rule (name, enabled, metadata, actions, exempts). */
export async function editAutoModRule(
  bot: Client,
  guild_id: string,
  rule_id: string,
  options: AutoModRuleOptions
): Promise<NanoResult<AutoModRuleSummary>> {
  return runSafe(async (): Promise<AutoModRuleSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const RULE = await GUILD.autoModerationRules.fetch(rule_id);
    const PAYLOAD: AutoModerationRuleEditOptions = {};

    if (options.name !== undefined) {
      PAYLOAD.name = options.name;
    }

    if (options.enabled !== undefined) {
      PAYLOAD.enabled = options.enabled;
    }

    if (options.actions !== undefined) {
      PAYLOAD.actions = toActionOptions(options.actions);
    }

    const HAS_METADATA = options.keyword_filter !== undefined
      || options.regex_patterns !== undefined
      || options.presets !== undefined
      || options.allow_list !== undefined
      || options.mention_total_limit !== undefined
      || options.mention_raid_protection !== undefined;

    if (HAS_METADATA) {
      PAYLOAD.triggerMetadata = toTriggerMetadata(options);
    }

    if (options.exempt_role_ids !== undefined) {
      PAYLOAD.exemptRoles = options.exempt_role_ids;
    }

    if (options.exempt_channel_ids !== undefined) {
      PAYLOAD.exemptChannels = options.exempt_channel_ids;
    }

    if (options.reason !== undefined) {
      PAYLOAD.reason = options.reason;
    }

    const EDITED = await RULE.edit(PAYLOAD);
    return toAutoModRuleSummary(EDITED);
  });
}

/** Delete an AutoMod rule by id. */
export async function deleteAutoModRule(
  bot: Client,
  guild_id: string,
  rule_id: string,
  reason?: string
): Promise<NanoResult<string>> {
  return runSafe(async (): Promise<string> => {
    const GUILD = await requireGuild(bot, guild_id);
    const RULE = await GUILD.autoModerationRules.fetch(rule_id);
    await RULE.delete(reason);
    return rule_id;
  });
}

/* ------------------------------------------------------------------ */
/* Welcome screen                                                      */
/* ------------------------------------------------------------------ */

/** One recommended channel of the welcome screen. */
export interface WelcomeChannelSummary {
  channel_id: string;
  description: string;
  emoji: string | null;
}

/** Plain-JSON view of the Community welcome screen. */
export interface WelcomeScreenSummary {
  description: string | null;
  channels: WelcomeChannelSummary[];
}

export interface WelcomeChannelInput {
  channel_id: string;
  description: string;
  emoji?: string;
}

export interface EditWelcomeScreenOptions {
  enabled?: boolean;
  description?: string;
  channels?: WelcomeChannelInput[];
}

function toWelcomeScreenSummary(screen: {
  description: string | null;
  welcomeChannels: Map<string, WelcomeChannel>;
}): WelcomeScreenSummary {
  return {
    description: screen.description,
    channels: Array.from(screen.welcomeChannels.values()).map(
      (channel: WelcomeChannel): WelcomeChannelSummary => {
        return {
          channel_id: channel.channelId,
          description: channel.description,
          emoji: channel.emoji?.name ?? null,
        };
      }
    ),
  };
}

/** Read the Community welcome screen. */
export async function getWelcomeScreen(
  bot: Client,
  guild_id: string
): Promise<NanoResult<WelcomeScreenSummary>> {
  return runSafe(async (): Promise<WelcomeScreenSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const SCREEN = await GUILD.fetchWelcomeScreen();
    return toWelcomeScreenSummary(SCREEN);
  });
}

/** Edit the welcome screen (up to 5 recommended channels). */
export async function editWelcomeScreen(
  bot: Client,
  guild_id: string,
  options: EditWelcomeScreenOptions
): Promise<NanoResult<WelcomeScreenSummary>> {
  return runSafe(async (): Promise<WelcomeScreenSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const SCREEN = await GUILD.editWelcomeScreen({
      enabled: options.enabled,
      description: options.description,
      welcomeChannels: options.channels?.map(
        (input: WelcomeChannelInput): {
          channel: string;
          description: string;
          emoji?: string;
        } => {
          return {
            channel: input.channel_id,
            description: input.description,
            emoji: input.emoji,
          };
        }
      ),
    });
    return toWelcomeScreenSummary(SCREEN);
  });
}

/* ------------------------------------------------------------------ */
/* Native onboarding (Channels & Roles / Customization Questions)      */
/* ------------------------------------------------------------------ */

/** One answer option of a Customization Question. */
export interface OnboardingOptionSummary {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  role_ids: string[];
  channel_ids: string[];
}

/** One Customization Question. */
export interface OnboardingPromptSummary {
  id: string;
  title: string;
  single_select: boolean;
  required: boolean;
  in_onboarding: boolean;
  type: string;
  options: OnboardingOptionSummary[];
}

/** Plain-JSON view of the guild onboarding configuration. */
export interface OnboardingSummary {
  enabled: boolean;
  mode: string;
  default_channel_ids: string[];
  prompts: OnboardingPromptSummary[];
}

export interface OnboardingOptionInput {
  id?: string;
  title: string;
  description?: string;
  emoji?: string;
  role_ids?: string[];
  channel_ids?: string[];
}

export interface OnboardingPromptInput {
  id?: string;
  title: string;
  single_select?: boolean;
  required?: boolean;
  in_onboarding?: boolean;
  options: OnboardingOptionInput[];
}

export interface EditOnboardingOptions {
  enabled?: boolean;
  mode?: string;
  default_channel_ids?: string[];
  prompts?: OnboardingPromptInput[];
  reason?: string;
}

function toOnboardingPromptSummary(
  prompt: GuildOnboardingPrompt
): OnboardingPromptSummary {
  return {
    id: prompt.id,
    title: prompt.title,
    single_select: prompt.singleSelect,
    required: prompt.required,
    in_onboarding: prompt.inOnboarding,
    type: GuildOnboardingPromptType[prompt.type],
    options: Array.from(prompt.options.values()).map(
      (option: GuildOnboardingPromptOption): OnboardingOptionSummary => {
        return {
          id: option.id,
          title: option.title,
          description: option.description ?? null,
          emoji: option.emoji?.name ?? null,
          role_ids: Array.from(option.roles.keys()),
          channel_ids: Array.from(option.channels.keys()),
        };
      }
    ),
  };
}

/** Read the onboarding config incl. every Customization Question. */
export async function getOnboarding(
  bot: Client,
  guild_id: string
): Promise<NanoResult<OnboardingSummary>> {
  return runSafe(async (): Promise<OnboardingSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    const ONBOARDING = await GUILD.fetchOnboarding();
    return {
      enabled: ONBOARDING.enabled,
      mode: GuildOnboardingMode[ONBOARDING.mode],
      default_channel_ids: Array.from(
        ONBOARDING.defaultChannels.keys()
      ),
      prompts: Array.from(ONBOARDING.prompts.values()).map(
        toOnboardingPromptSummary
      ),
    };
  });
}

/**
 * Edit the onboarding config. `prompts` REPLACES the whole question
 * list when given - read first, then write the full desired state.
 * Pass an empty prompts array to clear every Customization Question.
 * mode accepts OnboardingDefault or OnboardingAdvanced.
 */
export async function editOnboarding(
  bot: Client,
  guild_id: string,
  options: EditOnboardingOptions
): Promise<NanoResult<OnboardingSummary>> {
  return runSafe(async (): Promise<OnboardingSummary> => {
    const GUILD = await requireGuild(bot, guild_id);
    await GUILD.editOnboarding({
      enabled: options.enabled,
      mode: options.mode === undefined
        ? undefined
        : resolveEnum(
          GuildOnboardingMode, options.mode, 'onboarding mode'
        ),
      defaultChannels: options.default_channel_ids,
      prompts: options.prompts?.map(
        (prompt: OnboardingPromptInput, index: number): {
          id: string;
          title: string;
          singleSelect: boolean;
          required: boolean;
          inOnboarding: boolean;
          type: number;
          options: {
            id?: string;
            title: string;
            description?: string;
            emoji?: string;
            roles: string[];
            channels: string[];
          }[];
        } => {
          return {
            id: prompt.id ?? String(index),
            title: prompt.title,
            singleSelect: prompt.single_select ?? false,
            required: prompt.required ?? false,
            inOnboarding: prompt.in_onboarding ?? false,
            type: GuildOnboardingPromptType.MultipleChoice,
            options: prompt.options.map(
              (option: OnboardingOptionInput): {
                id?: string;
                title: string;
                description?: string;
                emoji?: string;
                roles: string[];
                channels: string[];
              } => {
                return {
                  id: option.id,
                  title: option.title,
                  description: option.description,
                  emoji: option.emoji,
                  roles: option.role_ids ?? [],
                  channels: option.channel_ids ?? [],
                };
              }
            ),
          };
        }
      ),
      reason: options.reason,
    });
    const FRESH = await getOnboarding(bot, guild_id);

    if (!FRESH.ok) {
      throw new Error(FRESH.error);
    }
    return FRESH.data;
  });
}

/* Custom emoji create/delete live in @/api/emoji.js alongside the
   list surface. */
