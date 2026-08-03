/**
 * N7: the self-write suppression map. Every mutation this module
 * issues stamps the member's EXPECTED role set BEFORE the PATCH;
 * the drift-capture listener consults this map FIRST and skips
 * events whose resulting set matches a stamp, so the module never
 * adopts its own writes as manual drift. Entries expire on a short
 * TTL and are pruned lazily, memory stays bounded without timers.
 */

const DEFAULT_TTL_MS = 30000;

interface SuppressionEntry {
  hash: string;
  expires_at: number;
}

/** Order-insensitive fingerprint of a role set. */
export function roleSetHash(role_ids: string[]): string {
  return [...role_ids].sort().join(',');
}

export class SuppressionMap {
  private ttl_ms: number;
  private entries: Map<string, SuppressionEntry> = new Map();

  constructor(ttl_ms: number = DEFAULT_TTL_MS) {
    this.ttl_ms = ttl_ms;
  }

  /** Record the role set a member is ABOUT to hold (pre-PATCH). */
  stamp(guild_id: string, user_id: string, role_ids: string[]): void {
    this.prune();
    this.entries.set(`${guild_id}:${user_id}`, {
      hash: roleSetHash(role_ids),
      expires_at: Date.now() + this.ttl_ms,
    });
  }

  /**
   * True when an observed role set matches a live stamp — the
   * event is this module's own write, not external drift. The
   * stamp stays until it expires: one PATCH can surface through
   * more than one gateway event.
   */
  matches(
    guild_id: string,
    user_id: string,
    role_ids: string[]
  ): boolean {
    this.prune();
    const ENTRY = this.entries.get(`${guild_id}:${user_id}`);

    if (!ENTRY) {
      return false;
    }
    return ENTRY.hash === roleSetHash(role_ids);
  }

  /** Live entry count (health metrics; tests assert boundedness). */
  size(): number {
    this.prune();
    return this.entries.size;
  }

  /** Forget everything (onDisable). */
  clear(): void {
    this.entries.clear();
  }

  private prune(): void {
    const NOW = Date.now();

    for (const [_key, _entry] of this.entries) {
      if (_entry.expires_at <= NOW) {
        this.entries.delete(_key);
      }
    }
  }
}
