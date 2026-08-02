import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IntervalHistogram } from 'node:perf_hooks';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';

import type { Client } from 'discord.js';

import type { ResolvedSharding } from
  '@/misc/utility/scale-options.js';
import type { DatabaseService } from '@/services/database.js';
import { RUNTIME_KEY_LAST_ALIVE } from '@/services/database.js';
import { getLogger } from '@/services/logger.js';
import type { NanoScheduler } from '@/services/scheduler.js';

/**
 * Process self-measurement (P8 V2, PF15): the 14-field snapshot every
 * sink reads — the heartbeat pino line, the atomic heartbeat file
 * whose mtime is the liveness signal, and pull surfaces (synapse,
 * mcp) as READERS of the same data. Vendor-neutral by law: no
 * aggregation, no alerting, no thresholds — those live in /srv/ops.
 */
export interface GatewayVitals {
  ready: boolean;
  ws_ping_ms: number;
  invalidated_count: number;
}

export interface NanoVitals {
  ts: number;
  bot: string;
  version: string;
  uptime_s: number;
  rss_mb: number;
  heap_used_mb: number;
  heap_limit_mb: number;
  loop_p99_ms: number;
  gateway: GatewayVitals;
  /** Shard assignment (S1 seam); null while unsharded. */
  shard: { id: number; count: number } | null;
  guild_count: number;
  rest_429s: number;
  db: { sqlite_mb: number; wal_mb: number };
  scheduler: { jobs: number; overruns: number };
  modules: {
    healthy: number;
    degraded: number;
    down: number;
    metrics: Record<string, Record<string, number>>;
  };
}

export interface VitalsSources {
  bot: Client;
  bot_name: string;
  version: string;
  database?: DatabaseService | null;
  scheduler?: NanoScheduler;
  sharding?: ResolvedSharding | null;
}

export interface VitalsOptions {
  /** Reset the per-interval counters (heartbeat semantics). */
  reset?: boolean;
}

const LOOP_RESOLUTION_MS = 20;
const LOOP_P99 = 99;
const NS_PER_MS = 1e6;
const MS_PER_SECOND = 1000;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
const ROUND_SCALE = 10;
const HEARTBEAT_DIR = '.nano';
const HEARTBEAT_FILE = 'heartbeat.json';

export class VitalsService {
  private sources: VitalsSources;
  private loop_monitor: IntervalHistogram;
  private rest_429s: number = 0;
  private invalidated_count: number = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(sources: VitalsSources) {
    this.sources = sources;
    this.loop_monitor = monitorEventLoopDelay({
      resolution: LOOP_RESOLUTION_MS,
    });
    this.loop_monitor.enable();
    sources.bot.rest.on('rateLimited', (): void => {
      this.rest_429s += 1;
    });
    sources.bot.on('invalidated', (): void => {
      this.invalidated_count += 1;
    });
  }

  /** The 14-field snapshot. Never throws; gauges degrade to zero. */
  async getVitals(options: VitalsOptions = {}): Promise<NanoVitals> {
    /* The module rollup awaits — do it FIRST, so the per-interval
       counters are read and reset with NO await in between and a
       429 landing during the rollup is never silently zeroed. */
    const MODULES = await this.moduleRollup();
    const MEMORY = process.memoryUsage();
    const HEAP = getHeapStatistics();
    const BOT = this.sources.bot;
    const DB_PATH = this.sources.database?.filePath();
    const STATS = this.sources.scheduler?.stats() ??
      { jobs: 0, overruns: 0 };
    const LOOP_P99_MS = roundOne(
      this.loop_monitor.percentile(LOOP_P99) / NS_PER_MS
    );
    const REST_429S = this.rest_429s;

    if (options.reset) {
      this.loop_monitor.reset();
      this.rest_429s = 0;
    }

    return {
      ts: Date.now(),
      bot: this.sources.bot_name,
      version: this.sources.version,
      uptime_s: Math.round(process.uptime()),
      rss_mb: toMb(MEMORY.rss),
      heap_used_mb: toMb(MEMORY.heapUsed),
      heap_limit_mb: toMb(HEAP.heap_size_limit),
      loop_p99_ms: LOOP_P99_MS,
      gateway: {
        ready: BOT.isReady(),
        ws_ping_ms: BOT.ws.ping,
        invalidated_count: this.invalidated_count,
      },
      shard: this.sources.sharding
        ? {
          id: this.sources.sharding.shard_id,
          count: this.sources.sharding.shard_count,
        }
        : null,
      guild_count: BOT.guilds.cache.size,
      rest_429s: REST_429S,
      db: {
        sqlite_mb: DB_PATH ? fileMb(DB_PATH) : 0,
        wal_mb: DB_PATH ? fileMb(`${DB_PATH}-wal`) : 0,
      },
      scheduler: STATS,
      modules: MODULES,
    };
  }

  /**
   * Start the heartbeat: one structured pino line and one atomic
   * file write per interval. The timer is unref'd so it never keeps
   * a tokenless process alive.
   */
  startHeartbeat(
    interval_s: number,
    root: string = process.cwd()
  ): void {
    if (this.timer || interval_s <= 0) {
      return;
    }

    this.timer = setInterval((): void => {
      void this.beat(root);
    }, interval_s * MS_PER_SECOND);
    this.timer.unref();
    /* Beat once immediately so the heartbeat file exists long
       before the container healthcheck first looks for it. */
    void this.beat(root);
  }

  stopHeartbeat(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One heartbeat emission. Failures log and never propagate. */
  async beat(root: string = process.cwd()): Promise<void> {
    try {
      const VITALS = await this.getVitals({ reset: true });
      getLogger().info({ evt: 'heartbeat', ...VITALS }, 'heartbeat');

      const DIR = join(root, HEARTBEAT_DIR);
      mkdirSync(DIR, { recursive: true });
      const TARGET = join(DIR, HEARTBEAT_FILE);
      const TEMP = `${TARGET}.tmp`;
      writeFileSync(TEMP, JSON.stringify(VITALS));
      renameSync(TEMP, TARGET);
      /* One timer, two sinks: the same beat stamps the downtime
         ledger the reconcile runner reads at the next boot. ONLY
         while the gateway is ready — stamping through a disconnect
         would shrink the next catch-up window to one interval and
         hide the real outage. */
      if (VITALS.gateway.ready) {
        this.sources.database?.setRuntimeValue(
          RUNTIME_KEY_LAST_ALIVE,
          String(VITALS.ts)
        );
      }
    } catch (error: unknown) {
      getLogger().warn({ err: error }, 'Heartbeat emission failed');
    }
  }

  private async moduleRollup(): Promise<NanoVitals['modules']> {
    const ROLLUP: NanoVitals['modules'] = {
      healthy: 0,
      degraded: 0,
      down: 0,
      metrics: {},
    };
    const REGISTRY = this.sources.bot.nano;

    if (!REGISTRY) {
      return ROLLUP;
    }

    for (const _report of await REGISTRY.healthAll()) {
      if (_report.status === 'healthy') {
        ROLLUP.healthy += 1;
      } else if (_report.status === 'degraded') {
        ROLLUP.degraded += 1;
      } else if (_report.status === 'down') {
        ROLLUP.down += 1;
      }

      if (_report.metrics) {
        ROLLUP.metrics[_report.name] = _report.metrics;
      }
    }
    return ROLLUP;
  }
}

function toMb(bytes: number): number {
  return roundOne(bytes / BYTES_PER_MB);
}

function roundOne(value: number): number {
  return Math.round(value * ROUND_SCALE) / ROUND_SCALE;
}

function fileMb(path: string): number {
  try {
    return toMb(statSync(path).size);
  } catch {
    return 0;
  }
}
