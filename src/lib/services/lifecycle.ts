import type { Client } from 'discord.js';
import { Events, RESTEvents } from 'discord.js';

import type { ModuleHealth, ModuleRegistry } from
  '@/registry/module-registry.js';
import { getLogger } from '@/services/logger.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * Bootstrap and client lifecycle: stable event names over discord.js
 * internals (which rename across major versions), graceful shutdown,
 * login with retry, and the health report.
 */
export type NanoLifecycleEvent =
  | 'ready'
  | 'error'
  | 'warn'
  | 'invalidated'
  | 'shard-disconnect'
  | 'shard-reconnecting'
  | 'shard-resume'
  | 'rate-limited';

export interface HealthReport {
  status: 'online' | 'offline';
  ws_ping_ms: number;
  uptime_ms: number;
  guild_count: number;
  modules: ModuleHealth[];
}

export type LifecycleListener = (...args: unknown[]) => void;

const LOGIN_RETRIES = 2;
const LOGIN_RETRY_DELAY_MS = 5000;

export class LifecycleManager {
  private bot: Client;
  private handlers: Map<NanoLifecycleEvent, Set<LifecycleListener>> =
    new Map();
  private shutdown_tasks: (() => Promise<void> | void)[] = [];
  private signals_installed: boolean = false;
  private client_events_bound: boolean = false;

  constructor(bot: Client) {
    this.bot = bot;
  }

  /** Subscribe to a stable lifecycle event. Returns an unsubscriber. */
  onLifecycle(
    event: NanoLifecycleEvent,
    fn: LifecycleListener
  ): () => void {
    const SET = this.handlers.get(event) ?? new Set();
    SET.add(fn);
    this.handlers.set(event, SET);
    return (): void => {
      SET.delete(fn);
    };
  }

  /** Map discord.js client/rest events onto the stable names. Once. */
  bindClientEvents(): void {
    if (this.client_events_bound) {
      return;
    }
    this.client_events_bound = true;

    this.bot.once(Events.ClientReady, (): void => {
      this.emit('ready');
    });
    this.bot.on(Events.Error, (error: Error): void => {
      getLogger().error({ err: error }, 'Client error');
      this.emit('error', error);
    });
    this.bot.on(Events.Warn, (message: string): void => {
      getLogger().warn(message);
      this.emit('warn', message);
    });
    this.bot.on(Events.Invalidated, (): void => {
      getLogger().fatal(
        'Session invalidated — a full process restart is required ' +
        '(never re-login on the same client).'
      );
      this.emit('invalidated');
    });
    this.bot.on(Events.ShardDisconnect, (): void => {
      this.emit('shard-disconnect');
    });
    this.bot.on(Events.ShardReconnecting, (): void => {
      this.emit('shard-reconnecting');
    });
    this.bot.on(Events.ShardResume, (): void => {
      this.emit('shard-resume');
    });
    this.bot.rest.on(RESTEvents.RateLimited, (info: unknown): void => {
      getLogger().warn({ rate_limit: info }, 'REST rate limited');
      this.emit('rate-limited', info);
    });
  }

  /** Register work to run during graceful shutdown (LIFO order). */
  addShutdownTask(fn: () => Promise<void> | void): void {
    this.shutdown_tasks.push(fn);
  }

  /** Install SIGINT/SIGTERM handlers exactly once. */
  installSignalHandlers(): void {
    if (this.signals_installed) {
      return;
    }
    this.signals_installed = true;

    const HANDLER = (signal: string): void => {
      getLogger().info({ signal }, 'Shutting down');
      this.shutdown()
        .then((): void => {
          process.exit(0);
        })
        .catch((): void => {
          process.exit(1);
        });
    };
    process.once('SIGINT', (): void => {
      HANDLER('SIGINT');
    });
    process.once('SIGTERM', (): void => {
      HANDLER('SIGTERM');
    });
  }

  /** Login with bounded retries. */
  async login(token: string): Promise<NanoResult<string>> {
    let last_error: unknown = null;

    for (let attempt = 0; attempt <= LOGIN_RETRIES; attempt += 1) {
      try {
        await this.bot.login(token);
        return ok(this.bot.user?.tag ?? 'logged-in');
      } catch (error: unknown) {
        last_error = error;
        getLogger().warn(
          { attempt, err: error },
          'Login attempt failed'
        );
        await sleep(LOGIN_RETRY_DELAY_MS);
      }
    }
    return err(last_error);
  }

  /** Graceful shutdown: run tasks LIFO, then destroy the client. */
  async shutdown(): Promise<void> {
    for (const _task of [...this.shutdown_tasks].reverse()) {
      try {
        await _task();
      } catch (error: unknown) {
        getLogger().warn({ err: error }, 'Shutdown task failed');
      }
    }
    await this.bot.destroy();
  }

  /** The live health snapshot (bot + every module). */
  async getHealth(registry: ModuleRegistry): Promise<HealthReport> {
    return {
      status: this.bot.isReady() ? 'online' : 'offline',
      ws_ping_ms: this.bot.ws.ping,
      uptime_ms: this.bot.uptime ?? 0,
      guild_count: this.bot.guilds.cache.size,
      modules: await registry.healthAll(),
    };
  }

  private emit(event: NanoLifecycleEvent, ...args: unknown[]): void {
    for (const _fn of this.handlers.get(event) ?? []) {
      try {
        _fn(...args);
      } catch (error: unknown) {
        getLogger().warn(
          { err: error, event },
          'Lifecycle listener failed'
        );
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
}
