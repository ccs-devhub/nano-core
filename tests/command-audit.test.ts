import { SlashCommandBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { auditCommands } from '@/misc/utility/command-sync.js';
import type { NanoCommand } from '@/types/nano-module.js';

const PING: NanoCommand = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong!'),
  execute: async (): Promise<void> => {
    return;
  },
};

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockFetch(
  routes: [string, unknown][]
): typeof fetch {
  return (async (url: string): Promise<Response> => {
    for (const [_fragment, _body] of routes) {
      if (url.includes(_fragment)) {
        return jsonResponse(_body);
      }
    }
    return jsonResponse([], 404);
  }) as unknown as typeof fetch;
}

describe('auditCommands', (): void => {
  it('reports an in-sync guild scope with a clean global scope',
    async (): Promise<void> => {
      const RESULT = await auditCommands([PING], {
        token: 't',
        client_id: 'cid',
        guild_id: 'g1',
        fetch_fn: mockFetch([
          ['/guilds/g1/commands', [PING.data.toJSON()]],
          ['/applications/cid/commands', []],
        ]),
      });

      expect(RESULT.ok).toBe(true);

      if (RESULT.ok) {
        expect(RESULT.data.scope).toBe('guild');
        expect(RESULT.data.in_sync).toBe(true);
        expect(RESULT.data.missing).toEqual([]);
        expect(RESULT.data.extra).toEqual([]);
        expect(RESULT.data.stale_global).toEqual([]);
      }
    });

  it('flags missing guild commands and stale global leftovers',
    async (): Promise<void> => {
      const RESULT = await auditCommands([PING], {
        token: 't',
        client_id: 'cid',
        guild_id: 'g1',
        fetch_fn: mockFetch([
          ['/guilds/g1/commands', []],
          ['/applications/cid/commands', [
            { name: 'ping', description: 'old', type: 1 },
          ]],
        ]),
      });

      expect(RESULT.ok).toBe(true);

      if (RESULT.ok) {
        expect(RESULT.data.in_sync).toBe(false);
        expect(RESULT.data.missing).toEqual(['ping']);
        expect(RESULT.data.stale_global).toEqual(['ping']);
      }
    });

  it('audits the global scope when no guild is configured',
    async (): Promise<void> => {
      const RESULT = await auditCommands([PING], {
        token: 't',
        client_id: 'cid',
        fetch_fn: mockFetch([
          ['/applications/cid/commands', [PING.data.toJSON()]],
        ]),
      });

      expect(RESULT.ok).toBe(true);

      if (RESULT.ok) {
        expect(RESULT.data.scope).toBe('global');
        expect(RESULT.data.in_sync).toBe(true);
        expect(RESULT.data.stale_global).toEqual([]);
      }
    });

  it('surfaces HTTP failures as NanoResult errors',
    async (): Promise<void> => {
      const RESULT = await auditCommands([PING], {
        token: 'bad',
        client_id: 'cid',
        guild_id: 'g1',
        fetch_fn: (async (): Promise<Response> => {
          return jsonResponse({}, 401);
        }) as unknown as typeof fetch,
      });

      expect(RESULT.ok).toBe(false);

      if (!RESULT.ok) {
        expect(RESULT.error).toContain('401');
      }
    });
});
