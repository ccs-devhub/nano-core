import type {
  CacheFactory,
  GuildMember,
  SweeperOptions,
  User
} from 'discord.js';
import { Options } from 'discord.js';

import type { NanoConfig } from '@/registry/nano-config.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * S1 + S2: the scale seams. Sharding stays a CONFIG SEAM — the fleet
 * model is the shard manager (one shard per container, per-shard
 * instance dir), so core never gains a ShardingManager. Caching caps
 * the discord.js entity caches — RSS grows with cached MEMBERS, not
 * guild count, so members/users/messages are limited and the caches
 * no planned module reads (presences, reactions, invites, scheduled
 * events) are off by default. Reaction flows ride PARTIALS instead.
 */
type ShardingBlock = NanoConfig['sharding'];
type CachingBlock = NanoConfig['caching'];

export interface ResolvedSharding {
  shard_id: number;
  shard_count: number;
}

/**
 * The effective shard assignment: env SHARD_ID/SHARD_COUNT override
 * the config block. ok(null) means unsharded (the default); err
 * means the configuration is present but unusable — the caller
 * should warn and boot unsharded rather than guess.
 */
export function resolveSharding(
  block: ShardingBlock,
  env: NodeJS.ProcessEnv = process.env
): NanoResult<ResolvedSharding | null> {
  const ID_RAW = env.SHARD_ID ??
    (block.shard_id === undefined ? undefined : String(block.shard_id));
  const COUNT_RAW = env.SHARD_COUNT ??
    (block.shard_count === undefined
      ? undefined
      : String(block.shard_count));

  if (ID_RAW === undefined && COUNT_RAW === undefined) {
    return ok(null);
  }

  if (ID_RAW === undefined || COUNT_RAW === undefined) {
    return err('Sharding needs BOTH shard_id and shard_count.');
  }

  const SHARD_ID = Number(ID_RAW);
  const SHARD_COUNT = Number(COUNT_RAW);

  if (!Number.isInteger(SHARD_ID) || !Number.isInteger(SHARD_COUNT)) {
    return err('shard_id and shard_count must be integers.');
  }

  if (SHARD_COUNT < 1 || SHARD_ID < 0 || SHARD_ID >= SHARD_COUNT) {
    return err(
      `shard_id ${SHARD_ID} is outside [0, ${SHARD_COUNT}).`
    );
  }
  return ok({ shard_id: SHARD_ID, shard_count: SHARD_COUNT });
}

export interface CacheOptions {
  make_cache: CacheFactory;
  sweepers: SweeperOptions;
}

const CACHE_OFF = 0;

/**
 * Client cache options from the `caching` config block. The bot's
 * own member/user entries are always kept over the limit — losing
 * them breaks permission checks.
 */
export function resolveCacheOptions(block: CachingBlock): CacheOptions {
  const LIMITS: Parameters<typeof Options.cacheWithLimits>[0] = {
    MessageManager: block.message_cache_max,
    GuildMemberManager: {
      maxSize: block.member_cache_max,
      keepOverLimit: (member: GuildMember): boolean => {
        return member.id === member.client.user?.id;
      },
    },
    UserManager: {
      maxSize: block.user_cache_max,
      keepOverLimit: (user: User): boolean => {
        return user.id === user.client.user?.id;
      },
    },
  };

  if (!block.presence_cache) {
    LIMITS.PresenceManager = CACHE_OFF;
  }

  if (!block.reaction_cache) {
    LIMITS.ReactionManager = CACHE_OFF;
  }

  if (!block.invite_cache) {
    LIMITS.GuildInviteManager = CACHE_OFF;
  }

  if (!block.scheduled_event_cache) {
    LIMITS.GuildScheduledEventManager = CACHE_OFF;
  }

  return {
    make_cache: Options.cacheWithLimits(LIMITS),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: {
        interval: block.message_sweep_interval_s,
        lifetime: block.message_max_age_s,
      },
    },
  };
}
