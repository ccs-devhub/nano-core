import type { Client } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NANO_VERSION } from '@/constants/nano.js';

import {
  mcpHealth,
  mcpStatus,
  startMcpServer,
  stopMcpServer
} from '@modules/mcp/server.js';

const TEST_TOKEN = 'test-mcp-token';
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const READ_TOOLS = 11;
const ALL_TOOLS = 31;

function fakeBot(ready: boolean = true): Client {
  return {
    isReady: (): boolean => {
      return ready;
    },
    ws: { ping: 42 },
    uptime: 1234,
    guilds: { cache: { size: 3 } },
    nano: {
      healthAll: async (): Promise<unknown[]> => {
        return [{ name: 'mcp', status: 'healthy' }];
      },
    },
    services: {
      scheduler: {
        listJobs: (): unknown[] => {
          return [];
        },
      },
      lifecycle: {
        addShutdownTask: (): void => {},
      },
    },
  } as unknown as Client;
}

interface RpcResponse {
  status: number;
  body: {
    result?: {
      serverInfo?: { name: string; version: string };
      tools?: { name: string }[];
      content?: { type: string; text: string }[];
      isError?: boolean;
    };
    error?: { code: number; message: string };
  };
}

async function rpc(
  method: string,
  params: Record<string, unknown>,
  options: { token?: string } = {}
): Promise<RpcResponse> {
  const STATUS = mcpStatus();
  const RESPONSE = await fetch(
    `http://127.0.0.1:${STATUS.port}/mcp`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${options.token ?? TEST_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    }
  );
  return {
    status: RESPONSE.status,
    body: await RESPONSE.json() as RpcResponse['body'],
  };
}

describe('mcp module server', (): void => {
  beforeEach((): void => {
    process.env.NANO_MCP_TOKEN = TEST_TOKEN;
  });

  afterEach(async (): Promise<void> => {
    await stopMcpServer();
    delete process.env.NANO_MCP_TOKEN;
  });

  it('stays down and degraded without NANO_MCP_TOKEN', async ():
  Promise<void> => {
    delete process.env.NANO_MCP_TOKEN;
    await startMcpServer(fakeBot(), { port: 0 });

    expect(mcpStatus().listening).toBe(false);
    expect(mcpHealth().status).toBe('degraded');
    expect(mcpHealth().details).toContain('NANO_MCP_TOKEN');
  });

  it('rejects requests without the bearer token', async ():
  Promise<void> => {
    await startMcpServer(fakeBot(), { port: 0 });

    const RESULT = await rpc('tools/list', {}, { token: 'wrong' });

    expect(RESULT.status).toBe(HTTP_UNAUTHORIZED);
    expect(RESULT.body.error?.message).toBe('Unauthorized');
  });

  it('rejects unknown paths and non-POST methods', async ():
  Promise<void> => {
    await startMcpServer(fakeBot(), { port: 0 });
    const STATUS = mcpStatus();

    const BAD_PATH = await fetch(
      `http://127.0.0.1:${STATUS.port}/nope`,
      { headers: { Authorization: `Bearer ${TEST_TOKEN}` } }
    );
    expect(BAD_PATH.status).toBe(HTTP_NOT_FOUND);

    const GET = await fetch(
      `http://127.0.0.1:${STATUS.port}/mcp`,
      { headers: { Authorization: `Bearer ${TEST_TOKEN}` } }
    );
    expect(GET.status).toBe(HTTP_METHOD_NOT_ALLOWED);
  });

  it('answers the initialize handshake', async (): Promise<void> => {
    await startMcpServer(fakeBot(), { port: 0 });

    const RESULT = await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '0.0.0' },
    });

    expect(RESULT.status).toBe(HTTP_OK);
    expect(RESULT.body.result?.serverInfo?.name).toBe('nano-core');
    expect(RESULT.body.result?.serverInfo?.version).toBe(NANO_VERSION);
  });

  it('lists only read tools when gates are off', async ():
  Promise<void> => {
    await startMcpServer(fakeBot(), { port: 0 });

    const RESULT = await rpc('tools/list', {});
    const NAMES = (RESULT.body.result?.tools ?? [])
      .map((tool: { name: string }): string => {
        return tool.name;
      });

    expect(NAMES).toHaveLength(READ_TOOLS);
    expect(NAMES).toContain('bot_vitals');
    expect(NAMES).toContain('guild_snapshot');
    expect(NAMES).not.toContain('send_message');
    expect(NAMES).not.toContain('kick_member');
    expect(mcpStatus().tool_count).toBe(READ_TOOLS);
  });

  it('registers write and moderation tools when gated on', async ():
  Promise<void> => {
    await startMcpServer(fakeBot(), {
      port: 0,
      allow_write: true,
      allow_moderation: true,
    });

    const RESULT = await rpc('tools/list', {});
    const NAMES = (RESULT.body.result?.tools ?? [])
      .map((tool: { name: string }): string => {
        return tool.name;
      });

    expect(NAMES).toHaveLength(ALL_TOOLS);
    expect(NAMES).toContain('send_message');
    expect(NAMES).toContain('kick_member');
  });

  it('serves bot_vitals with the NanoResult envelope', async ():
  Promise<void> => {
    await startMcpServer(fakeBot(), { port: 0 });

    const RESULT = await rpc('tools/call', {
      name: 'bot_vitals',
      arguments: {},
    });
    const TEXT = RESULT.body.result?.content?.[0]?.text ?? '{}';
    const VITALS = JSON.parse(TEXT) as {
      version: string;
      ready: boolean;
      guild_count: number;
    };

    expect(RESULT.body.result?.isError).toBeFalsy();
    expect(VITALS.version).toBe(NANO_VERSION);
    expect(VITALS.ready).toBe(true);
    expect(VITALS.guild_count).toBe(3);
  });

  it('guards tools while the gateway is not ready', async ():
  Promise<void> => {
    await startMcpServer(fakeBot(false), { port: 0 });

    const RESULT = await rpc('tools/call', {
      name: 'list_guilds',
      arguments: {},
    });

    expect(RESULT.body.result?.isError).toBe(true);
    expect(RESULT.body.result?.content?.[0]?.text)
      .toContain('Bot not ready');
  });
});
