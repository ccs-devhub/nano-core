import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';

import type { McpGates } from './tools.js';
import { registerNanoTools } from './tools.js';

import type { Client, NanoHealthReport } from '@ccs-devhub/nano-core';
import {
  getModuleConfig,
  getModuleLogger,
  NANO_VERSION
} from '@ccs-devhub/nano-core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  StreamableHTTPServerTransport
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * The MCP endpoint: a loopback-only HTTP server inside the bot
 * process. Stateless Streamable HTTP - every POST gets a fresh
 * transport and McpServer pair, which is the SDK-recommended way to
 * avoid request-id collisions without session state. Bearer auth is
 * mandatory; the token never lives in JSON config.
 */
interface McpConfig {
  port?: number;
  allow_write?: boolean;
  allow_moderation?: boolean;
}

export interface McpStatus {
  listening: boolean;
  port: number;
  detail: string;
  tool_count: number;
  gates: McpGates;
}

const DEFAULT_PORT = 3777;
const BIND_HOST = '127.0.0.1';
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const JSONRPC_AUTH_ERROR = -32001;
const JSONRPC_INVALID_REQUEST = -32600;

let http_server: Server | null = null;
let listening = false;
let status_detail = 'not started';
let tool_count = 0;
let active_port = DEFAULT_PORT;
let active_gates: McpGates = {
  allow_write: false,
  allow_moderation: false,
};

function rpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  }));
}

function buildServer(bot: Client, gates: McpGates): McpServer {
  const SERVER = new McpServer({
    name: 'nano-core',
    version: NANO_VERSION,
  });
  registerNanoTools(SERVER, bot, gates);
  return SERVER;
}

async function handlePost(
  bot: Client,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const SERVER = buildServer(bot, active_gates);
  const TRANSPORT = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', (): void => {
    void TRANSPORT.close();
    void SERVER.close();
  });
  await SERVER.connect(TRANSPORT);
  await TRANSPORT.handleRequest(req, res);
}

/** Start the MCP endpoint. Never throws; failures land in health. */
export async function startMcpServer(
  bot: Client,
  overrides: McpConfig = {}
): Promise<void> {
  const LOGGER = getModuleLogger('mcp');
  const CONFIG: McpConfig = {
    ...getModuleConfig<McpConfig>('mcp') ?? {},
    ...overrides,
  };
  const TOKEN = process.env.NANO_MCP_TOKEN;

  active_port = CONFIG.port ?? DEFAULT_PORT;
  active_gates = {
    allow_write: CONFIG.allow_write === true,
    allow_moderation: CONFIG.allow_moderation === true,
  };

  if (!TOKEN) {
    status_detail = 'NANO_MCP_TOKEN is not set - MCP endpoint ' +
      'disabled. Add it to .env (openssl rand -hex 32).';
    LOGGER.warn(status_detail);
    return;
  }

  tool_count = registerNanoTools(
    new McpServer({ name: 'nano-core-probe', version: NANO_VERSION }),
    bot,
    active_gates
  );

  const HANDLER = (req: IncomingMessage, res: ServerResponse): void => {
    const PATH = (req.url ?? '').split('?')[0];

    if (PATH !== '/mcp') {
      rpcError(res, HTTP_NOT_FOUND, JSONRPC_INVALID_REQUEST, 'Not found');
      return;
    }

    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      rpcError(
        res, HTTP_UNAUTHORIZED, JSONRPC_AUTH_ERROR, 'Unauthorized'
      );
      return;
    }

    if (req.method !== 'POST') {
      rpcError(
        res,
        HTTP_METHOD_NOT_ALLOWED,
        JSONRPC_INVALID_REQUEST,
        'Method not allowed - this endpoint is stateless POST only'
      );
      return;
    }

    handlePost(bot, req, res).catch((error: unknown): void => {
      LOGGER.error(`MCP request failed: ${String(error)}`);

      if (!res.headersSent) {
        rpcError(
          res, HTTP_NOT_FOUND, JSONRPC_INVALID_REQUEST, String(error)
        );
      }
    });
  };

  await new Promise<void>((resolve: () => void): void => {
    const SERVER = createServer(HANDLER);
    SERVER.once('error', (error: NodeJS.ErrnoException): void => {
      status_detail = error.code === 'EADDRINUSE'
        ? `Port ${active_port} is already in use - set a different ` +
          'port in module_config.mcp.port.'
        : `MCP server failed to start: ${String(error)}`;
      LOGGER.error(status_detail);
      http_server = null;
      resolve();
    });
    SERVER.listen(active_port, BIND_HOST, (): void => {
      const ADDRESS = SERVER.address();

      if (ADDRESS && typeof ADDRESS === 'object') {
        active_port = ADDRESS.port;
      }

      http_server = SERVER;
      listening = true;
      status_detail = `listening on http://${BIND_HOST}:${active_port}/mcp`;
      LOGGER.info(
        `MCP endpoint ${status_detail} (${tool_count} tools, ` +
        `write=${active_gates.allow_write}, ` +
        `moderation=${active_gates.allow_moderation})`
      );
      resolve();
    });
  });

  bot.services.lifecycle.addShutdownTask(stopMcpServer);
}

/** Close the endpoint; safe to call repeatedly. */
export async function stopMcpServer(): Promise<void> {
  if (!http_server) {
    return;
  }

  const SERVER = http_server;
  http_server = null;
  listening = false;
  status_detail = 'stopped';
  await new Promise<void>((resolve: () => void): void => {
    SERVER.close((): void => {
      resolve();
    });
  });
}

export function mcpStatus(): McpStatus {
  return {
    listening,
    port: active_port,
    detail: status_detail,
    tool_count,
    gates: active_gates,
  };
}

export function mcpHealth(): NanoHealthReport {
  if (listening) {
    return { status: 'healthy', details: status_detail };
  }
  return { status: 'degraded', details: status_detail };
}
