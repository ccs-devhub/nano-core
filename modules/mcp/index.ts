import { mcpHealth, startMcpServer, stopMcpServer } from './server.js';

import type {
  Client,
  NanoHealthReport,
  NanoModule
} from '@ccs-devhub/nano-core';

/**
 * mcp - the AI bridge. Runs a Model Context Protocol server inside
 * the bot process so MCP clients (AI agents, editors) can
 * drive the NanoResult API layer: scan guilds, read channels, check
 * vitals, and - when explicitly gated on - act. A pure core
 * extension: no slash commands; status lives in `/module health mcp`
 * and the TUI panel. License: MIT.
 */
const MODULE: NanoModule = {
  name: 'mcp',
  version: '0.4.0',
  license: 'MIT',
  kind: 'extension',
  description: 'The AI bridge, an MCP server inside the bot ' +
    'process exposing the NanoResult API layer as tools.',
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
