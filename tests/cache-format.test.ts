import { describe, expect, it } from 'vitest';

import { buildCustomId, parseCustomId } from '@/misc/utility/custom-id.js';
import { chunk, snowflakeToDate, truncate } from '@/misc/utility/format.js';
import { NanoCache } from '@/services/cache.js';

describe('NanoCache', (): void => {
  it('stores and namespaces values', (): void => {
    const CACHE = new NanoCache();

    CACHE.set('mod-a', 'key', 1);
    CACHE.set('mod-b', 'key', 2);

    expect(CACHE.get('mod-a', 'key')).toBe(1);
    expect(CACHE.get('mod-b', 'key')).toBe(2);
  });

  it('clears one namespace only', (): void => {
    const CACHE = new NanoCache();

    CACHE.set('mod-a', 'key', 1);
    CACHE.set('mod-b', 'key', 2);
    CACHE.clear('mod-a');

    expect(CACHE.has('mod-a', 'key')).toBe(false);
    expect(CACHE.get('mod-b', 'key')).toBe(2);
  });

  it('getOrCompute caches the computed value', async (): Promise<void> => {
    const CACHE = new NanoCache();
    let calls = 0;
    const COMPUTE = async (): Promise<number> => {
      calls += 1;
      return 42;
    };

    expect(await CACHE.getOrCompute('m', 'k', COMPUTE)).toBe(42);
    expect(await CACHE.getOrCompute('m', 'k', COMPUTE)).toBe(42);
    expect(calls).toBe(1);
  });

  it('scoped view stays inside its namespace', (): void => {
    const CACHE = new NanoCache();
    const SCOPED = CACHE.namespace('mod-a');

    SCOPED.set('key', 'value');

    expect(SCOPED.get('key')).toBe('value');
    expect(CACHE.get('mod-a', 'key')).toBe('value');
    expect(CACHE.get('mod-b', 'key')).toBeUndefined();
  });
});

describe('custom-id convention', (): void => {
  it('round-trips module, action, and args', (): void => {
    const ID = buildCustomId('synapse', 'rescan', 'g1', 'deep');

    expect(ID).toBe('synapse:rescan:g1:deep');
    expect(parseCustomId(ID)).toEqual({
      module: 'synapse',
      action: 'rescan',
      args: ['g1', 'deep'],
    });
  });

  it('rejects ids over 100 characters at build time', (): void => {
    expect((): void => {
      buildCustomId('mod', 'action', 'x'.repeat(120));
    }).toThrow(/100/);
  });

  it('returns null for non-conventional ids', (): void => {
    expect(parseCustomId('loose-id')).toBeNull();
  });
});

describe('format helpers', (): void => {
  it('chunks arrays', (): void => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it('truncates long strings with a suffix', (): void => {
    expect(truncate('hello world', 8)).toBe('hello...');
    expect(truncate('short', 10)).toBe('short');
  });

  it('decodes snowflake creation dates', (): void => {
    /* Discord epoch snowflake for 2015-01-01T00:00:00.000Z is 0. */
    expect(snowflakeToDate('0').toISOString())
      .toBe('2015-01-01T00:00:00.000Z');
  });
});
