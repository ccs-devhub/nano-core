import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DoctorCheck } from '@/services/doctor.js';
import { runDoctor } from '@/services/doctor.js';

function checkByName(
  checks: DoctorCheck[],
  name: string
): DoctorCheck | undefined {
  return checks.find((check: DoctorCheck): boolean => {
    return check.name === name;
  });
}

describe('runDoctor', (): void => {
  it('reports missing secrets and default config honestly', async ():
  Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-doctor-'));
    const CHECKS = await runDoctor({
      root: ROOT,
      env: {},
      skip_network: true,
    });

    expect(checkByName(CHECKS, 'node')?.ok).toBe(true);
    expect(checkByName(CHECKS, 'config')?.ok).toBe(true);
    expect(checkByName(CHECKS, 'secrets')?.ok).toBe(false);
    expect(checkByName(CHECKS, 'secrets')?.detail)
      .toContain('DISCORD_TOKEN');
    expect(checkByName(CHECKS, 'database')?.ok).toBe(true);
    expect(checkByName(CHECKS, 'modules')?.ok).toBe(true);
  });

  it('flags an invalid config file', async (): Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-doctor-'));
    writeFileSync(join(ROOT, 'nano.config.json'), '{ "intents": 42 }');

    const CHECKS = await runDoctor({
      root: ROOT,
      env: {},
      skip_network: true,
    });

    expect(checkByName(CHECKS, 'config')?.ok).toBe(false);
  });

  it('validates the token against the Discord API', async ():
  Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-doctor-'));
    const FETCH = (async (url: string): Promise<Response> => {
      if (url.includes('users/@me')) {
        return new Response(JSON.stringify({ username: 'test-bot' }));
      }
      return new Response(JSON.stringify({
        store_version: 1,
        modules: [],
      }));
    }) as unknown as typeof fetch;

    const CHECKS = await runDoctor({
      root: ROOT,
      env: { DISCORD_TOKEN: 'token', CLIENT_ID: 'cid' },
      fetch_fn: FETCH,
    });

    expect(checkByName(CHECKS, 'secrets')?.ok).toBe(true);
    expect(checkByName(CHECKS, 'discord-api')?.ok).toBe(true);
    expect(checkByName(CHECKS, 'discord-api')?.detail)
      .toContain('test-bot');
    expect(checkByName(CHECKS, 'store')?.ok).toBe(true);
  });

  it('flags an unsynced dev guild and stale global commands', async ():
  Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-doctor-'));
    writeFileSync(
      join(ROOT, 'nano.config.json'),
      JSON.stringify({ bot: { name: 'test', dev_guild_id: '123' } })
    );

    const FETCH = (async (url: string): Promise<Response> => {
      if (url.includes('users/@me')) {
        return new Response(JSON.stringify({ username: 'test-bot' }));
      }

      if (url.includes('/guilds/123/commands')) {
        return new Response('[]');
      }

      if (url.includes('/applications/cid/commands')) {
        return new Response(JSON.stringify([
          { name: 'ghost', description: 'left over', type: 1 },
        ]));
      }
      return new Response(JSON.stringify({
        store_version: 1,
        modules: [],
      }));
    }) as unknown as typeof fetch;

    const CHECKS = await runDoctor({
      root: ROOT,
      env: { DISCORD_TOKEN: 'token', CLIENT_ID: 'cid' },
      fetch_fn: FETCH,
    });
    const COMMANDS = checkByName(CHECKS, 'commands');
    const GLOBAL_SCOPE = checkByName(CHECKS, 'global-scope');

    expect(COMMANDS?.ok).toBe(false);
    expect(COMMANDS?.detail).toContain('missing');
    expect(COMMANDS?.detail).toContain('ping');
    expect(GLOBAL_SCOPE?.ok).toBe(false);
    expect(GLOBAL_SCOPE?.detail).toContain('ghost');
  });

  it('verifies privileged intents against the portal flags', async ():
  Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-doctor-'));
    writeFileSync(
      join(ROOT, 'nano.config.json'),
      JSON.stringify({ intents: ['Guilds', 'GuildMembers'] })
    );

    const FETCH = (async (url: string): Promise<Response> => {
      if (url.includes('applications/@me')) {
        return new Response(JSON.stringify({ flags: 0 }));
      }

      if (url.includes('users/@me')) {
        return new Response(JSON.stringify({ username: 'test-bot' }));
      }

      if (url.includes('/applications/cid/commands')) {
        return new Response('[]');
      }
      return new Response(JSON.stringify({
        store_version: 1,
        modules: [],
      }));
    }) as unknown as typeof fetch;

    const CHECKS = await runDoctor({
      root: ROOT,
      env: { DISCORD_TOKEN: 'token', CLIENT_ID: 'cid' },
      fetch_fn: FETCH,
    });
    const INTENTS = checkByName(CHECKS, 'intents');

    expect(INTENTS?.ok).toBe(false);
    expect(INTENTS?.detail).toContain('OFF in the developer portal');
    expect(INTENTS?.detail).toContain('GuildMembers');
  });

  it('reports a rejected token', async (): Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-doctor-'));
    const FETCH = (async (url: string): Promise<Response> => {
      if (url.includes('users/@me')) {
        return new Response('{}', { status: 401 });
      }
      return new Response(JSON.stringify({
        store_version: 1,
        modules: [],
      }));
    }) as unknown as typeof fetch;

    const CHECKS = await runDoctor({
      root: ROOT,
      env: { DISCORD_TOKEN: 'bad', CLIENT_ID: 'cid' },
      fetch_fn: FETCH,
    });

    expect(checkByName(CHECKS, 'discord-api')?.ok).toBe(false);
    expect(checkByName(CHECKS, 'discord-api')?.detail).toContain('401');
  });
});
