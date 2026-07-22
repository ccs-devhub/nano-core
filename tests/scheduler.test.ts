import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersistedJob } from '@/services/scheduler.js';
import { NanoScheduler } from '@/services/scheduler.js';

describe('NanoScheduler', (): void => {
  beforeEach((): void => {
    vi.useFakeTimers();
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('runs a one-shot after its delay', async (): Promise<void> => {
    const SCHEDULER = new NanoScheduler();
    let ran = 0;

    SCHEDULER.scheduleOnce('mod', 'task', 1000, (): void => {
      ran += 1;
    });
    await vi.advanceTimersByTimeAsync(1500);

    expect(ran).toBe(1);
    expect(SCHEDULER.listJobs('mod')).toHaveLength(0);

    SCHEDULER.stopAll();
  });

  it('runs cron jobs repeatedly and cancels them', async ():
  Promise<void> => {
    const SCHEDULER = new NanoScheduler();
    let runs = 0;

    const RESULT = SCHEDULER.scheduleCron('mod', 'tick', '* * * * * *',
      (): void => {
        runs += 1;
      });

    expect(RESULT.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(3100);
    expect(runs).toBeGreaterThanOrEqual(2);

    SCHEDULER.cancelJob('mod', 'tick');
    const BEFORE = runs;
    await vi.advanceTimersByTimeAsync(2000);
    expect(runs).toBe(BEFORE);
  });

  it('rejects duplicate job keys and bad patterns', (): void => {
    const SCHEDULER = new NanoScheduler();

    SCHEDULER.scheduleCron('mod', 'a', '* * * * *', (): void => {});

    expect(SCHEDULER.scheduleCron('mod', 'a', '* * * * *',
      (): void => {}).ok).toBe(false);
    expect(SCHEDULER.scheduleCron('mod', 'b', 'not-a-pattern',
      (): void => {}).ok).toBe(false);

    SCHEDULER.stopAll();
  });

  it('persists and re-arms one-shots through the adapter', async ():
  Promise<void> => {
    const STORE: PersistedJob[] = [];
    const ADAPTER = {
      saveJob: (job: PersistedJob): void => {
        STORE.push(job);
      },
      deleteJob: (module_id: string, name: string): void => {
        const INDEX = STORE.findIndex((job: PersistedJob): boolean => {
          return job.module_id === module_id && job.name === name;
        });

        if (INDEX >= 0) {
          STORE.splice(INDEX, 1);
        }
      },
      loadJobs: (): PersistedJob[] => {
        return [...STORE];
      },
    };
    const FIRST = new NanoScheduler();
    FIRST.attachPersistence(ADAPTER);

    FIRST.scheduleOnce('mod', 'later', 60000, (): void => {},
      { persistent: true, payload: { n: 1 } });
    expect(STORE).toHaveLength(1);
    FIRST.stopAll();

    /* A fresh scheduler (new process) re-arms from the adapter. */
    const SECOND = new NanoScheduler();
    SECOND.attachPersistence(ADAPTER);
    let payload_seen: unknown = null;
    const REARMED = SECOND.rearmPersistedJobs(
      (
        module_id: string,
        name: string
      ): ((payload?: unknown) => void) | undefined => {
        if (module_id === 'mod' && name === 'later') {
          return (payload?: unknown): void => {
            payload_seen = payload;
          };
        }
        return undefined;
      }
    );

    expect(REARMED).toBe(1);
    await vi.advanceTimersByTimeAsync(70000);
    expect(payload_seen).toEqual({ n: 1 });

    SECOND.stopAll();
  });
});
