import type { NanoCache } from '@/services/cache.js';
import { getLogger } from '@/services/logger.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * Per-guild module configuration: the core connection every module's
 * guild-scoped behaviour hangs off. Rows live in `nano_guild_config`
 * (one row per key); reads are cache-backed and NEVER write — a guild
 * with no rows gets the module's schema defaults, so joining a guild
 * costs zero writes. Host-level configuration stays in
 * nano.config.json; guild-scoped configuration lives ONLY here.
 */

/**
 * Structural view of a zod schema (or anything shaped like one). The
 * schema MUST produce a complete config from `{}` — every key needs a
 * default — because defaults ARE the unconfigured state.
 */
export interface GuildConfigValidator {
  safeParse(input: unknown): {
    success: boolean;
    data?: unknown;
    error?: { message: string };
  };
}

/** Migration hook (N12): reshape a stored value written by an older
 * schema version. Runs at read time; the result persists on the next
 * write, never eagerly. */
export type GuildConfigMigration = (
  old_version: number,
  value: Record<string, unknown>
) => Record<string, unknown>;

export interface GuildConfigSchemaSpec {
  schema: GuildConfigValidator;
  config_version?: number;
  migrate?: GuildConfigMigration;
}

/** The storage seam implemented by DatabaseService (sqlite today,
 * postgres tomorrow — same interface). */
export interface GuildConfigPersistence {
  loadModuleConfig(
    guild_id: string,
    module_id: string
  ): { key: string; value: string }[];
  replaceModuleConfig(
    guild_id: string,
    module_id: string,
    entries: { key: string; value: string }[]
  ): void;
  upsertKeys(
    guild_id: string,
    module_id: string,
    entries: { key: string; value: string }[]
  ): void;
  deleteModuleConfig(guild_id: string, module_id: string): number;
  listGuildsFor(module_id: string): string[];
}

const CACHE_NAMESPACE = 'nano:guild-config';
const VERSION_KEY = '__config_version';
const FIRST_VERSION = 1;

export class GuildStore {
  private persistence: GuildConfigPersistence | null;
  private cache: NanoCache;
  private schemas: Map<string, GuildConfigSchemaSpec> = new Map();
  private parse_failures: Map<string, number> = new Map();

  constructor(
    persistence: GuildConfigPersistence | null,
    cache: NanoCache
  ) {
    this.persistence = persistence;
    this.cache = cache;
  }

  /**
   * Declare a module's config schema. Re-registering drops the
   * module's cached reads so the new schema applies immediately.
   */
  registerSchema(module_id: string, spec: GuildConfigSchemaSpec): void {
    this.schemas.set(module_id, spec);
    this.cache.clear(CACHE_NAMESPACE);
  }

  /**
   * Read one guild's config for one module: stored keys parsed through
   * the module schema, defaults where nothing is stored. Cached; never
   * writes; never throws — a broken row logs, counts toward health,
   * and falls back to defaults.
   */
  getGuildModuleConfig<T extends Record<string, unknown> =
    Record<string, unknown>>(
    guild_id: string,
    module_id: string
  ): T {
    const CACHE_KEY = `${guild_id}:${module_id}`;
    const HIT = this.cache.get<T>(CACHE_NAMESPACE, CACHE_KEY);

    if (HIT !== undefined) {
      return HIT;
    }

    const VALUE = this.readAndValidate(guild_id, module_id) as T;
    this.cache.set(CACHE_NAMESPACE, CACHE_KEY, VALUE);
    return VALUE;
  }

  /**
   * Replace one guild's config for one module. Validates the WHOLE
   * object against the module schema, stamps the schema version inside
   * the stored value, and invalidates the cached read.
   */
  setGuildModuleConfig(
    guild_id: string,
    module_id: string,
    value: Record<string, unknown>
  ): NanoResult<Record<string, unknown>> {
    if (!this.persistence) {
      return err('Database unavailable — guild config cannot persist.');
    }

    const VALIDATED = this.validateForWrite(module_id, value);

    if (!VALIDATED.ok) {
      return VALIDATED;
    }

    this.persistence.replaceModuleConfig(
      guild_id,
      module_id,
      toEntries(VALIDATED.data, this.versionOf(module_id))
    );
    this.cache.delete(CACHE_NAMESPACE, `${guild_id}:${module_id}`);
    return VALIDATED;
  }

  /**
   * Merge a partial change into one guild's config. The MERGED object
   * is validated (a patch can never bypass the schema); only the
   * patched keys and the version stamp are written.
   */
  patchGuildModuleConfig(
    guild_id: string,
    module_id: string,
    partial: Record<string, unknown>
  ): NanoResult<Record<string, unknown>> {
    if (!this.persistence) {
      return err('Database unavailable — guild config cannot persist.');
    }

    const CURRENT = this.readAndValidate(guild_id, module_id);
    const MERGED = { ...CURRENT, ...partial };
    const VALIDATED = this.validateForWrite(module_id, MERGED);

    if (!VALIDATED.ok) {
      return VALIDATED;
    }

    const PATCHED_KEYS = Object.keys(partial);
    const ENTRIES = toEntries(VALIDATED.data, this.versionOf(module_id))
      .filter((entry: { key: string; value: string }): boolean => {
        return PATCHED_KEYS.includes(entry.key) ||
          entry.key === VERSION_KEY;
      });
    this.persistence.upsertKeys(guild_id, module_id, ENTRIES);
    this.cache.delete(CACHE_NAMESPACE, `${guild_id}:${module_id}`);
    return VALIDATED;
  }

  /** Drop one guild's stored config for one module (back to defaults). */
  deleteGuildModuleConfig(
    guild_id: string,
    module_id: string
  ): NanoResult<number> {
    if (!this.persistence) {
      return err('Database unavailable — guild config cannot persist.');
    }

    const REMOVED = this.persistence.deleteModuleConfig(
      guild_id,
      module_id
    );
    this.cache.delete(CACHE_NAMESPACE, `${guild_id}:${module_id}`);
    return ok(REMOVED);
  }

  /** Every guild holding stored config for a module (reconcile fuel). */
  listGuildsFor(module_id: string): string[] {
    if (!this.persistence) {
      return [];
    }
    return this.persistence.listGuildsFor(module_id);
  }

  /** Parse-failure counts per module, for health reporting. */
  parseFailures(): Record<string, number> {
    return Object.fromEntries(this.parse_failures);
  }

  private readAndValidate(
    guild_id: string,
    module_id: string
  ): Record<string, unknown> {
    const SPEC = this.schemas.get(module_id);
    const STORED = this.loadStored(guild_id, module_id);

    if (!SPEC) {
      return STORED.value;
    }

    let candidate = STORED.value;

    if (
      STORED.has_rows &&
      SPEC.migrate &&
      STORED.version < this.versionOf(module_id)
    ) {
      candidate = SPEC.migrate(STORED.version, candidate);
    }

    const PARSED = SPEC.schema.safeParse(candidate);

    if (PARSED.success) {
      return PARSED.data as Record<string, unknown>;
    }

    this.countFailure(module_id);
    getLogger().warn(
      {
        module: module_id,
        guild_id,
        error: PARSED.error?.message,
      },
      'Stored guild config failed validation — using defaults'
    );
    return this.defaultsOf(module_id);
  }

  private loadStored(
    guild_id: string,
    module_id: string
  ): {
    value: Record<string, unknown>;
    version: number;
    has_rows: boolean;
  } {
    const ROWS = this.persistence
      ? this.persistence.loadModuleConfig(guild_id, module_id)
      : [];
    const VALUE: Record<string, unknown> = {};
    let version = FIRST_VERSION;

    for (const _row of ROWS) {
      try {
        const PARSED: unknown = JSON.parse(_row.value);

        if (_row.key === VERSION_KEY) {
          version = typeof PARSED === 'number' ? PARSED : FIRST_VERSION;
          continue;
        }

        VALUE[_row.key] = PARSED;
      } catch {
        this.countFailure(module_id);
        getLogger().warn(
          { module: module_id, guild_id, key: _row.key },
          'Unreadable guild config row skipped'
        );
      }
    }
    return { value: VALUE, version, has_rows: ROWS.length > 0 };
  }

  private validateForWrite(
    module_id: string,
    value: Record<string, unknown>
  ): NanoResult<Record<string, unknown>> {
    const SPEC = this.schemas.get(module_id);

    if (!SPEC) {
      return ok(stripVersionKey(value));
    }

    const PARSED = SPEC.schema.safeParse(stripVersionKey(value));

    if (!PARSED.success) {
      return err(
        `Invalid config for module '${module_id}': ` +
        `${PARSED.error?.message ?? 'schema rejected the value'}`
      );
    }
    return ok(PARSED.data as Record<string, unknown>);
  }

  private defaultsOf(module_id: string): Record<string, unknown> {
    const SPEC = this.schemas.get(module_id);

    if (!SPEC) {
      return {};
    }

    const PARSED = SPEC.schema.safeParse({});

    if (PARSED.success) {
      return PARSED.data as Record<string, unknown>;
    }

    getLogger().warn(
      { module: module_id },
      'Guild config schema cannot parse {} — every key needs a ' +
      'default; returning an empty object'
    );
    return {};
  }

  private versionOf(module_id: string): number {
    return this.schemas.get(module_id)?.config_version ?? FIRST_VERSION;
  }

  private countFailure(module_id: string): void {
    this.parse_failures.set(
      module_id,
      (this.parse_failures.get(module_id) ?? 0) + 1
    );
  }
}

function toEntries(
  value: Record<string, unknown>,
  config_version: number
): { key: string; value: string }[] {
  const ENTRIES = Object.entries(value)
    .filter(([key]: [string, unknown]): boolean => {
      return key !== VERSION_KEY;
    })
    .map(([key, item]: [string, unknown]):
    { key: string; value: string } => {
      return { key, value: JSON.stringify(item ?? null) };
    });
  ENTRIES.push({
    key: VERSION_KEY,
    value: JSON.stringify(config_version),
  });
  return ENTRIES;
}

function stripVersionKey(
  value: Record<string, unknown>
): Record<string, unknown> {
  if (!(VERSION_KEY in value)) {
    return value;
  }

  const CLONE = { ...value };
  delete CLONE[VERSION_KEY];
  return CLONE;
}
