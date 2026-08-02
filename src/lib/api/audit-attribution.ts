import type { Client, GuildAuditLogsEntry } from 'discord.js';

import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * PF3: coalesced audit-log attribution. Under a mass action by
 * another bot, per-event lazy fetches become hundreds of REST calls;
 * this shares ONE fetch of the latest entries per window across all
 * pending attributions. EX17: matches are filtered by TYPE and
 * TARGET, so a concurrent unrelated entry can never poison one.
 * Instances are MODULE-OWNED (PF4) — never a global core queue.
 */
export interface AuditEntryRecord {
  type: number;
  target_id: string | null;
  executor_id: string | null;
  reason: string | null;
  created_at: number;
}

export type AuditEntriesFetcher = (
  guild_id: string
) => Promise<NanoResult<AuditEntryRecord[]>>;

export interface AuditAttributorOptions {
  window_ms?: number;
  max_entry_age_ms?: number;
}

interface GuildCache {
  fetched_at: number;
  entries: AuditEntryRecord[];
  inflight: Promise<NanoResult<AuditEntryRecord[]>> | null;
}

const DEFAULT_WINDOW_MS = 10000;
const DEFAULT_MAX_ENTRY_AGE_MS = 60000;
const DEFAULT_FETCH_LIMIT = 50;

export class AuditAttributor {
  private fetch_entries: AuditEntriesFetcher;
  private options: AuditAttributorOptions;
  private cache: Map<string, GuildCache> = new Map();

  constructor(
    fetch_entries: AuditEntriesFetcher,
    options: AuditAttributorOptions = {}
  ) {
    this.fetch_entries = fetch_entries;
    this.options = options;
  }

  /**
   * The freshest matching entry for (type, target), or null when the
   * window holds none — callers record "actor unknown", never guess.
   */
  async attribute(
    guild_id: string,
    type: number,
    target_id: string
  ): Promise<NanoResult<AuditEntryRecord | null>> {
    const ENTRIES = await this.entriesFor(guild_id);

    if (!ENTRIES.ok) {
      return err(ENTRIES.error);
    }

    const MAX_AGE = this.options.max_entry_age_ms ??
      DEFAULT_MAX_ENTRY_AGE_MS;
    const NOW = Date.now();
    const MATCH = ENTRIES.data.find(
      (entry: AuditEntryRecord): boolean => {
        return entry.type === type &&
          entry.target_id === target_id &&
          NOW - entry.created_at <= MAX_AGE;
      }
    );
    return ok(MATCH ?? null);
  }

  private async entriesFor(
    guild_id: string
  ): Promise<NanoResult<AuditEntryRecord[]>> {
    const WINDOW = this.options.window_ms ?? DEFAULT_WINDOW_MS;
    let cached = this.cache.get(guild_id);

    if (!cached) {
      cached = { fetched_at: 0, entries: [], inflight: null };
      this.cache.set(guild_id, cached);
    }

    if (Date.now() - cached.fetched_at < WINDOW) {
      return ok(cached.entries);
    }

    const STATE = cached;
    STATE.inflight ??= this.fetch_entries(guild_id)
      .then((result: NanoResult<AuditEntryRecord[]>):
      NanoResult<AuditEntryRecord[]> => {
        if (result.ok) {
          STATE.entries = result.data;
          STATE.fetched_at = Date.now();
        }
        return result;
      })
      .finally((): void => {
        STATE.inflight = null;
      });
    return STATE.inflight;
  }
}

/** The production fetcher: newest audit entries via the gateway bot. */
export function auditEntriesFetcher(
  bot: Client,
  limit: number = DEFAULT_FETCH_LIMIT
): AuditEntriesFetcher {
  return async (
    guild_id: string
  ): Promise<NanoResult<AuditEntryRecord[]>> => {
    try {
      const GUILD = await bot.guilds.fetch(guild_id);
      const LOG = await GUILD.fetchAuditLogs({ limit });
      return ok(Array.from(LOG.entries.values()).map(
        (entry: GuildAuditLogsEntry): AuditEntryRecord => {
          return {
            type: entry.action,
            target_id: entry.targetId,
            executor_id: entry.executorId,
            reason: entry.reason,
            created_at: entry.createdTimestamp,
          };
        }
      ));
    } catch (error: unknown) {
      return err(String(error));
    }
  };
}
