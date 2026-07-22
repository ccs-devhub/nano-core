import { Cron } from 'croner';

import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * Cron + one-shot scheduling (croner: timezone/DST-safe, overrun
 * protection). Jobs are in-memory; a module can mark a one-shot
 * `persistent` when a persistence adapter (database service) is
 * attached, so it survives restarts and re-arms on boot.
 */
export interface ScheduleOptions {
  timezone?: string;
  protect?: boolean;
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

export interface SchedulerPersistence {
  saveJob(job: PersistedJob): void;
  deleteJob(module_id: string, name: string): void;
  loadJobs(): PersistedJob[];
}

interface TrackedJob {
  cron: Cron;
  kind: 'cron' | 'once';
  pattern?: string;
}

export class NanoScheduler {
  private jobs: Map<string, TrackedJob> = new Map();
  private persistence: SchedulerPersistence | null = null;

  /** Attach the database-backed store for persistent one-shots. */
  attachPersistence(persistence: SchedulerPersistence): void {
    this.persistence = persistence;
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
      const CRON = new Cron(pattern, {
        timezone: options.timezone,
        protect: options.protect ?? true,
        catch: true,
      }, fn);
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

    const CRON = new Cron(WHEN, { catch: true }, async (): Promise<void> => {
      this.jobs.delete(KEY);
      this.persistence?.deleteJob(module_id, name);
      await fn(options.payload);
    });
    this.jobs.set(KEY, { cron: CRON, kind: 'once' });
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

      const WHEN = Math.max(_job.run_at, Date.now() + 1);
      this.persistence.deleteJob(_job.module_id, _job.name);
      const RESULT = this.scheduleOnce(
        _job.module_id,
        _job.name,
        new Date(WHEN),
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

    JOB.cron.stop();
    this.jobs.delete(KEY);
    this.persistence?.deleteJob(module_id, name);
    return ok(KEY);
  }

  pauseJob(module_id: string, name: string): NanoResult<string> {
    const JOB = this.jobs.get(jobKey(module_id, name));

    if (!JOB) {
      return err(`Job '${jobKey(module_id, name)}' does not exist.`);
    }

    JOB.cron.pause();
    return ok(jobKey(module_id, name));
  }

  resumeJob(module_id: string, name: string): NanoResult<string> {
    const JOB = this.jobs.get(jobKey(module_id, name));

    if (!JOB) {
      return err(`Job '${jobKey(module_id, name)}' does not exist.`);
    }

    JOB.cron.resume();
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
        next_run: _job.cron.nextRun()?.toISOString() ?? null,
        paused: !_job.cron.isRunning(),
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
      _job.cron.stop();
    }
    this.jobs.clear();
  }
}

function jobKey(module_id: string, name: string): string {
  return `${module_id}:${name}`;
}
