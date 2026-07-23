import {
  mcpHealth,
  mcpStatus,
  startMcpServer,
  stopMcpServer
} from './server.js';

import type {
  Client,
  NanoCommandInteraction,
  NanoHealthReport,
  NanoModule
} from '@ccs-devhub/nano-core';
import {
  buildEmbed,
  PermissionFlagsBits,
  SlashCommandBuilder
} from '@ccs-devhub/nano-core';

/**
 * mcp - the AI bridge. Runs a Model Context Protocol server inside
 * the bot process so MCP clients (Claude Code, agents, editors) can
 * drive the NanoResult API layer: scan guilds, read channels, check
 * vitals, and - when explicitly gated on - act. License: MIT.
 */
const MCP_COMMAND = {
  data: new SlashCommandBuilder()
    .setName('mcp')
    .setDescription('MCP bridge status: endpoint, tools, gates.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  defer: 'ephemeral' as const,

  async execute(interaction: NanoCommandInteraction): Promise<void> {
    const STATUS = mcpStatus();
    await interaction.editReply({
      embeds: [buildEmbed({
        title: 'mcp bridge',
        description: STATUS.detail,
        fields: [
          {
            name: 'state',
            value: STATUS.listening ? 'listening' : 'down',
            inline: true,
          },
          { name: 'port', value: String(STATUS.port), inline: true },
          {
            name: 'tools',
            value: String(STATUS.tool_count),
            inline: true,
          },
          {
            name: 'write',
            value: STATUS.gates.allow_write ? 'enabled' : 'disabled',
            inline: true,
          },
          {
            name: 'moderation',
            value: STATUS.gates.allow_moderation ? 'enabled' : 'disabled',
            inline: true,
          },
        ],
        timestamp: true,
      })],
    });
  },
};

const MODULE: NanoModule = {
  name: 'mcp',
  version: '0.1.0',
  license: 'MIT',
  description: 'AI bridge: an MCP server inside the bot process ' +
    'exposing the NanoResult API layer as tools.',
  commands: [MCP_COMMAND],
  tui: 'nano-tui.json',

  onEnable: async (bot: Client): Promise<void> => {
    await startMcpServer(bot);
  },

  onDisable: async (): Promise<void> => {
    await stopMcpServer();
  },

  healthCheck: (): NanoHealthReport => {
    return mcpHealth();
  },
};

export default MODULE;
