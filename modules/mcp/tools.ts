import { z } from 'zod';

import type { Client, NanoResult } from '@ccs-devhub/nano-core';
import {
  addRoleToMember,
  banMember,
  bulkDeleteMessages,
  createAutoModRule,
  createChannel,
  createEmoji,
  createInvite,
  createRole,
  createScheduledEvent,
  createThread,
  createWebhook,
  deleteAutoModRule,
  deleteChannel,
  deleteEmoji,
  deleteInvite,
  deleteMessage,
  deleteRole,
  deleteScheduledEvent,
  deleteWebhook,
  editAutoModRule,
  editChannel,
  editGuildSettings,
  editMessage,
  editOnboarding,
  editRole,
  editWelcomeScreen,
  err,
  fetchAuditLog,
  fetchMessages,
  getChannel,
  getGuildSettings,
  getGuildSnapshot,
  getMember,
  getOnboarding,
  getRole,
  getWelcomeScreen,
  kickMember,
  listAutoModRules,
  listBans,
  listChannels,
  listEmojis,
  listGuilds,
  listInvites,
  listMembers,
  listRoles,
  listScheduledEvents,
  listStickers,
  listThreads,
  listWebhooks,
  NANO_VERSION,
  ok,
  pinMessage,
  reactToMessage,
  removeOwnReaction,
  removeRoleFromMember,
  sendDirectMessage,
  sendMessage,
  sendWebhookMessage,
  setBotPresence,
  setChannelPermissions,
  setIncidentActions,
  setNickname,
  setRolePositions,
  setThreadArchived,
  timeoutMember,
  unbanMember,
  unpinMessage
} from '@ccs-devhub/nano-core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * The MCP tool surface: every tool wraps one NanoResult API call.
 * Plain ids in, the JSON envelope out. Write and moderation tools are
 * only REGISTERED when their gate is on, so ungated clients never see
 * them in tools/list.
 */
export interface McpGates {
  allow_write: boolean;
  allow_moderation: boolean;
  /** Tool names never registered, whatever the other gates say. */
  denied_tools: string[];
}

/**
 * The bridge token is otherwise guild-admin-equivalent: edit_role can
 * grant Administrator. These stay denied unless the owner explicitly
 * overrides module_config.mcp.denied_tools.
 */
export const DEFAULT_DENIED_TOOLS: string[] = [
  'edit_role',
  'set_role_positions',
  'add_role_to_member',
];

interface ToolText {
  type: 'text';
  text: string;
}

interface ToolOutput {
  content: ToolText[];
  isError?: boolean;
  [key: string]: unknown;
}

const JSON_INDENT = 2;

const OVERWRITE_INPUT = z.object({
  id: z.string().describe('Role or member id'),
  type: z.enum(['role', 'member']).optional()
    .describe('Target type (default role)'),
  allow: z.array(z.string()).optional()
    .describe('Permission names to allow, e.g. ViewChannel'),
  deny: z.array(z.string()).optional()
    .describe('Permission names to deny'),
});

interface OverwriteInputShape {
  id: string;
  type?: 'role' | 'member';
  allow?: string[];
  deny?: string[];
}

const ROLE_POSITION_INPUT = z.object({
  role_id: z.string().describe('Role id'),
  position: z.number().describe('Target position'),
});

const AUTOMOD_ACTION_INPUT = z.object({
  type: z.enum(['BlockMessage', 'SendAlertMessage', 'Timeout'])
    .describe('Action type'),
  channel_id: z.string().optional()
    .describe('Alert channel (SendAlertMessage)'),
  duration_seconds: z.number().optional()
    .describe('Timeout length in seconds (Timeout)'),
  custom_message: z.string().optional()
    .describe('Message shown when blocking (BlockMessage)'),
});

interface AutoModActionShape {
  type: 'BlockMessage' | 'SendAlertMessage' | 'Timeout';
  channel_id?: string;
  duration_seconds?: number;
  custom_message?: string;
}

interface AutoModRuleShape {
  name?: string;
  trigger_type?: string;
  enabled?: boolean;
  keyword_filter?: string[];
  regex_patterns?: string[];
  presets?: string[];
  allow_list?: string[];
  mention_total_limit?: number;
  mention_raid_protection?: boolean;
  actions?: AutoModActionShape[];
  exempt_role_ids?: string[];
  exempt_channel_ids?: string[];
  reason?: string;
}

const AUTOMOD_RULE_FIELDS = {
  enabled: z.boolean().optional()
    .describe('Rule enabled'),
  keyword_filter: z.array(z.string()).optional()
    .describe('Blocked words (Keyword trigger)'),
  regex_patterns: z.array(z.string()).optional()
    .describe('Blocked regex patterns (Keyword trigger)'),
  presets: z.array(z.string()).optional()
    .describe('Keyword presets: Profanity, SexualContent, Slurs'),
  allow_list: z.array(z.string()).optional()
    .describe('Words exempt from the trigger'),
  mention_total_limit: z.number().optional()
    .describe('Max unique mentions (MentionSpam trigger)'),
  mention_raid_protection: z.boolean().optional()
    .describe('Enable mention raid protection (MentionSpam)'),
  actions: z.array(AUTOMOD_ACTION_INPUT).optional()
    .describe('Actions executed on trigger'),
  exempt_role_ids: z.array(z.string()).optional()
    .describe('Roles the rule ignores'),
  exempt_channel_ids: z.array(z.string()).optional()
    .describe('Channels the rule ignores'),
  reason: z.string().optional()
    .describe('Audit log reason'),
};

const WELCOME_CHANNEL_INPUT = z.object({
  channel_id: z.string().describe('Channel id'),
  description: z.string().describe('Line shown under the channel'),
  emoji: z.string().optional()
    .describe('Unicode emoji or emoji id'),
});

interface WelcomeChannelShape {
  channel_id: string;
  description: string;
  emoji?: string;
}

const ONBOARDING_OPTION_INPUT = z.object({
  id: z.string().optional()
    .describe('Existing option id (omit for new options)'),
  title: z.string().describe('Option title'),
  description: z.string().optional()
    .describe('Option description'),
  emoji: z.string().optional()
    .describe('Unicode emoji or emoji id'),
  role_ids: z.array(z.string()).optional()
    .describe('Roles granted when the option is picked'),
  channel_ids: z.array(z.string()).optional()
    .describe('Channels revealed when the option is picked'),
});

const ONBOARDING_PROMPT_INPUT = z.object({
  id: z.string().optional()
    .describe('Existing prompt id (omit for new prompts)'),
  title: z.string().describe('Question title'),
  single_select: z.boolean().optional()
    .describe('Limit members to one option'),
  required: z.boolean().optional()
    .describe('Required during the onboarding flow'),
  in_onboarding: z.boolean().optional()
    .describe('Show in the new-member flow (false = Channels & ' +
      'Roles page only)'),
  options: z.array(ONBOARDING_OPTION_INPUT)
    .describe('Answer options'),
});

interface OnboardingOptionShape {
  id?: string;
  title: string;
  description?: string;
  emoji?: string;
  role_ids?: string[];
  channel_ids?: string[];
}

interface OnboardingPromptShape {
  id?: string;
  title: string;
  single_select?: boolean;
  required?: boolean;
  in_onboarding?: boolean;
  options: OnboardingOptionShape[];
}

const NOT_READY: ToolOutput = {
  content: [{
    type: 'text',
    text: 'Bot not ready - the gateway connection is still starting. ' +
      'Try again shortly.',
  }],
  isError: true,
};

function wrap(result: NanoResult<unknown>): ToolOutput {
  if (result.ok) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result.data, null, JSON_INDENT),
      }],
    };
  }
  return { content: [{ type: 'text', text: result.error }], isError: true };
}

async function guarded(
  bot: Client,
  run: () => Promise<NanoResult<unknown>>
): Promise<ToolOutput> {
  if (!bot.isReady()) {
    return NOT_READY;
  }
  return wrap(await run());
}

type RegisterToolFn = McpServer['registerTool'];

/**
 * Register every gated-in tool; returns how many were registered.
 * Denied tools are intercepted at the registration seam, so they
 * never appear in tools/list and can never execute.
 */
export function registerNanoTools(
  server: McpServer,
  bot: Client,
  gates: McpGates
): number {
  const DENIED = new Set(gates.denied_tools);
  const ORIGINAL = server.registerTool.bind(server) as
    (...args: unknown[]) => unknown;
  let registered = 0;

  const GATED = ((name: string, ...rest: unknown[]): unknown => {
    if (DENIED.has(name)) {
      return undefined;
    }
    registered += 1;
    return ORIGINAL(name, ...rest);
  }) as RegisterToolFn;

  const PATCHABLE = server as { registerTool: RegisterToolFn };
  PATCHABLE.registerTool = GATED;

  try {
    registerReadTools(server, bot);

    if (gates.allow_write) {
      registerWriteTools(server, bot);
    }

    if (gates.allow_moderation) {
      registerModerationTools(server, bot);
    }
  } finally {
    PATCHABLE.registerTool = ORIGINAL as RegisterToolFn;
  }
  return registered;
}

function registerReadTools(server: McpServer, bot: Client): void {
  server.registerTool('bot_vitals', {
    description: 'Core runtime vitals: version, readiness, websocket ' +
      'ping, uptime, and guild count.',
    inputSchema: {},
  }, async (): Promise<ToolOutput> => {
    return wrap(ok({
      version: NANO_VERSION,
      ready: bot.isReady(),
      ws_ping_ms: bot.ws.ping,
      uptime_ms: bot.uptime,
      guild_count: bot.guilds.cache.size,
    }));
  });

  server.registerTool('list_modules', {
    description: 'Every registered module with its health report.',
    inputSchema: {},
  }, async (): Promise<ToolOutput> => {
    return guarded(bot, async (): Promise<NanoResult<unknown>> => {
      return ok(await bot.nano.healthAll());
    });
  });

  server.registerTool('list_jobs', {
    description: 'Scheduled jobs (cron and one-shot) across modules.',
    inputSchema: {},
  }, async (): Promise<ToolOutput> => {
    return guarded(bot, async (): Promise<NanoResult<unknown>> => {
      return ok(bot.services.scheduler.listJobs());
    });
  });

  server.registerTool('list_guilds', {
    description: 'Every guild (server) the bot is a member of.',
    inputSchema: {},
  }, async (): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return listGuilds(bot);
    });
  });

  server.registerTool('guild_snapshot', {
    description: 'Full server map for one guild: channels, roles, ' +
      'member counts, metadata.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return getGuildSnapshot(bot, guild_id);
    });
  });

  server.registerTool('list_channels', {
    description: 'Every channel in a guild, in position order.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return listChannels(bot, guild_id);
    });
  });

  server.registerTool('get_channel', {
    description: 'One channel summary by id.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      channel_id: z.string().describe('Channel id'),
    },
  }, async (
    { guild_id, channel_id }: { guild_id: string; channel_id: string }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return getChannel(bot, guild_id, channel_id);
    });
  });

  server.registerTool('list_roles', {
    description: 'Every role in a guild, highest first.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return listRoles(bot, guild_id);
    });
  });

  server.registerTool('list_members', {
    description: 'Guild members (needs the GuildMembers privileged ' +
      'intent for a full list).',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      limit: z.number().optional()
        .describe('Max members to return'),
    },
  }, async (
    { guild_id, limit }: { guild_id: string; limit?: number }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return listMembers(bot, guild_id, limit);
    });
  });

  server.registerTool('get_member', {
    description: 'One member summary by user id.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      user_id: z.string().describe('User id'),
    },
  }, async (
    { guild_id, user_id }: { guild_id: string; user_id: string }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return getMember(bot, guild_id, user_id);
    });
  });

  server.registerTool('fetch_messages', {
    description: 'Recent messages from a channel, newest first.',
    inputSchema: {
      channel_id: z.string().describe('Channel id'),
      limit: z.number().optional()
        .describe('Max messages to return'),
    },
  }, async (
    { channel_id, limit }: { channel_id: string; limit?: number }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return fetchMessages(bot, channel_id, limit);
    });
  });

  server.registerTool('get_role', {
    description: 'One role summary by id.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      role_id: z.string().describe('Role id'),
    },
  }, async (
    { guild_id, role_id }: { guild_id: string; role_id: string }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return getRole(bot, guild_id, role_id);
    });
  });

  server.registerTool('list_threads', {
    description: 'Every active thread in a guild.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return listThreads(bot, guild_id);
    });
  });

  server.registerTool('list_webhooks', {
    description: 'Webhooks configured on a channel.',
    inputSchema: { channel_id: z.string().describe('Channel id') },
  }, async ({ channel_id }: { channel_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return listWebhooks(bot, channel_id);
    });
  });

  server.registerTool('list_invites', {
    description: 'Every active invite in a guild.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return listInvites(bot, guild_id);
    });
  });

  server.registerTool('list_emojis', {
    description: 'Every custom emoji in a guild.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return listEmojis(bot, guild_id);
    });
  });

  server.registerTool('list_stickers', {
    description: 'Every sticker uploaded to a guild.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return listStickers(bot, guild_id);
    });
  });

  server.registerTool('list_scheduled_events', {
    description: 'Every scheduled event in a guild.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return listScheduledEvents(bot, guild_id);
    });
  });

  server.registerTool('list_bans', {
    description: 'Every ban in a guild.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return listBans(bot, guild_id);
    });
  });

  server.registerTool('fetch_audit_log', {
    description: 'Recent audit-log entries for a guild, newest first.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      limit: z.number().optional()
        .describe('Max entries to return (default 25)'),
    },
  }, async (
    { guild_id, limit }: { guild_id: string; limit?: number }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return fetchAuditLog(bot, guild_id, limit);
    });
  });

  server.registerTool('get_guild_settings', {
    description: 'Server settings: verification level, content ' +
      'filter, 2FA level, rules/updates/system channels, AFK, boost ' +
      'tier and count, vanity code, incident state, features.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return getGuildSettings(bot, guild_id);
    });
  });

  server.registerTool('list_automod_rules', {
    description: 'Every AutoMod rule of a guild with triggers, ' +
      'actions, and exemptions.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return listAutoModRules(bot, guild_id);
    });
  });

  server.registerTool('get_welcome_screen', {
    description: 'The Community welcome screen: description and ' +
      'recommended channels.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return getWelcomeScreen(bot, guild_id);
    });
  });

  server.registerTool('get_onboarding', {
    description: 'The guild onboarding config: enabled flag, mode, ' +
      'default channels, and every Customization Question with its ' +
      'role/channel-granting options.',
    inputSchema: { guild_id: z.string().describe('Guild id') },
  }, async ({ guild_id }: { guild_id: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return getOnboarding(bot, guild_id);
    });
  });
}

function registerWriteTools(server: McpServer, bot: Client): void {
  server.registerTool('send_message', {
    description: 'Send a message to a channel: plain content, a themed ' +
      'embed, file attachments, a reply reference, a poll - any mix.',
    inputSchema: {
      channel_id: z.string().describe('Channel id'),
      content: z.string().optional()
        .describe('Plain text content'),
      embed_title: z.string().optional()
        .describe('Embed title'),
      embed_description: z.string().optional()
        .describe('Embed body text'),
      theme: z.string().optional()
        .describe('Registered theme name'),
      files: z.array(z.string()).optional()
        .describe('Attachment sources: https URLs only'),
      reply_to: z.string().optional()
        .describe('Message id this message replies to (same channel)'),
      poll_question: z.string().optional()
        .describe('Poll question (needs poll_answers)'),
      poll_answers: z.array(z.string()).optional()
        .describe('Poll answers, 2-10 plain strings'),
      poll_duration_hours: z.number().optional()
        .describe('Poll length in hours (default 24)'),
      poll_multi_select: z.boolean().optional()
        .describe('Allow picking several answers'),
    },
  }, async (input: {
    channel_id: string;
    content?: string;
    embed_title?: string;
    embed_description?: string;
    theme?: string;
    files?: string[];
    reply_to?: string;
    poll_question?: string;
    poll_answers?: string[];
    poll_duration_hours?: number;
    poll_multi_select?: boolean;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      const HAS_EMBED = Boolean(
        input.embed_title ?? input.embed_description
      );
      const HAS_POLL = Boolean(
        input.poll_question && input.poll_answers?.length
      );

      if (!input.content && !HAS_EMBED && !input.files?.length &&
        !HAS_POLL) {
        return Promise.resolve(
          err('Provide content, an embed, files, or a poll.')
        );
      }
      return sendMessage(bot, input.channel_id, {
        content: input.content,
        embed: HAS_EMBED
          ? {
            title: input.embed_title,
            description: input.embed_description,
          }
          : undefined,
        theme: input.theme,
        files: input.files,
        reply_to: input.reply_to,
        poll: HAS_POLL
          ? {
            question: input.poll_question ?? '',
            answers: input.poll_answers ?? [],
            duration_hours: input.poll_duration_hours,
            multi_select: input.poll_multi_select,
          }
          : undefined,
      });
    });
  });

  server.registerTool('edit_message', {
    description: 'Edit a message the bot sent.',
    inputSchema: {
      channel_id: z.string().describe('Channel id'),
      message_id: z.string().describe('Message id'),
      content: z.string().describe('New plain text content'),
    },
  }, async (input: {
    channel_id: string;
    message_id: string;
    content: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return editMessage(
        bot, input.channel_id, input.message_id, input.content
      );
    });
  });

  server.registerTool('delete_message', {
    description: 'Delete one message.',
    inputSchema: {
      channel_id: z.string().describe('Channel id'),
      message_id: z.string().describe('Message id'),
    },
  }, async (
    { channel_id, message_id }:
    { channel_id: string; message_id: string }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return deleteMessage(bot, channel_id, message_id);
    });
  });

  server.registerTool('bulk_delete_messages', {
    description: 'Bulk-delete recent messages from a channel ' +
      '(max 100, younger than 14 days).',
    inputSchema: {
      channel_id: z.string().describe('Channel id'),
      count: z.number().describe('How many messages to delete'),
    },
  }, async (
    { channel_id, count }: { channel_id: string; count: number }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return bulkDeleteMessages(bot, channel_id, count);
    });
  });

  server.registerTool('react_to_message', {
    description: 'Add an emoji reaction to a message.',
    inputSchema: {
      channel_id: z.string().describe('Channel id'),
      message_id: z.string().describe('Message id'),
      emoji: z.string().describe('Unicode emoji or custom emoji id'),
    },
  }, async (input: {
    channel_id: string;
    message_id: string;
    emoji: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return reactToMessage(
        bot, input.channel_id, input.message_id, input.emoji
      );
    });
  });

  server.registerTool('pin_message', {
    description: 'Pin a message in its channel.',
    inputSchema: {
      channel_id: z.string().describe('Channel id'),
      message_id: z.string().describe('Message id'),
    },
  }, async (
    { channel_id, message_id }:
    { channel_id: string; message_id: string }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return pinMessage(bot, channel_id, message_id);
    });
  });

  server.registerTool('unpin_message', {
    description: 'Unpin a message in its channel.',
    inputSchema: {
      channel_id: z.string().describe('Channel id'),
      message_id: z.string().describe('Message id'),
    },
  }, async (
    { channel_id, message_id }:
    { channel_id: string; message_id: string }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return unpinMessage(bot, channel_id, message_id);
    });
  });

  server.registerTool('create_channel', {
    description: 'Create a channel in a guild.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      name: z.string().describe('Channel name'),
      type: z.string().optional()
        .describe('ChannelType enum key: GuildText, GuildVoice, ' +
          'GuildCategory, GuildAnnouncement, GuildStageVoice, ' +
          'GuildForum (default GuildText)'),
      parent_id: z.string().optional()
        .describe('Parent category id'),
      topic: z.string().optional()
        .describe('Channel topic'),
      position: z.number().optional()
        .describe('Position in the channel list'),
      rate_limit_per_user: z.number().optional()
        .describe('Slowmode in seconds (0-21600)'),
      default_thread_rate_limit_per_user: z.number().optional()
        .describe('Default slowmode for new threads, seconds'),
      permission_overwrites: z.array(OVERWRITE_INPUT).optional()
        .describe('Permission overwrites to apply at creation'),
    },
  }, async (input: {
    guild_id: string;
    name: string;
    type?: string;
    parent_id?: string;
    topic?: string;
    position?: number;
    rate_limit_per_user?: number;
    default_thread_rate_limit_per_user?: number;
    permission_overwrites?: OverwriteInputShape[];
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return createChannel(bot, input.guild_id, {
        name: input.name,
        type: input.type,
        parent_id: input.parent_id,
        topic: input.topic,
        position: input.position,
        rate_limit_per_user: input.rate_limit_per_user,
        default_thread_rate_limit_per_user:
          input.default_thread_rate_limit_per_user,
        permission_overwrites: input.permission_overwrites,
      });
    });
  });

  server.registerTool('edit_channel', {
    description: 'Edit a channel (name, topic, parent, position, ' +
      'slowmode). Name/topic edits share Discord\'s 2-per-10min ' +
      'bucket; slowmode edits do not.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      channel_id: z.string().describe('Channel id'),
      name: z.string().optional()
        .describe('New name'),
      topic: z.string().optional()
        .describe('New topic'),
      parent_id: z.string().nullable()
        .optional()
        .describe('New parent category id (null detaches)'),
      position: z.number().optional()
        .describe('New position'),
      rate_limit_per_user: z.number().optional()
        .describe('Slowmode in seconds (0 clears, max 21600)'),
      default_thread_rate_limit_per_user: z.number().optional()
        .describe('Default slowmode for new threads, seconds'),
    },
  }, async (input: {
    guild_id: string;
    channel_id: string;
    name?: string;
    topic?: string;
    parent_id?: string | null;
    position?: number;
    rate_limit_per_user?: number;
    default_thread_rate_limit_per_user?: number;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return editChannel(bot, input.guild_id, input.channel_id, {
        name: input.name,
        topic: input.topic,
        parent_id: input.parent_id,
        position: input.position,
        rate_limit_per_user: input.rate_limit_per_user,
        default_thread_rate_limit_per_user:
          input.default_thread_rate_limit_per_user,
      });
    });
  });

  server.registerTool('set_channel_permissions', {
    description: 'Write channel permission overwrites. Default mode ' +
      'upserts each listed role/member exactly as given (empty ' +
      'allow+deny clears that target); replace=true swaps the entire ' +
      'overwrite list.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      channel_id: z.string().describe('Channel id'),
      overwrites: z.array(OVERWRITE_INPUT)
        .describe('Overwrites to write'),
      replace: z.boolean().optional()
        .describe('Replace the entire overwrite list'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    channel_id: string;
    overwrites: OverwriteInputShape[];
    replace?: boolean;
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return setChannelPermissions(
        bot, input.guild_id, input.channel_id, {
          overwrites: input.overwrites,
          replace: input.replace,
          reason: input.reason,
        }
      );
    });
  });

  server.registerTool('delete_channel', {
    description: 'Delete a channel.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      channel_id: z.string().describe('Channel id'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    channel_id: string;
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return deleteChannel(
        bot, input.guild_id, input.channel_id, input.reason
      );
    });
  });

  server.registerTool('create_role', {
    description: 'Create a role in a guild. permissions takes ' +
      'PermissionFlagsBits names; omitted = Discord copies ' +
      '@everyone\'s current set, so pass an explicit array (empty ' +
      'for zero) to be exact.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      name: z.string().describe('Role name'),
      color: z.string().optional()
        .describe('Hex color like #C678DD'),
      hoist: z.boolean().optional()
        .describe('Show separately in the member list'),
      mentionable: z.boolean().optional()
        .describe('Mentionable'),
      permissions: z.array(z.string()).optional()
        .describe('Permission names, e.g. SendMessages'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    name: string;
    color?: string;
    hoist?: boolean;
    mentionable?: boolean;
    permissions?: string[];
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return createRole(bot, input.guild_id, {
        name: input.name,
        color: input.color,
        hoist: input.hoist,
        mentionable: input.mentionable,
        permissions: input.permissions,
        reason: input.reason,
      });
    });
  });

  server.registerTool('edit_role', {
    description: 'Edit a role (name, color, hoist, mentionable, ' +
      'permissions). permissions REPLACES the whole set when given - ' +
      'an empty array strips every permission (works on @everyone: ' +
      'role id = guild id).',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      role_id: z.string().describe('Role id'),
      name: z.string().optional()
        .describe('New name'),
      color: z.string().optional()
        .describe('New hex color'),
      hoist: z.boolean().optional()
        .describe('Hoist flag'),
      mentionable: z.boolean().optional()
        .describe('Mentionable flag'),
      permissions: z.array(z.string()).optional()
        .describe('Full permission set; empty array = zero'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    role_id: string;
    name?: string;
    color?: string;
    hoist?: boolean;
    mentionable?: boolean;
    permissions?: string[];
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return editRole(bot, input.guild_id, input.role_id, {
        name: input.name,
        color: input.color,
        hoist: input.hoist,
        mentionable: input.mentionable,
        permissions: input.permissions,
        reason: input.reason,
      });
    });
  });

  server.registerTool('delete_role', {
    description: 'Delete a role.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      role_id: z.string().describe('Role id'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    role_id: string;
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return deleteRole(bot, input.guild_id, input.role_id, input.reason);
    });
  });

  server.registerTool('add_role_to_member', {
    description: 'Grant a role to a member.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      user_id: z.string().describe('User id'),
      role_id: z.string().describe('Role id'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    user_id: string;
    role_id: string;
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return addRoleToMember(
        bot, input.guild_id, input.user_id, input.role_id, input.reason
      );
    });
  });

  server.registerTool('remove_role_from_member', {
    description: 'Remove a role from a member.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      user_id: z.string().describe('User id'),
      role_id: z.string().describe('Role id'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    user_id: string;
    role_id: string;
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return removeRoleFromMember(
        bot, input.guild_id, input.user_id, input.role_id, input.reason
      );
    });
  });

  server.registerTool('set_nickname', {
    description: 'Set or clear a member nickname (empty string clears).',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      user_id: z.string().describe('User id'),
      nickname: z.string().describe('New nickname; empty to clear'),
    },
  }, async (input: {
    guild_id: string;
    user_id: string;
    nickname: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return setNickname(
        bot, input.guild_id, input.user_id, input.nickname || null
      );
    });
  });

  server.registerTool('send_dm', {
    description: 'Send a direct message to a user: plain content ' +
      'and/or a themed embed.',
    inputSchema: {
      user_id: z.string().describe('User id'),
      content: z.string().optional()
        .describe('Plain text content'),
      embed_title: z.string().optional()
        .describe('Embed title'),
      embed_description: z.string().optional()
        .describe('Embed body text'),
      theme: z.string().optional()
        .describe('Registered theme name'),
    },
  }, async (input: {
    user_id: string;
    content?: string;
    embed_title?: string;
    embed_description?: string;
    theme?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      const HAS_EMBED = Boolean(
        input.embed_title ?? input.embed_description
      );

      if (!input.content && !HAS_EMBED) {
        return Promise.resolve(err('Provide content or an embed.'));
      }
      return sendDirectMessage(bot, input.user_id, {
        content: input.content,
        embed: HAS_EMBED
          ? {
            title: input.embed_title,
            description: input.embed_description,
          }
          : undefined,
        theme: input.theme,
      });
    });
  });

  server.registerTool('remove_own_reaction', {
    description: 'Remove the bot\'s own reaction from a message.',
    inputSchema: {
      channel_id: z.string().describe('Channel id'),
      message_id: z.string().describe('Message id'),
      emoji: z.string().describe('Unicode emoji or custom emoji id'),
    },
  }, async (input: {
    channel_id: string;
    message_id: string;
    emoji: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return removeOwnReaction(
        bot, input.channel_id, input.message_id, input.emoji
      );
    });
  });

  server.registerTool('create_thread', {
    description: 'Create a thread on a text channel, or under one of ' +
      'its messages.',
    inputSchema: {
      channel_id: z.string().describe('Parent text channel id'),
      name: z.string().describe('Thread name'),
      message_id: z.string().optional()
        .describe('Start the thread from this message'),
      auto_archive_minutes: z.number().optional()
        .describe('Auto-archive after this many idle minutes'),
    },
  }, async (input: {
    channel_id: string;
    name: string;
    message_id?: string;
    auto_archive_minutes?: number;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return createThread(bot, input.channel_id, {
        name: input.name,
        message_id: input.message_id,
        auto_archive_minutes: input.auto_archive_minutes,
      });
    });
  });

  server.registerTool('set_thread_archived', {
    description: 'Archive or unarchive a thread.',
    inputSchema: {
      thread_id: z.string().describe('Thread id'),
      archived: z.boolean().describe('true archives, false restores'),
    },
  }, async (
    { thread_id, archived }: { thread_id: string; archived: boolean }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return setThreadArchived(bot, thread_id, archived);
    });
  });

  server.registerTool('create_webhook', {
    description: 'Create an incoming webhook on a text channel.',
    inputSchema: {
      channel_id: z.string().describe('Channel id'),
      name: z.string().describe('Webhook name'),
      avatar_url: z.string().optional()
        .describe('Avatar image URL'),
    },
  }, async (input: {
    channel_id: string;
    name: string;
    avatar_url?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return createWebhook(
        bot, input.channel_id, input.name, input.avatar_url
      );
    });
  });

  server.registerTool('send_webhook_message', {
    description: 'Send through a webhook, optionally masking the ' +
      'sender name and avatar.',
    inputSchema: {
      webhook_id: z.string().describe('Webhook id'),
      content: z.string().describe('Plain text content'),
      username: z.string().optional()
        .describe('Masked sender name'),
      avatar_url: z.string().optional()
        .describe('Masked sender avatar URL'),
    },
  }, async (input: {
    webhook_id: string;
    content: string;
    username?: string;
    avatar_url?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return sendWebhookMessage(bot, input.webhook_id, input.content, {
        username: input.username,
        avatar_url: input.avatar_url,
      });
    });
  });

  server.registerTool('delete_webhook', {
    description: 'Delete a webhook by id.',
    inputSchema: { webhook_id: z.string().describe('Webhook id') },
  }, async (
    { webhook_id }: { webhook_id: string }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return deleteWebhook(bot, webhook_id);
    });
  });

  server.registerTool('create_invite', {
    description: 'Create an invite for a guild channel.',
    inputSchema: {
      channel_id: z.string().describe('Channel id'),
      max_age_seconds: z.number().optional()
        .describe('Expiry in seconds; 0 never expires'),
      max_uses: z.number().optional()
        .describe('Max uses; 0 unlimited'),
      temporary: z.boolean().optional()
        .describe('Grant temporary membership'),
    },
  }, async (input: {
    channel_id: string;
    max_age_seconds?: number;
    max_uses?: number;
    temporary?: boolean;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return createInvite(bot, input.channel_id, {
        max_age_seconds: input.max_age_seconds,
        max_uses: input.max_uses,
        temporary: input.temporary,
      });
    });
  });

  server.registerTool('delete_invite', {
    description: 'Revoke an invite by code.',
    inputSchema: { code: z.string().describe('Invite code') },
  }, async ({ code }: { code: string }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return deleteInvite(bot, code);
    });
  });

  server.registerTool('create_scheduled_event', {
    description: 'Create a scheduled event: voice events need ' +
      'channel_id; external events need location plus end_at.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      name: z.string().describe('Event name'),
      start_at: z.string().describe('Start time, ISO 8601'),
      end_at: z.string().optional()
        .describe('End time, ISO 8601'),
      description: z.string().optional()
        .describe('Event description'),
      channel_id: z.string().optional()
        .describe('Voice channel id (voice event)'),
      location: z.string().optional()
        .describe('Location text (external event)'),
    },
  }, async (input: {
    guild_id: string;
    name: string;
    start_at: string;
    end_at?: string;
    description?: string;
    channel_id?: string;
    location?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return createScheduledEvent(bot, input.guild_id, {
        name: input.name,
        start_at: input.start_at,
        end_at: input.end_at,
        description: input.description,
        channel_id: input.channel_id,
        location: input.location,
      });
    });
  });

  server.registerTool('delete_scheduled_event', {
    description: 'Cancel a scheduled event by id.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      event_id: z.string().describe('Scheduled event id'),
    },
  }, async (
    { guild_id, event_id }: { guild_id: string; event_id: string }
  ): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return deleteScheduledEvent(bot, guild_id, event_id);
    });
  });

  server.registerTool('set_bot_presence', {
    description: 'Set the bot\'s own status and activity line.',
    inputSchema: {
      status: z.enum(['online', 'idle', 'dnd', 'invisible']).optional()
        .describe('Presence status'),
      activity: z.string().optional()
        .describe('Activity text'),
      activity_kind: z.enum([
        'playing',
        'listening',
        'watching',
        'competing',
        'custom',
      ]).optional()
        .describe('Activity verb (default custom)'),
    },
  }, async (input: {
    status?: 'online' | 'idle' | 'dnd' | 'invisible';
    activity?: string;
    activity_kind?:
      | 'playing'
      | 'listening'
      | 'watching'
      | 'competing'
      | 'custom';
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return Promise.resolve(setBotPresence(bot, {
        status: input.status,
        activity: input.activity,
        activity_kind: input.activity_kind,
      }));
    });
  });

  server.registerTool('set_role_positions', {
    description: 'Reorder roles in ONE bulk call. Only positions ' +
      'below the bot\'s own top role can move; the call emits no ' +
      'audit-log entry - verify via list_roles.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      positions: z.array(ROLE_POSITION_INPUT)
        .describe('Role/position rows to apply'),
    },
  }, async (input: {
    guild_id: string;
    positions: { role_id: string; position: number }[];
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return setRolePositions(bot, input.guild_id, input.positions);
    });
  });

  server.registerTool('edit_guild_settings', {
    description: 'Edit server settings. verification_level: None, ' +
      'Low, Medium, High, VeryHigh. explicit_content_filter: ' +
      'Disabled, MembersWithoutRoles, AllMembers. Channel fields ' +
      'take a channel id or null to clear. The 2FA requirement is ' +
      'guild-owner-only and cannot be set here.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      description: z.string().nullable()
        .optional()
        .describe('Server description'),
      verification_level: z.string().optional()
        .describe('Verification level name'),
      explicit_content_filter: z.string().optional()
        .describe('Content filter name'),
      rules_channel_id: z.string().nullable()
        .optional()
        .describe('Rules channel id'),
      public_updates_channel_id: z.string().nullable()
        .optional()
        .describe('Community Updates channel id'),
      safety_alerts_channel_id: z.string().nullable()
        .optional()
        .describe('Safety alerts channel id'),
      system_channel_id: z.string().nullable()
        .optional()
        .describe('System messages channel id'),
      afk_channel_id: z.string().nullable()
        .optional()
        .describe('AFK voice channel id'),
      afk_timeout_seconds: z.number().optional()
        .describe('AFK timeout in seconds'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
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
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return editGuildSettings(bot, input.guild_id, {
        description: input.description,
        verification_level: input.verification_level,
        explicit_content_filter: input.explicit_content_filter,
        rules_channel_id: input.rules_channel_id,
        public_updates_channel_id: input.public_updates_channel_id,
        safety_alerts_channel_id: input.safety_alerts_channel_id,
        system_channel_id: input.system_channel_id,
        afk_channel_id: input.afk_channel_id,
        afk_timeout_seconds: input.afk_timeout_seconds,
        reason: input.reason,
      });
    });
  });

  server.registerTool('create_automod_rule', {
    description: 'Create an AutoMod rule. trigger_type: Keyword, ' +
      'Spam, KeywordPreset, MentionSpam, or MemberProfile.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      name: z.string().describe('Rule name'),
      trigger_type: z.string().describe('Trigger type name'),
      ...AUTOMOD_RULE_FIELDS,
    },
  }, async (input: AutoModRuleShape & {
    guild_id: string;
    name: string;
    trigger_type: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      const { guild_id: GUILD_ID, ...OPTIONS } = input;
      return createAutoModRule(bot, GUILD_ID, OPTIONS);
    });
  });

  server.registerTool('edit_automod_rule', {
    description: 'Edit an AutoMod rule: name, enabled, trigger ' +
      'metadata, actions, exemptions.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      rule_id: z.string().describe('AutoMod rule id'),
      name: z.string().optional()
        .describe('New rule name'),
      ...AUTOMOD_RULE_FIELDS,
    },
  }, async (input: AutoModRuleShape & {
    guild_id: string;
    rule_id: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      const { guild_id: GUILD_ID, rule_id: RULE_ID, ...OPTIONS } = input;
      return editAutoModRule(bot, GUILD_ID, RULE_ID, OPTIONS);
    });
  });

  server.registerTool('delete_automod_rule', {
    description: 'Delete an AutoMod rule by id.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      rule_id: z.string().describe('AutoMod rule id'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    rule_id: string;
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return deleteAutoModRule(
        bot, input.guild_id, input.rule_id, input.reason
      );
    });
  });

  server.registerTool('edit_welcome_screen', {
    description: 'Edit the Community welcome screen: enabled flag, ' +
      'description, and up to 5 recommended channels.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      enabled: z.boolean().optional()
        .describe('Welcome screen enabled'),
      description: z.string().optional()
        .describe('Welcome description'),
      channels: z.array(WELCOME_CHANNEL_INPUT).optional()
        .describe('Recommended channels (replaces the list)'),
    },
  }, async (input: {
    guild_id: string;
    enabled?: boolean;
    description?: string;
    channels?: WelcomeChannelShape[];
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return editWelcomeScreen(bot, input.guild_id, {
        enabled: input.enabled,
        description: input.description,
        channels: input.channels,
      });
    });
  });

  server.registerTool('edit_onboarding', {
    description: 'Edit the guild onboarding config (Channels & ' +
      'Roles). prompts REPLACES the whole Customization Question ' +
      'list when given - read with get_onboarding first, then write ' +
      'the full desired state; an empty array clears every question. ' +
      'mode: OnboardingDefault or OnboardingAdvanced.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      enabled: z.boolean().optional()
        .describe('Native onboarding flow enabled'),
      mode: z.string().optional()
        .describe('Onboarding mode name'),
      default_channel_ids: z.array(z.string()).optional()
        .describe('Channels new members get opted into'),
      prompts: z.array(ONBOARDING_PROMPT_INPUT).optional()
        .describe('The full Customization Question list'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    enabled?: boolean;
    mode?: string;
    default_channel_ids?: string[];
    prompts?: OnboardingPromptShape[];
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return editOnboarding(bot, input.guild_id, {
        enabled: input.enabled,
        mode: input.mode,
        default_channel_ids: input.default_channel_ids,
        prompts: input.prompts,
        reason: input.reason,
      });
    });
  });

  server.registerTool('set_incident_actions', {
    description: 'Anti-raid incident actions: pause invites and/or ' +
      'DMs guild-wide. ISO 8601 timestamps at most 24h ahead; null ' +
      'lifts a pause.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      invites_disabled_until: z.string().nullable()
        .optional()
        .describe('Pause invites until this ISO time (null lifts)'),
      dms_disabled_until: z.string().nullable()
        .optional()
        .describe('Pause DMs until this ISO time (null lifts)'),
    },
  }, async (input: {
    guild_id: string;
    invites_disabled_until?: string | null;
    dms_disabled_until?: string | null;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return setIncidentActions(bot, input.guild_id, {
        invites_disabled_until: input.invites_disabled_until,
        dms_disabled_until: input.dms_disabled_until,
      });
    });
  });

  server.registerTool('create_emoji', {
    description: 'Upload a custom emoji from an image URL.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      name: z.string().describe('Emoji name'),
      image_url: z.string().describe('Image URL (png, jpg, gif)'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    name: string;
    image_url: string;
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return createEmoji(
        bot, input.guild_id, input.name, input.image_url, input.reason
      );
    });
  });

  server.registerTool('delete_emoji', {
    description: 'Delete a custom emoji by id.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      emoji_id: z.string().describe('Emoji id'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    emoji_id: string;
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return deleteEmoji(
        bot, input.guild_id, input.emoji_id, input.reason
      );
    });
  });
}

function registerModerationTools(server: McpServer, bot: Client): void {
  server.registerTool('kick_member', {
    description: 'Kick a member from a guild.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      user_id: z.string().describe('User id'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    user_id: string;
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return kickMember(bot, input.guild_id, input.user_id, input.reason);
    });
  });

  server.registerTool('ban_member', {
    description: 'Ban a member from a guild.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      user_id: z.string().describe('User id'),
      reason: z.string().optional()
        .describe('Audit log reason'),
      delete_message_seconds: z.number().optional()
        .describe('Purge this many seconds of their messages'),
    },
  }, async (input: {
    guild_id: string;
    user_id: string;
    reason?: string;
    delete_message_seconds?: number;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return banMember(bot, input.guild_id, input.user_id, {
        reason: input.reason,
        delete_message_seconds: input.delete_message_seconds,
      });
    });
  });

  server.registerTool('unban_member', {
    description: 'Lift a ban.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      user_id: z.string().describe('User id'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    user_id: string;
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return unbanMember(
        bot, input.guild_id, input.user_id, input.reason
      );
    });
  });

  server.registerTool('timeout_member', {
    description: 'Timeout a member (duration_ms null or 0 clears it).',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      user_id: z.string().describe('User id'),
      duration_ms: z.number().describe('Timeout length in ms; 0 clears'),
      reason: z.string().optional()
        .describe('Audit log reason'),
    },
  }, async (input: {
    guild_id: string;
    user_id: string;
    duration_ms: number;
    reason?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return timeoutMember(
        bot,
        input.guild_id,
        input.user_id,
        input.duration_ms || null,
        input.reason
      );
    });
  });
}
