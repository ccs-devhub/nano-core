import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Client } from 'discord.js';
import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import type { AuditEntryRecord } from '@/api/audit-attribution.js';
import { AuditAttributor } from '@/api/audit-attribution.js';
import { resolveEmojiSlot } from '@/misc/utility/emoji-slot.js';
import { ModuleRegistry } from '@/registry/module-registry.js';
import { defaultConfig } from '@/registry/nano-config.js';
import { DatabaseService } from '@/services/database.js';
import type { NanoResult } from '@/types/nano-result.js';
import { ok } from '@/types/nano-result.js';

const ROLE_DELETE_TYPE = 32;
const CACHE_MAX_DEFAULT = 20000;

function openDatabase(root: string): DatabaseService {
  const RESULT = DatabaseService.open({}, root);

  if (!RESULT.ok) {
    throw new Error(RESULT.error);
  }
  return RESULT.data;
}

describe('resolveEmojiSlot (C3)', (): void => {
  it('renders mentions, fallbacks, and defaults', (): void => {
    expect(resolveEmojiSlot({ id: '1', name: 'x', fallback: ':)' }))
      .toBe('<:x:1>');
    expect(resolveEmojiSlot({
      id: '1',
      name: 'x',
      animated: true,
      fallback: ':)',
    })).toBe('<a:x:1>');
    expect(resolveEmojiSlot({ fallback: ':)' })).toBe(':)');
    expect(resolveEmojiSlot(undefined, '-')).toBe('-');
    expect(resolveEmojiSlot({ fallback: '' }, '-')).toBe('-');
  });
});

describe('N18 tolerant loadJobs', (): void => {
  it('drops the corrupt row and keeps the rest', (): void => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-n18-'));
    const SERVICE = openDatabase(ROOT);
    const CLIENT = (SERVICE.getDb() as unknown as {
      $client: { exec(sql: string): void };
    }).$client;
    CLIENT.exec(
      "INSERT INTO nano_jobs VALUES ('m', 'good', 1, '{\"a\":1}')"
    );
    CLIENT.exec(
      "INSERT INTO nano_jobs VALUES ('m', 'bad', 2, '{broken')"
    );

    const JOBS = SERVICE.schedulerPersistence().loadJobs();

    expect(JOBS).toHaveLength(1);
    expect(JOBS[0].name).toBe('good');
    SERVICE.close();
  });
});

describe('DB2-3 readonly open', (): void => {
  it('opens an existing db readonly and rejects a missing file',
    (): void => {
      const ROOT = mkdtempSync(join(tmpdir(), 'nano-ro-'));
      openDatabase(ROOT).close();

      const READONLY = DatabaseService.open({}, ROOT, {
        readonly: true,
      });
      expect(READONLY.ok).toBe(true);

      if (READONLY.ok) {
        /* a write on the readonly handle must fail */
        expect((): void => {
          READONLY.data.setRuntimeValue('k', 'v');
        }).not.toThrow(); /* setRuntimeValue swallows — verify null */
        expect(READONLY.data.getRuntimeValue('k')).toBeNull();
        READONLY.data.close();
      }

      const MISSING = DatabaseService.open(
        {},
        mkdtempSync(join(tmpdir(), 'nano-missing-')),
        { readonly: true }
      );
      expect(MISSING.ok).toBe(false);
    });
});

describe('N5 guarded onEnable', (): void => {
  it('registers a throwing module as disabled and keeps booting',
    async (): Promise<void> => {
      const BOT = new EventEmitter() as unknown as Client;
      BOT.commands = new Collection();
      const REGISTRY = new ModuleRegistry(BOT, {});
      BOT.nano = REGISTRY;

      const RESULT = await REGISTRY.register({
        name: 'exploder',
        version: '1.0.0',
        onEnable: (): void => {
          throw new Error('migration failed');
        },
      }, 'local');

      expect(RESULT.ok).toBe(true);
      expect(REGISTRY.isEnabled('exploder')).toBe(false);

      const SECOND = await REGISTRY.register({
        name: 'survivor',
        version: '1.0.0',
      }, 'local');
      expect(SECOND.ok).toBe(true);
      expect(REGISTRY.isEnabled('survivor')).toBe(true);
    });
});

describe('N4 wrapped event handlers', (): void => {
  it('keeps the gateway loop alive when a handler throws', async ():
  Promise<void> => {
    const BOT = new EventEmitter() as unknown as Client;
    BOT.commands = new Collection();
    const REGISTRY = new ModuleRegistry(BOT, {});
    BOT.nano = REGISTRY;
    const SURVIVED = vi.fn();

    await REGISTRY.register({
      name: 'thrower',
      version: '1.0.0',
      events: [{
        name: 'guildMemberAdd',
        description: 'Throws for the test.',
        execute: (): void => {
          throw new Error('handler exploded');
        },
      }],
    }, 'local');
    await REGISTRY.register({
      name: 'listener',
      version: '1.0.0',
      events: [{
        name: 'guildMemberAdd',
        description: 'Survives.',
        execute: SURVIVED as unknown as () => void,
      }],
    }, 'local');

    (BOT as unknown as EventEmitter).emit('guildMemberAdd', {});
    await new Promise((resolve: (value?: unknown) => void): void => {
      setImmediate(resolve);
    });

    expect(SURVIVED).toHaveBeenCalledTimes(1);
  });
});

describe('PF3 coalesced attribution', (): void => {
  it('serves concurrent attributions from one fetch and filters ' +
    'by type and target', async (): Promise<void> => {
    const FETCH = vi.fn(async ():
    Promise<NanoResult<AuditEntryRecord[]>> => {
      return ok([
        {
          type: ROLE_DELETE_TYPE,
          target_id: 'r1',
          executor_id: 'admin',
          reason: null,
          created_at: Date.now(),
        },
        {
          type: 1,
          target_id: 'r1',
          executor_id: 'other',
          reason: null,
          created_at: Date.now(),
        },
      ]);
    });
    const ATTRIBUTOR = new AuditAttributor(FETCH);

    const [FIRST, SECOND] = await Promise.all([
      ATTRIBUTOR.attribute('g1', ROLE_DELETE_TYPE, 'r1'),
      ATTRIBUTOR.attribute('g1', ROLE_DELETE_TYPE, 'r2'),
    ]);

    expect(FETCH).toHaveBeenCalledTimes(1);
    expect(FIRST.ok && FIRST.data?.executor_id).toBe('admin');
    expect(SECOND.ok && SECOND.data).toBeNull();

    /* within the window the cache serves — still one fetch */
    await ATTRIBUTOR.attribute('g1', ROLE_DELETE_TYPE, 'r1');
    expect(FETCH).toHaveBeenCalledTimes(1);
  });
});

describe('PF5 cache knob default', (): void => {
  it('defaults nano_cache_max to 20000', (): void => {
    expect(defaultConfig().nano_cache_max).toBe(CACHE_MAX_DEFAULT);
  });
});

describe('audit fixes (2026-08-02 deep audit)', (): void => {
  it('truncates over-long field names and values instead of throwing',
    async (): Promise<void> => {
      const { buildEmbed: BUILD } = await import('@/api/embed.js');
      const EMBED = BUILD({
        title: 't',
        fields: [
          { name: 'n'.repeat(400), value: 'v'.repeat(2000) },
          { name: '', value: '' },
        ],
      });
      const JSON_DATA = EMBED.toJSON();

      expect(JSON_DATA.fields?.[0].name.length).toBeLessThanOrEqual(256);
      expect(JSON_DATA.fields?.[0].value.length)
        .toBeLessThanOrEqual(1024);
      expect(JSON_DATA.fields?.[1].name.length).toBeGreaterThan(0);
    });

  it('throws on a schema-invalid existing config (GR12)', async ():
  Promise<void> => {
    const { mkdtempSync: MKTMP, writeFileSync: WRITE } =
      await import('node:fs');
    const { tmpdir: TMP } = await import('node:os');
    const { join: JOIN } = await import('node:path');
    const ROOT = MKTMP(JOIN(TMP(), 'nano-badcfg-'));
    WRITE(JOIN(ROOT, 'nano.config.json'), '{ "modules": {} }');

    const { loadConfig: LOAD } = await import('@/registry/nano-config.js');
    expect((): void => {
      LOAD(ROOT);
    }).toThrow(/Invalid/);
  });

  it('runs a due one-shot instead of dropping it', async ():
  Promise<void> => {
    const { NanoScheduler: SCHEDULER_CLASS } =
      await import('@/services/scheduler.js');
    const SCHEDULER = new SCHEDULER_CLASS();
    let fired = false;

    const RESULT = SCHEDULER.scheduleOnce('m', 'due', 0, (): void => {
      fired = true;
    });
    expect(RESULT.ok).toBe(true);

    await new Promise((resolve: (value?: unknown) => void): void => {
      setImmediate(resolve);
    });
    await new Promise((resolve: (value?: unknown) => void): void => {
      setImmediate(resolve);
    });

    expect(fired).toBe(true);
  });

  it('reads a corrupt downtime ledger as first boot', async ():
  Promise<void> => {
    const { Client: CLIENT_CLASS } = await import('discord.js');
    const { ModuleRegistry: REGISTRY_CLASS } =
      await import('@/registry/module-registry.js');
    const { ReconcileRunner: RUNNER_CLASS } =
      await import('@/services/reconcile.js');
    const BOT = new CLIENT_CLASS({ intents: [] });
    BOT.nano = new REGISTRY_CLASS(BOT, {});
    const RUNNER = new RUNNER_CLASS({
      bot: BOT,
      registry: BOT.nano,
      database: {
        getRuntimeValue: (): string => {
          return 'not-a-number';
        },
      } as never,
    });
    const CONTEXT = (RUNNER as unknown as {
      buildContext(reason: string): {
        downtime: { first_boot: boolean; down_ms: number | null };
      };
    }).buildContext('manual');

    expect(CONTEXT.downtime.first_boot).toBe(true);
    expect(CONTEXT.downtime.down_ms).toBeNull();
  });
});

describe('logic audit fixes (2026-08-02 round 2)', (): void => {
  it('a cancelled immediate one-shot never fires', async ():
  Promise<void> => {
    const { NanoScheduler: SCHED } =
      await import('@/services/scheduler.js');
    const SCHEDULER = new SCHED();
    let fired = false;

    SCHEDULER.scheduleOnce('m', 'due', 0, (): void => {
      fired = true;
    });
    const CANCEL = SCHEDULER.cancelJob('m', 'due');
    expect(CANCEL.ok).toBe(true);

    await new Promise((resolve: (value?: unknown) => void): void => {
      setImmediate(resolve);
    });
    await new Promise((resolve: (value?: unknown) => void): void => {
      setImmediate(resolve);
    });

    expect(fired).toBe(false);
    expect(SCHEDULER.stats().jobs).toBe(0);
  });

  it('reads an empty-string downtime ledger as first boot', async ():
  Promise<void> => {
    const { Client: CLIENT } = await import('discord.js');
    const { ModuleRegistry: REG } =
      await import('@/registry/module-registry.js');
    const { ReconcileRunner: RUNNER } =
      await import('@/services/reconcile.js');
    const BOT = new CLIENT({ intents: [] });
    BOT.nano = new REG(BOT, {});
    const R = new RUNNER({
      bot: BOT,
      registry: BOT.nano,
      database: {
        getRuntimeValue: (): string => {
          return '   ';
        },
      } as never,
    });
    const CTX = (R as unknown as {
      buildContext(reason: string): {
        downtime: { first_boot: boolean; down_ms: number | null };
      };
    }).buildContext('manual');

    expect(CTX.downtime.first_boot).toBe(true);
    expect(CTX.downtime.down_ms).toBeNull();
  });
});
