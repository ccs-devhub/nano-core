import { z } from 'zod';

import type { Client, NanoResult } from '@ccs-devhub/nano-core';
import {
  addRoleToMember,
  banMember,
  bulkDeleteMessages,
  createChannel,
  createRole,
  deleteChannel,
  deleteMessage,
  deleteRole,
  editChannel,
  editMessage,
  editRole,
  fetchMessages,
  getChannel,
  getGuildSnapshot,
  getMember,
  kickMember,
  listChannels,
  listGuilds,
  listMembers,
  listRoles,
  NANO_VERSION,
  ok,
  pinMessage,
  reactToMessage,
  removeRoleFromMember,
  sendMessage,
  setNickname,
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
}

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
const READ_TOOL_COUNT = 11;
const WRITE_TOOL_COUNT = 16;
const MODERATION_TOOL_COUNT = 4;

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

/** Register every gated-in tool; returns how many were registered. */
export function registerNanoTools(
  server: McpServer,
  bot: Client,
  gates: McpGates
): number {
  registerReadTools(server, bot);
  let count = READ_TOOL_COUNT;

  if (gates.allow_write) {
    registerWriteTools(server, bot);
    count += WRITE_TOOL_COUNT;
  }

  if (gates.allow_moderation) {
    registerModerationTools(server, bot);
    count += MODERATION_TOOL_COUNT;
  }
  return count;
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
}

function registerWriteTools(server: McpServer, bot: Client): void {
  server.registerTool('send_message', {
    description: 'Send a message to a channel: plain content and/or a ' +
      'themed embed.',
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
    },
  }, async (input: {
    channel_id: string;
    content?: string;
    embed_title?: string;
    embed_description?: string;
    theme?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      if (!input.content && !input.embed_title &&
        !input.embed_description) {
        return Promise.resolve(
          { ok: false, error: 'Provide content or an embed.' } as
            NanoResult<unknown>
        );
      }

      if (!input.embed_title && !input.embed_description) {
        return sendMessage(bot, input.channel_id, input.content ?? '');
      }
      return sendMessage(bot, input.channel_id, {
        content: input.content,
        embed: {
          title: input.embed_title,
          description: input.embed_description,
        },
        theme: input.theme,
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
        .describe('Channel type (text, voice, category, ...)'),
      parent_id: z.string().optional()
        .describe('Parent category id'),
      topic: z.string().optional()
        .describe('Channel topic'),
    },
  }, async (input: {
    guild_id: string;
    name: string;
    type?: string;
    parent_id?: string;
    topic?: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return createChannel(bot, input.guild_id, {
        name: input.name,
        type: input.type,
        parent_id: input.parent_id,
        topic: input.topic,
      });
    });
  });

  server.registerTool('edit_channel', {
    description: 'Edit a channel (name, topic, parent, position).',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      channel_id: z.string().describe('Channel id'),
      name: z.string().optional()
        .describe('New name'),
      topic: z.string().optional()
        .describe('New topic'),
      position: z.number().optional()
        .describe('New position'),
    },
  }, async (input: {
    guild_id: string;
    channel_id: string;
    name?: string;
    topic?: string;
    position?: number;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return editChannel(bot, input.guild_id, input.channel_id, {
        name: input.name,
        topic: input.topic,
        position: input.position,
      });
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
    description: 'Create a role in a guild.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      name: z.string().describe('Role name'),
      color: z.string().optional()
        .describe('Hex color like #C678DD'),
      hoist: z.boolean().optional()
        .describe('Show separately in the member list'),
      mentionable: z.boolean().optional()
        .describe('Mentionable'),
    },
  }, async (input: {
    guild_id: string;
    name: string;
    color?: string;
    hoist?: boolean;
    mentionable?: boolean;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return createRole(bot, input.guild_id, {
        name: input.name,
        color: input.color,
        hoist: input.hoist,
        mentionable: input.mentionable,
      });
    });
  });

  server.registerTool('edit_role', {
    description: 'Edit a role (name, color, hoist, mentionable).',
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
    },
  }, async (input: {
    guild_id: string;
    role_id: string;
    name?: string;
    color?: string;
    hoist?: boolean;
    mentionable?: boolean;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return editRole(bot, input.guild_id, input.role_id, {
        name: input.name,
        color: input.color,
        hoist: input.hoist,
        mentionable: input.mentionable,
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
    },
  }, async (input: {
    guild_id: string;
    user_id: string;
    role_id: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return addRoleToMember(
        bot, input.guild_id, input.user_id, input.role_id
      );
    });
  });

  server.registerTool('remove_role_from_member', {
    description: 'Remove a role from a member.',
    inputSchema: {
      guild_id: z.string().describe('Guild id'),
      user_id: z.string().describe('User id'),
      role_id: z.string().describe('Role id'),
    },
  }, async (input: {
    guild_id: string;
    user_id: string;
    role_id: string;
  }): Promise<ToolOutput> => {
    return guarded(bot, (): Promise<NanoResult<unknown>> => {
      return removeRoleFromMember(
        bot, input.guild_id, input.user_id, input.role_id
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
