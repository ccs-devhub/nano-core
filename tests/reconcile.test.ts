import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { fillSlots } from '@/misc/utility/format.js';
import { SerialQueue } from '@/misc/utility/serial-queue.js';
import { ModuleRegistry } from '@/registry/module-registry.js';
import { defaultConfig } from '@/registry/nano-config.js';
import type { DatabaseService } from '@/services/database.js';
import {
  DatabaseService as Database,
  RUNTIME_KEY_LAST_ALIVE
} from '@/services/database.js';
import { ReconcileRunner } from '@/services/reconcile.js';
import { NanoScheduler } from '@/services/scheduler.js';
import type {
  NanoModule,
  ReconcileContext,
  ReconcileReport
} from '@/types/nano-module.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

const HOUR_MS = 3600000;
const LOOKBACK_MS = 24 * HOUR_MS;

function report(fixed: number = 0): ReconcileReport {
  return { checked: 1, fixed, skipped: 0, unrecoverable: 0, deferred: 0 };
}

function openDatabase(): DatabaseService {
  const ROOT = mkdtempSync(join(tmpdir(), 'nano-reconcile-'));
  const RESULT = Database.open({}, ROOT);

  if (!RESULT.ok) {
    throw new Error(RESULT.error);
  }
  return RESULT.data;
}

async function makeRunner(
  modules: NanoModule[],
  database: DatabaseService | null = null
): Promise<{ runner: ReconcileRunner; registry: ModuleRegistry }> {
  const BOT = new Client({ intents: [] });
  const REGISTRY = new ModuleRegistry(BOT, {});
  BOT.nano = REGISTRY;

  for (const _module of modules) {
    await REGISTRY.register(_module, 'local');
  }

  const RUNNER = new ReconcileRunner({
    bot: BOT,
    registry: REGISTRY,
    scheduler: new NanoScheduler(),
    database,
    max_lookback_ms: LOOKBACK_MS,
  });
  return { runner: RUNNER, registry: REGISTRY };
}

describe('ReconcileRunner', (): void => {
  it('runs tasks in order, isolates failures, reports results',
    async (): Promise<void> => {
      const ORDER: string[] = [];
      const { runner: RUNNER } = await makeRunner([{
        name: 'alpha',
        version: '1.0.0',
        reconcile: [
          {
            id: 'ok-task',
            description: 'Heals a thing.',
            run: (): NanoResult<ReconcileReport> => {
              ORDER.push('ok-task');
              return ok(report(2));
            },
          },
          {
            id: 'throwing-task',
            description: 'Explodes.',
            run: (): never => {
              ORDER.push('throwing-task');
              throw new Error('boom');
            },
          },
          {
            id: 'err-task',
            description: 'Reports an error.',
            run: (): NanoResult<ReconcileReport> => {
              ORDER.push('err-task');
              return err('nope');
            },
          },
        ],
      }]);

      const RESULTS = await RUNNER.run('manual');

      expect(ORDER).toEqual(['ok-task', 'throwing-task', 'err-task']);
      expect(RESULTS.map((result: { ok: boolean }): boolean => {
        return result.ok;
      })).toEqual([true, false, false]);
      expect(RESULTS[0].report?.fixed).toBe(2);
      expect(RESULTS[1].error).toContain('boom');
    });

  it('reports first_boot without a ledger stamp and clamps down_ms',
    async (): Promise<void> => {
      const DATABASE = openDatabase();
      const SEEN: ReconcileContext[] = [];
      const { runner: RUNNER } = await makeRunner([{
        name: 'probe',
        version: '1.0.0',
        reconcile: [{
          id: 'capture',
          description: 'Captures the context.',
          run: (context: ReconcileContext):
          NanoResult<ReconcileReport> => {
            SEEN.push(context);
            return ok(report());
          },
        }],
      }], DATABASE);

      await RUNNER.run('manual');
      expect(SEEN[0].downtime.first_boot).toBe(true);
      expect(SEEN[0].downtime.down_ms).toBeNull();

      /* a week-old stamp clamps to the 24h lookback */
      const WEEK_MS = 7 * 24 * HOUR_MS;
      DATABASE.setRuntimeValue(
        RUNTIME_KEY_LAST_ALIVE,
        String(Date.now() - WEEK_MS)
      );
      await RUNNER.run('manual');
      expect(SEEN[1].downtime.first_boot).toBe(false);
      expect(SEEN[1].downtime.down_ms).toBe(LOOKBACK_MS);
      DATABASE.close();
    });

  it('runs boot once only and skips disabled modules', async ():
  Promise<void> => {
    const RUN = vi.fn((): NanoResult<ReconcileReport> => {
      return ok(report());
    });
    const { runner: RUNNER, registry: REGISTRY } = await makeRunner([
      {
        name: 'active',
        version: '1.0.0',
        reconcile: [{ id: 'a', description: 'd', run: RUN }],
      },
      {
        name: 'dormant',
        version: '1.0.0',
        reconcile: [{ id: 'b', description: 'd', run: RUN }],
      },
    ]);
    await REGISTRY.disable('dormant');

    const FIRST = await RUNNER.run('boot');
    expect(FIRST).toHaveLength(1);
    expect(FIRST[0].module_name).toBe('active');

    const SECOND = await RUNNER.run('boot');
    expect(SECOND).toEqual([]);
    expect(RUN).toHaveBeenCalledTimes(1);
  });

  it('scopes an enable pass to the named module', async ():
  Promise<void> => {
    const ALPHA_RUN = vi.fn((): NanoResult<ReconcileReport> => {
      return ok(report());
    });
    const BETA_RUN = vi.fn((): NanoResult<ReconcileReport> => {
      return ok(report());
    });
    const { runner: RUNNER } = await makeRunner([
      {
        name: 'alpha',
        version: '1.0.0',
        reconcile: [{ id: 'a', description: 'd', run: ALPHA_RUN }],
      },
      {
        name: 'beta',
        version: '1.0.0',
        reconcile: [{ id: 'b', description: 'd', run: BETA_RUN }],
      },
    ]);

    await RUNNER.run('enable', { module_name: 'beta' });

    expect(ALPHA_RUN).not.toHaveBeenCalled();
    expect(BETA_RUN).toHaveBeenCalledTimes(1);
  });
});

describe('nano_runtime ledger', (): void => {
  it('round-trips and upserts runtime values', (): void => {
    const DATABASE = openDatabase();

    expect(DATABASE.getRuntimeValue('missing')).toBeNull();
    DATABASE.setRuntimeValue('k', '1');
    DATABASE.setRuntimeValue('k', '2');
    expect(DATABASE.getRuntimeValue('k')).toBe('2');
    DATABASE.close();
  });
});

describe('SerialQueue', (): void => {
  it('serializes per key and interleaves across keys', async ():
  Promise<void> => {
    const QUEUE = new SerialQueue();
    const ORDER: string[] = [];
    const SLOW = QUEUE.run('a', async (): Promise<void> => {
      await new Promise((resolve: (value?: unknown) => void): void => {
        setTimeout(resolve, 20);
      });
      ORDER.push('a1');
    });
    const AFTER = QUEUE.run('a', (): void => {
      ORDER.push('a2');
    });
    const OTHER = QUEUE.run('b', (): void => {
      ORDER.push('b1');
    });

    await Promise.all([SLOW, AFTER, OTHER]);

    expect(ORDER).toEqual(['b1', 'a1', 'a2']);
    /* idle keys are dropped — memory stays bounded (PF17) */
    expect(QUEUE.size()).toBe(0);
  });

  it('keeps the chain alive after a failing job', async ():
  Promise<void> => {
    const QUEUE = new SerialQueue();
    const FAILING = QUEUE.run('k', (): never => {
      throw new Error('first');
    });

    await expect(FAILING).rejects.toThrow('first');
    await expect(QUEUE.run('k', (): string => {
      return 'second';
    })).resolves.toBe('second');
  });

  it('debounces and coalesces to the LAST scheduled job', async ():
  Promise<void> => {
    vi.useFakeTimers();

    try {
      const QUEUE = new SerialQueue({ debounce_ms: 50 });
      const FIRST = vi.fn();
      const LAST = vi.fn();
      QUEUE.debounce('k', FIRST);
      QUEUE.debounce('k', LAST);

      await vi.advanceTimersByTimeAsync(60);

      expect(FIRST).not.toHaveBeenCalled();
      expect(LAST).toHaveBeenCalledTimes(1);
      QUEUE.clear();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fillSlots', (): void => {
  it('fills resolved slots and leaves unresolved ones visible',
    (): void => {
      expect(fillSlots('{a} and {b}', { a: 1 })).toBe('1 and {b}');
      expect(fillSlots('no slots', {})).toBe('no slots');
    });
});

describe('reconcile config default', (): void => {
  it('defaults max_lookback_d to 7', (): void => {
    expect(defaultConfig().reconcile.max_lookback_d).toBe(7);
  });
});
