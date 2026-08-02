import {
  GuildMemberManager,
  GuildScheduledEventManager,
  MessageManager,
  PresenceManager
} from 'discord.js';
import { describe, expect, it } from 'vitest';

import {
  resolveCacheOptions,
  resolveSharding
} from '@/misc/utility/scale-options.js';
import { defaultConfig } from '@/registry/nano-config.js';

const MESSAGE_CACHE_MAX = 100;
const MEMBER_CACHE_MAX = 1000;
const SWEEP_INTERVAL_S = 1800;
const SHARD_COUNT = 4;

interface LimitedLike {
  maxSize?: number;
}

function makeCacheFor(
  manager: unknown,
  block: ReturnType<typeof defaultConfig>['caching'] =
  defaultConfig().caching
): LimitedLike {
  const FACTORY = resolveCacheOptions(block).make_cache as (
    manager_type: unknown,
    holds: unknown,
    manager_arg: unknown
  ) => LimitedLike;
  return FACTORY(manager, undefined, manager);
}

describe('resolveSharding', (): void => {
  it('resolves null when nothing is configured', (): void => {
    const RESULT = resolveSharding({}, {});

    expect(RESULT.ok).toBe(true);

    if (RESULT.ok) {
      expect(RESULT.data).toBeNull();
    }
  });

  it('reads the config block', (): void => {
    const RESULT = resolveSharding(
      { shard_id: 1, shard_count: SHARD_COUNT },
      {}
    );

    expect(RESULT.ok).toBe(true);

    if (RESULT.ok) {
      expect(RESULT.data).toEqual({
        shard_id: 1,
        shard_count: SHARD_COUNT,
      });
    }
  });

  it('lets SHARD_ID/SHARD_COUNT env override the config', (): void => {
    const RESULT = resolveSharding(
      { shard_id: 0, shard_count: 2 },
      { SHARD_ID: '3', SHARD_COUNT: String(SHARD_COUNT) }
    );

    expect(RESULT.ok).toBe(true);

    if (RESULT.ok) {
      expect(RESULT.data).toEqual({
        shard_id: 3,
        shard_count: SHARD_COUNT,
      });
    }
  });

  it('rejects half-configured sharding', (): void => {
    expect(resolveSharding({ shard_id: 1 }, {}).ok).toBe(false);
  });

  it('rejects out-of-range and non-integer assignments', (): void => {
    expect(
      resolveSharding({ shard_id: 4, shard_count: SHARD_COUNT }, {}).ok
    ).toBe(false);
    expect(resolveSharding({}, { SHARD_ID: 'x', SHARD_COUNT: '2' }).ok)
      .toBe(false);
  });
});

describe('resolveCacheOptions', (): void => {
  it('caps messages and members at the configured limits', (): void => {
    expect(makeCacheFor(MessageManager).maxSize).toBe(MESSAGE_CACHE_MAX);
    expect(makeCacheFor(GuildMemberManager).maxSize)
      .toBe(MEMBER_CACHE_MAX);
  });

  it('turns unread caches off by default', (): void => {
    expect(makeCacheFor(PresenceManager).maxSize).toBe(0);
    expect(makeCacheFor(GuildScheduledEventManager).maxSize).toBe(0);
  });

  it('leaves an opted-in cache unlimited', (): void => {
    const BLOCK = {
      ...defaultConfig().caching,
      presence_cache: true,
    };

    expect(makeCacheFor(PresenceManager, BLOCK).maxSize).toBeUndefined();
  });

  it('sweeps messages on the configured cadence', (): void => {
    const SWEEPERS = resolveCacheOptions(defaultConfig().caching)
      .sweepers as { messages?: { interval: number; lifetime: number } };

    expect(SWEEPERS.messages).toEqual({
      interval: SWEEP_INTERVAL_S,
      lifetime: SWEEP_INTERVAL_S,
    });
  });
});
