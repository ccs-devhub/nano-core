import { LRUCache } from 'lru-cache';

/**
 * Command-level throttling (token bucket). This is for user-facing
 * cooldowns only — @discordjs/rest already queues and retries HTTP 429s,
 * so never use this for REST throttling.
 */
export type CooldownScope = 'user' | 'guild' | 'channel' | 'global';

export interface CooldownSpec {
  scope: CooldownScope;
  delay_ms: number;
  limit?: number;
}

export interface CooldownContext {
  user_id: string;
  guild_id?: string | null;
  channel_id?: string | null;
}

export interface CooldownVerdict {
  allowed: boolean;
  retry_after_ms: number;
}

interface Bucket {
  tokens: number;
  reset_at: number;
}

const MAX_TRACKED_BUCKETS = 10000;

export class CooldownManager {
  private definitions: Map<string, CooldownSpec> = new Map();
  private buckets: LRUCache<string, Bucket>;

  constructor() {
    this.buckets = new LRUCache({ max: MAX_TRACKED_BUCKETS });
  }

  /** Declare (or replace) a command's cooldown. */
  defineCooldown(command_name: string, spec: CooldownSpec): void {
    this.definitions.set(command_name, spec);
  }

  hasCooldown(command_name: string): boolean {
    return this.definitions.has(command_name);
  }

  /** Read-only check: would a use be allowed right now? */
  check(command_name: string, context: CooldownContext): CooldownVerdict {
    return this.evaluate(command_name, context, false);
  }

  /** Check AND spend a token when allowed. */
  consume(command_name: string, context: CooldownContext): CooldownVerdict {
    return this.evaluate(command_name, context, true);
  }

  /** Clear the bucket for one command/context pair. */
  reset(command_name: string, context: CooldownContext): void {
    const SPEC = this.definitions.get(command_name);

    if (SPEC) {
      this.buckets.delete(bucketKey(command_name, SPEC.scope, context));
    }
  }

  private evaluate(
    command_name: string,
    context: CooldownContext,
    spend: boolean
  ): CooldownVerdict {
    const SPEC = this.definitions.get(command_name);

    if (!SPEC) {
      return { allowed: true, retry_after_ms: 0 };
    }

    const KEY = bucketKey(command_name, SPEC.scope, context);
    const NOW = Date.now();
    const LIMIT = SPEC.limit ?? 1;
    let bucket = this.buckets.get(KEY);

    if (!bucket || NOW >= bucket.reset_at) {
      bucket = { tokens: LIMIT, reset_at: NOW + SPEC.delay_ms };
      this.buckets.set(KEY, bucket, { ttl: SPEC.delay_ms });
    }

    if (bucket.tokens <= 0) {
      return { allowed: false, retry_after_ms: bucket.reset_at - NOW };
    }

    if (spend) {
      bucket.tokens -= 1;
    }
    return { allowed: true, retry_after_ms: 0 };
  }
}

function bucketKey(
  command_name: string,
  scope: CooldownScope,
  context: CooldownContext
): string {
  if (scope === 'global') {
    return `${command_name}:global`;
  }

  if (scope === 'guild') {
    return `${command_name}:guild:${context.guild_id ?? 'dm'}`;
  }

  if (scope === 'channel') {
    return `${command_name}:channel:${context.channel_id ?? 'dm'}`;
  }
  return `${command_name}:user:${context.user_id}`;
}
