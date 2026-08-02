import { Cron } from 'croner';

import { getLogger } from '@/services/logger.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * Cron + one-shot scheduling (croner: timezone/DST-safe, overrun
 * protection). Jobs are in-memory; a module can mark a one-shot
 * `persistent` when a persistence adapter (database service) is
 * attached, so it survives restarts and re-arms on boot.
 *
 * NAMING CONVENTION (DB19): per-entity one-shots are named
 * `<kind>:<guild_id>:<entity_id>` (e.g. `expiry:g1:case42`) so a
 * re-arm can never collide with a fresh schedule.
 */
export interface ScheduleOptions {
  timezone?: string;
  protect?: boolean;
  /** Random 0..jitter_ms delay per run — staggers aligned crons. */
  jitter_ms?: number;
}

export interface OnceOptions {
  persistent?: boolean;
  payload?: unknown;
}

export interface JobInfo {
  module_id: string;
  name: string;
  kind: 'cron' | 'once';
  pattern?: string;
  next_run: string | null;
  paused: boolean;
}

export interface PersistedJob {
  module_id: string;
  name: string;
  run_at: number;
  payload: unknown;
}

export interface SchedulerStats {
  jobs: number;
  overruns: number;
}

export interface SchedulerPersistence {
  saveJob(job: PersistedJob): void;
  deleteJob(module_id: string, name: string): void;
  loadJobs(): PersistedJob[];
}

interface TrackedJob {
  /** null for an immediate one-shot (no croner timer involved). */
  cron: Cron | null;
  kind: 'cron' | 'once';
  pattern?: string;
}

export class NanoScheduler {
  private jobs: Map<string, TrackedJob> = new Map();
  private persistence: SchedulerPersistence | null = null;
  private overruns: number = 0;

  /** Attach the database-backed store for persistent one-shots. */
  attachPersistence(persistence: SchedulerPersistence): void {
    this.persistence = persistence;
  }

  /** Live counters the vitals layer reports. */
  stats(): SchedulerStats {
    return { jobs: this.jobs.size, overruns: this.overruns };
  }

  /** Schedule a recurring cron job. */
  scheduleCron(
    module_id: string,
    name: string,
    pattern: string,
    fn: () => Promise<void> | void,
    options: ScheduleOptions = {}
  ): NanoResult<string> {
    const KEY = jobKey(module_id, name);

    if (this.jobs.has(KEY)) {
      return err(`Job '${KEY}' already exists.`);
    }

    try {
      const BASE = options.jitter_ms
        ? async (): Promise<void> => {
          await sleep(Math.random() * (options.jitter_ms ?? 0));
          await fn();
        }
        : fn;
      /* croner's catch:true swallows throws silently — wrap so a
         failing cron handler is at least logged. */
      const RUN = async (): Promise<void> => {
        try {
          await BASE();
        } catch (error: unknown) {
          getLogger().error(
            { err: error, job: KEY },
            'Cron handler failed'
          );
        }
      };
      /* protect blocks overlapping runs; the callback form also
         counts and logs every blocked overrun (D-SETTINGS). */
      const CRON = new Cron(pattern, {
        timezone: options.timezone,
        protect: (options.protect ?? true)
          ? (): void => {
            this.overruns += 1;
            getLogger().warn(
              { job: KEY },
              'Cron overrun — run blocked by protect'
            );
          }
          : false,
        catch: true,
      }, RUN);
      this.jobs.set(KEY, { cron: CRON, kind: 'cron', pattern });
      return ok(KEY);
    } catch (error: unknown) {
      return err(error);
    }
  }

  /** Schedule a one-shot at a date or after a delay in ms. */
  scheduleOnce(
    module_id: string,
    name: string,
    run_at: Date | number,
    fn: (payload?: unknown) => Promise<void> | void,
    options: OnceOptions = {}
  ): NanoResult<string> {
    const KEY = jobKey(module_id, name);

    if (this.jobs.has(KEY)) {
      return err(`Job '${KEY}' already exists.`);
    }

    const WHEN = typeof run_at === 'number'
      ? new Date(Date.now() + run_at)
      : run_at;

    if (options.persistent) {
      if (!this.persistence) {
        return err('Persistent jobs need a database-backed scheduler.');
      }

      this.persistence.saveJob({
        module_id,
        name,
        run_at: WHEN.getTime(),
        payload: options.payload ?? null,
      });
    }

    const ENTRY: TrackedJob = { cron: null, kind: 'once' };
    const RUN = async (): Promise<void> => {
      /* Bail if the job was cancelled (or replaced) before it ran —
         cancelJob/stopAll drop the entry, so the identity no longer
         matches and a queued immediate one-shot does NOT fire. */
      if (this.jobs.get(KEY) !== ENTRY) {
        return;
      }

      this.jobs.delete(KEY);

      try {
        await fn(options.payload);
      } catch (error: unknown) {
        getLogger().error({ err: error, job: KEY }, 'One-shot failed');
        return;
      }
      /* Delete only AFTER the handler settles, so a crash mid-run
         leaves the row to be re-armed on the next boot. */
      this.persistence?.deleteJob(module_id, name);
    };
    const RUN_SOON = (): void => {
      this.jobs.set(KEY, ENTRY);
      setImmediate((): void => {
        void RUN();
      });
    };

    /* croner NEVER fires a one-shot whose date is already past
       (nextRun() is null), so due-or-overdue jobs run immediately
       instead of vanishing silently. */
    if (WHEN.getTime() <= Date.now()) {
      RUN_SOON();
      return ok(KEY);
    }

    const CRON = new Cron(WHEN, { catch: true }, RUN);

    /* A barely-future date can cross into the past between the check
       above and croner sampling the clock — if it did, run now. */
    if (CRON.nextRun() === null) {
      CRON.stop();
      RUN_SOON();
      return ok(KEY);
    }

    ENTRY.cron = CRON;
    this.jobs.set(KEY, ENTRY);
    return ok(KEY);
  }

  /**
   * Re-arm persisted one-shots on boot. Overdue jobs fire immediately.
   * Each module exposes its handlers via the NanoModule `tasks` map.
   */
  rearmPersistedJobs(
    resolve_task: (
      module_id: string,
      name: string
    ) => ((payload?: unknown) => Promise<void> | void) | undefined
  ): number {
    if (!this.persistence) {
      return 0;
    }

    let rearmed = 0;

    for (const _job of this.persistence.loadJobs()) {
      const HANDLER = resolve_task(_job.module_id, _job.name);

      if (!HANDLER) {
        continue;
      }

      /* Pass the REAL (possibly past) date so overdue jobs take the
         immediate-run path. No pre-delete: scheduleOnce re-saves the
         row, and a duplicate-key error means the module already
         re-scheduled it in onEnable, so the persisted row is left
         intact rather than silently dropped. */
      const RESULT = this.scheduleOnce(
        _job.module_id,
        _job.name,
        new Date(_job.run_at),
        HANDLER,
        { persistent: true, payload: _job.payload }
      );

      if (RESULT.ok) {
        rearmed += 1;
      }
    }
    return rearmed;
  }

  cancelJob(module_id: string, name: string): NanoResult<string> {
    const KEY = jobKey(module_id, name);
    const JOB = this.jobs.get(KEY);

    if (!JOB) {
      return err(`Job '${KEY}' does not exist.`);
    }

    JOB.cron?.stop();
    this.jobs.delete(KEY);
    this.persistence?.deleteJob(module_id, name);
    return ok(KEY);
  }

  pauseJob(module_id: string, name: string): NanoResult<string> {
    const JOB = this.jobs.get(jobKey(module_id, name));

    if (!JOB) {
      return err(`Job '${jobKey(module_id, name)}' does not exist.`);
    }

    JOB.cron?.pause();
    return ok(jobKey(module_id, name));
  }

  resumeJob(module_id: string, name: string): NanoResult<string> {
    const JOB = this.jobs.get(jobKey(module_id, name));

    if (!JOB) {
      return err(`Job '${jobKey(module_id, name)}' does not exist.`);
    }

    JOB.cron?.resume();
    return ok(jobKey(module_id, name));
  }

  listJobs(module_id?: string): JobInfo[] {
    const JOBS: JobInfo[] = [];

    for (const [_key, _job] of this.jobs.entries()) {
      const [OWNER, ...NAME_PARTS] = _key.split(':');

      if (module_id && OWNER !== module_id) {
        continue;
      }

      JOBS.push({
        module_id: OWNER,
        name: NAME_PARTS.join(':'),
        kind: _job.kind,
        pattern: _job.pattern,
        next_run: _job.cron?.nextRun()?.toISOString() ?? null,
        paused: _job.cron ? !_job.cron.isRunning() : false,
      });
    }
    return JOBS;
  }

  /** Cancel every module's jobs (module removal hook). */
  cancelModuleJobs(module_id: string): number {
    let cancelled = 0;

    for (const _info of this.listJobs(module_id)) {
      const RESULT = this.cancelJob(_info.module_id, _info.name);

      if (RESULT.ok) {
        cancelled += 1;
      }
    }
    return cancelled;
  }

  /** Stop everything (graceful shutdown). */
  stopAll(): void {
    for (const _job of this.jobs.values()) {
      _job.cron?.stop();
    }
    this.jobs.clear();
  }
}

function sleep(delay_ms: number): Promise<void> {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, delay_ms);
  });
}

function jobKey(module_id: string, name: string): string {
  return `${module_id}:${name}`;
}
