import type { Client } from 'discord.js';

import type { ModuleRegistry } from '@/registry/module-registry.js';
import type { DatabaseService } from '@/services/database.js';
import { RUNTIME_KEY_LAST_ALIVE } from '@/services/database.js';
import { getLogger } from '@/services/logger.js';
import type { NanoScheduler } from '@/services/scheduler.js';
import type {
  NanoReconcileTask,
  NanoTaskHandler,
  ReconcileContext,
  ReconcileReason,
  ReconcileReport
} from '@/types/nano-module.js';

/**
 * The RECONCILE CONNECTION: one catch-up pass per boot (plus enable
 * re-arms and an owner-gated manual trigger). Recovery is a STATE
 * DIFF against Discord-now, never an event replay. Boot is NEVER
 * blocked — the bot is live while catching up; every task is
 * failure-isolated and runs sequentially so a reconcile can never
 * look like a raid to Discord.
 */
export interface ReconcileRunResult {
  module_name: string;
  task_id: string;
  ok: boolean;
  report?: ReconcileReport;
  error?: string;
  duration_ms: number;
}

export interface ReconcileRunnerDeps {
  bot: Client;
  registry: ModuleRegistry;
  scheduler?: NanoScheduler;
  database?: DatabaseService | null;
  max_lookback_ms?: number;
}

export interface ReconcileRunOptions {
  /** Restrict the pass to one module (the enable re-arm path). */
  module_name?: string;
}

const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 3600000;
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_LOOKBACK_MS =
  DEFAULT_LOOKBACK_DAYS * HOURS_PER_DAY * MS_PER_HOUR;

export class ReconcileRunner {
  private deps: ReconcileRunnerDeps;
  private boot_done: boolean = false;
  /* Passes are SEQUENTIAL by law — a manual trigger during the boot
     pass queues behind it instead of racing the same tasks. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(deps: ReconcileRunnerDeps) {
    this.deps = deps;
  }

  /**
   * Run one pass. 'boot' is once-only per process and re-arms the
   * scheduler's persisted one-shots FIRST (PF6 — after login, so an
   * overdue one-shot never fires against a logged-out client).
   */
  async run(
    reason: ReconcileReason,
    options: ReconcileRunOptions = {}
  ): Promise<ReconcileRunResult[]> {
    const PASS = this.chain.then((): Promise<ReconcileRunResult[]> => {
      return this.runPass(reason, options);
    });
    this.chain = PASS.catch((): undefined => {
      return undefined;
    });
    return PASS;
  }

  private async runPass(
    reason: ReconcileReason,
    options: ReconcileRunOptions = {}
  ): Promise<ReconcileRunResult[]> {
    if (reason === 'boot') {
      if (this.boot_done) {
        return [];
      }

      this.boot_done = true;
      this.rearmPersistedJobs();
    } else if (reason === 'enable') {
      /* A boot-disabled module's persisted one-shots were retained
         (their handlers could not resolve at boot); now that it is
         enabled, re-arm them. Live jobs are skipped by the
         duplicate-key guard, so this only arms the dormant rows. */
      this.rearmPersistedJobs();
    }

    const CONTEXT = this.buildContext(reason);
    const RESULTS: ReconcileRunResult[] = [];

    for (const _entry of this.deps.registry.list()) {
      if (!_entry.enabled) {
        continue;
      }

      if (
        options.module_name &&
        _entry.module.name !== options.module_name
      ) {
        continue;
      }

      for (const _task of _entry.module.reconcile ?? []) {
        RESULTS.push(
          await this.runTask(_entry.module.name, _task, CONTEXT)
        );
      }
    }
    return RESULTS;
  }

  private rearmPersistedJobs(): void {
    if (!this.deps.scheduler) {
      return;
    }

    const REARMED = this.deps.scheduler.rearmPersistedJobs(
      (module_id: string, task_name: string):
      NanoTaskHandler | undefined => {
        return this.deps.registry.getTask(module_id, task_name);
      }
    );

    if (REARMED > 0) {
      getLogger().info(`Re-armed ${REARMED} persisted job(s)`);
    }
  }

  private buildContext(reason: ReconcileReason): ReconcileContext {
    const NOW = Date.now();
    const RAW = this.deps.database?.getRuntimeValue(
      RUNTIME_KEY_LAST_ALIVE
    ) ?? null;
    /* A corrupt OR empty ledger value must read as first_boot — an
       empty string would otherwise Number() to 0 and read as a
       decade-long outage clamped to the lookback. */
    const PARSED = RAW === null || RAW.trim() === ''
      ? Number.NaN
      : Number(RAW);
    const LAST_ALIVE = Number.isFinite(PARSED) ? PARSED : null;
    const LOOKBACK = this.deps.max_lookback_ms ?? DEFAULT_LOOKBACK_MS;
    /* Negative gaps (clock skew) clamp to 0; long outages clamp to
       the lookback bound — never an unbounded archaeology dig. */
    const DOWN_MS = LAST_ALIVE === null
      ? null
      : Math.min(Math.max(0, NOW - LAST_ALIVE), LOOKBACK);

    return {
      reason,
      downtime: {
        last_alive_at: LAST_ALIVE,
        down_ms: DOWN_MS,
        first_boot: LAST_ALIVE === null,
      },
      guild_ids: Array.from(this.deps.bot.guilds.cache.keys()),
    };
  }

  private async runTask(
    module_name: string,
    task: NanoReconcileTask,
    context: ReconcileContext
  ): Promise<ReconcileRunResult> {
    const STARTED_AT = Date.now();

    try {
      const RESULT = await task.run(context);
      const DURATION = Date.now() - STARTED_AT;

      if (!RESULT.ok) {
        getLogger().warn(
          { module: module_name, task: task.id, error: RESULT.error },
          'Reconcile task failed'
        );
        return {
          module_name,
          task_id: task.id,
          ok: false,
          error: RESULT.error,
          duration_ms: DURATION,
        };
      }

      getLogger().info(
        { module: module_name, task: task.id, ...RESULT.data },
        'Reconcile task done'
      );
      return {
        module_name,
        task_id: task.id,
        ok: true,
        report: RESULT.data,
        duration_ms: DURATION,
      };
    } catch (error: unknown) {
      /* N5 discipline: a throwing task never blocks the pass. */
      getLogger().error(
        { err: error, module: module_name, task: task.id },
        'Reconcile task threw'
      );
      return {
        module_name,
        task_id: task.id,
        ok: false,
        error: String(error),
        duration_ms: Date.now() - STARTED_AT,
      };
    }
  }
}
