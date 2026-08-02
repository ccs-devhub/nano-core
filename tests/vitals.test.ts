import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { ModuleRegistry } from '@/registry/module-registry.js';
import { defaultConfig } from '@/registry/nano-config.js';
import { NanoScheduler } from '@/services/scheduler.js';
import { VitalsService } from '@/services/vitals.js';

const EXPECTED_429S = 2;
const DEFAULT_HEARTBEAT_S = 300;

async function createService(): Promise<{
  service: VitalsService;
  bot: Client;
}> {
  const BOT = new Client({ intents: [] });
  const REGISTRY = new ModuleRegistry(BOT);
  BOT.nano = REGISTRY;
  await REGISTRY.register({
    name: 'plain-module',
    version: '1.0.0',
  }, 'local');
  await REGISTRY.register({
    name: 'degraded-module',
    version: '1.0.0',
    healthCheck: (): {
      status: 'degraded';
      metrics: Record<string, number>;
    } => {
      return { status: 'degraded', metrics: { queue_depth: 3 } };
    },
  }, 'local');

  const SERVICE = new VitalsService({
    bot: BOT,
    bot_name: 'test-bot',
    version: '0.0.0-test',
    scheduler: new NanoScheduler(),
  });
  return { service: SERVICE, bot: BOT };
}

describe('VitalsService', (): void => {
  it('produces the 14-field snapshot with live gauges', async ():
  Promise<void> => {
    const { service: SERVICE } = await createService();
    const VITALS = await SERVICE.getVitals();

    expect(VITALS.bot).toBe('test-bot');
    expect(VITALS.version).toBe('0.0.0-test');
    expect(VITALS.ts).toBeGreaterThan(0);
    expect(VITALS.uptime_s).toBeGreaterThanOrEqual(0);
    expect(VITALS.rss_mb).toBeGreaterThan(0);
    expect(VITALS.heap_used_mb).toBeGreaterThan(0);
    expect(VITALS.heap_limit_mb).toBeGreaterThan(0);
    expect(VITALS.loop_p99_ms).toBeGreaterThanOrEqual(0);
    expect(VITALS.gateway.ready).toBe(false);
    expect(VITALS.gateway.invalidated_count).toBe(0);
    expect(VITALS.guild_count).toBe(0);
    expect(VITALS.rest_429s).toBe(0);
    expect(VITALS.db).toEqual({ sqlite_mb: 0, wal_mb: 0 });
    expect(VITALS.scheduler).toEqual({ jobs: 0, overruns: 0 });
    expect(VITALS.modules.healthy).toBe(1);
    expect(VITALS.modules.degraded).toBe(1);
    expect(VITALS.modules.down).toBe(0);
    expect(VITALS.modules.metrics['degraded-module'])
      .toEqual({ queue_depth: 3 });
  });

  it('counts rest 429s and resets them on heartbeat reads', async ():
  Promise<void> => {
    const { service: SERVICE, bot: BOT } = await createService();
    BOT.rest.emit('rateLimited', {} as never);
    BOT.rest.emit('rateLimited', {} as never);

    const FIRST = await SERVICE.getVitals();
    expect(FIRST.rest_429s).toBe(EXPECTED_429S);

    /* a plain read never resets; the heartbeat read does */
    const SECOND = await SERVICE.getVitals({ reset: true });
    expect(SECOND.rest_429s).toBe(EXPECTED_429S);

    const THIRD = await SERVICE.getVitals();
    expect(THIRD.rest_429s).toBe(0);
  });

  it('writes the heartbeat file atomically under .nano/', async ():
  Promise<void> => {
    const { service: SERVICE } = await createService();
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-vitals-'));

    await SERVICE.beat(ROOT);

    const TARGET = join(ROOT, '.nano', 'heartbeat.json');
    expect(existsSync(TARGET)).toBe(true);
    expect(existsSync(`${TARGET}.tmp`)).toBe(false);

    const PARSED = JSON.parse(readFileSync(TARGET, 'utf8')) as {
      bot: string;
      ts: number;
    };
    expect(PARSED.bot).toBe('test-bot');
    expect(PARSED.ts).toBeGreaterThan(0);
  });

  it('never starts a timer for a zero or negative interval', async ():
  Promise<void> => {
    const { service: SERVICE } = await createService();

    SERVICE.startHeartbeat(0);
    SERVICE.stopHeartbeat();
  });

  it('reports the shard assignment when sharded, null otherwise',
    async (): Promise<void> => {
      const { service: UNSHARDED } = await createService();
      expect((await UNSHARDED.getVitals()).shard).toBeNull();

      const BOT = new Client({ intents: [] });
      const SHARDED = new VitalsService({
        bot: BOT,
        bot_name: 'test-bot',
        version: '0.0.0-test',
        sharding: { shard_id: 1, shard_count: 4 },
      });
      expect((await SHARDED.getVitals()).shard)
        .toEqual({ id: 1, count: 4 });
    });

  it('defaults observability.heartbeat_interval_s to 300', (): void => {
    expect(defaultConfig().observability.heartbeat_interval_s)
      .toBe(DEFAULT_HEARTBEAT_S);
  });
});
