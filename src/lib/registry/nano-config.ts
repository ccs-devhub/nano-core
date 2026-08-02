import { existsSync, readFileSync, renameSync, writeFileSync } from
  'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { CONFIG_FILE_NAME } from '@/constants/nano.js';

/**
 * nano.config.json — the single user-editable bot configuration.
 * Validated with zod; unknown or invalid sections are reported and
 * replaced by defaults, never thrown. Secrets (DISCORD_TOKEN,
 * CLIENT_ID) live in the environment ONLY and are never written here.
 */
export const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/ccs-devhub/nano-store/main/' +
  'registry.json';
const DEFAULT_STORE_TTL_HOURS = 24;
const DEFAULT_HEARTBEAT_INTERVAL_S = 300;
const DEFAULT_MESSAGE_CACHE_MAX = 100;
const DEFAULT_MEMBER_CACHE_MAX = 1000;
const DEFAULT_USER_CACHE_MAX = 1000;
const DEFAULT_MESSAGE_SWEEP_INTERVAL_S = 1800;
const DEFAULT_MESSAGE_MAX_AGE_S = 1800;
const DEFAULT_RECONCILE_LOOKBACK_D = 7;
const DEFAULT_NANO_CACHE_MAX = 20000;

export const MODULE_PROVENANCE_SCHEMA = z.object({
  name: z.string(),
  source: z.enum(['store', 'external', 'local', 'npm']),
  spec: z.string(),
  version: z.string().optional(),
  installed_at: z.string().optional(),
  trusted: z.boolean().optional(),
});

export type ModuleProvenance = z.infer<typeof MODULE_PROVENANCE_SCHEMA>;

/** Bare string entries (npm name or local path) remain valid. */
export const MODULE_ENTRY_SCHEMA = z.union([
  z.string(),
  MODULE_PROVENANCE_SCHEMA,
]);

export type ModuleEntry = z.infer<typeof MODULE_ENTRY_SCHEMA>;

export const NANO_CONFIG_SCHEMA = z.object({
  bot: z.object({
    name: z.string().default('nano-bot'),
    dev_guild_id: z.string().optional(),
  }).default({ name: 'nano-bot' }),
  intents: z.array(z.string()).default(['Guilds']),
  partials: z.array(z.string()).default([]),
  modules: z.array(MODULE_ENTRY_SCHEMA).default([]),
  disabled: z.array(z.string()).default([]),
  database: z.object({
    driver: z.enum(['sqlite', 'postgres']).default('sqlite'),
    url: z.string().optional(),
  }).default({ driver: 'sqlite' }),
  logging: z.object({
    level: z.string().default('info'),
    pretty: z.boolean().default(false),
    file: z.string().optional(),
    module_levels: z.record(z.string(), z.string()).optional(),
  }).default({ level: 'info', pretty: false }),
  store: z.object({
    registry_url: z.string().default(DEFAULT_REGISTRY_URL),
    cache_ttl_hours: z.number().default(DEFAULT_STORE_TTL_HOURS),
  }).default({
    registry_url: DEFAULT_REGISTRY_URL,
    cache_ttl_hours: DEFAULT_STORE_TTL_HOURS,
  }),
  module_config: z.record(z.string(), z.unknown()).default({}),
  /* PF5: multi-guild cooldown stamps alone exceed the old 5000. */
  nano_cache_max: z.number().default(DEFAULT_NANO_CACHE_MAX),
  observability: z.object({
    heartbeat_interval_s: z.number()
      .default(DEFAULT_HEARTBEAT_INTERVAL_S),
  }).default({ heartbeat_interval_s: DEFAULT_HEARTBEAT_INTERVAL_S }),
  /* (f): windowed recoveries never dig past this bound. */
  reconcile: z.object({
    max_lookback_d: z.number().default(DEFAULT_RECONCILE_LOOKBACK_D),
  }).default({ max_lookback_d: DEFAULT_RECONCILE_LOOKBACK_D }),
  /* S1: the sharding SEAM. The fleet model is the shard manager —
     one shard per container; env SHARD_ID/SHARD_COUNT override. */
  sharding: z.object({
    shard_id: z.number().optional(),
    shard_count: z.number().optional(),
  }).default({}),
  /* S2: cache discipline. RSS grows with cached MEMBERS, not
     guilds — capped by default, every value overridable. */
  caching: z.object({
    message_cache_max: z.number().default(DEFAULT_MESSAGE_CACHE_MAX),
    member_cache_max: z.number().default(DEFAULT_MEMBER_CACHE_MAX),
    user_cache_max: z.number().default(DEFAULT_USER_CACHE_MAX),
    presence_cache: z.boolean().default(false),
    reaction_cache: z.boolean().default(false),
    invite_cache: z.boolean().default(false),
    scheduled_event_cache: z.boolean().default(false),
    message_sweep_interval_s: z.number()
      .default(DEFAULT_MESSAGE_SWEEP_INTERVAL_S),
    message_max_age_s: z.number().default(DEFAULT_MESSAGE_MAX_AGE_S),
  }).default({
    message_cache_max: DEFAULT_MESSAGE_CACHE_MAX,
    member_cache_max: DEFAULT_MEMBER_CACHE_MAX,
    user_cache_max: DEFAULT_USER_CACHE_MAX,
    presence_cache: false,
    reaction_cache: false,
    invite_cache: false,
    scheduled_event_cache: false,
    message_sweep_interval_s: DEFAULT_MESSAGE_SWEEP_INTERVAL_S,
    message_max_age_s: DEFAULT_MESSAGE_MAX_AGE_S,
  }),
});

export type NanoConfig = z.infer<typeof NANO_CONFIG_SCHEMA>;

const JSON_INDENT = 2;

/** Baseline configuration used when no config file exists. */
export function defaultConfig(): NanoConfig {
  return NANO_CONFIG_SCHEMA.parse({});
}

/** The install spec of an entry (npm name or local path). */
export function moduleEntrySpec(entry: ModuleEntry): string {
  return typeof entry === 'string' ? entry : entry.spec;
}

/** The display name of an entry (objects carry it; strings ARE it). */
export function moduleEntryName(entry: ModuleEntry): string {
  return typeof entry === 'string' ? entry : entry.name;
}

/**
 * Load nano.config.json. A missing file yields defaults. An EXISTING
 * file that is unreadable OR schema-invalid THROWS (GR12) — zod's
 * safeParse is all-or-nothing, so one bad field would otherwise
 * replace the whole config and re-register commands globally.
 */
export function loadConfig(root: string = process.cwd()): NanoConfig {
  const CONFIG_PATH = join(root, CONFIG_FILE_NAME);

  if (!existsSync(CONFIG_PATH)) {
    return defaultConfig();
  }

  try {
    const RAW: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const PARSED = NANO_CONFIG_SCHEMA.safeParse(RAW);

    if (!PARSED.success) {
      const ISSUES = PARSED.error.issues
        .map((issue: z.core.$ZodIssue): string => {
          return `${issue.path.join('.')} ${issue.message}`;
        })
        .join(', ');
      throw new Error(
        `Invalid ${CONFIG_FILE_NAME}, ${ISSUES}. Refusing to boot ` +
        'on defaults, repair the file.'
      );
    }
    return PARSED.data;
  } catch (error: unknown) {
    /* GR12: an EXISTING but unreadable (truncated/corrupt) config
       must fail LOUDLY — silently defaulting would drop every module
       and re-register commands at GLOBAL scope in every guild. A
       missing file (fresh install) still defaults above. */
    throw new Error(
      `Unreadable ${CONFIG_FILE_NAME}: ${String(error)}. Refusing ` +
      'to boot with defaults — repair or remove the file.'
    );
  }
}

/** Persist the configuration back to nano.config.json. */
export function saveConfig(
  config: NanoConfig,
  root: string = process.cwd()
): void {
  const CONFIG_PATH = join(root, CONFIG_FILE_NAME);
  /* Temp + rename: a truncated config silently loads FULL DEFAULTS
     (empty module list), so the write must be atomic. */
  const TEMP_PATH = `${CONFIG_PATH}.tmp`;
  writeFileSync(
    TEMP_PATH,
    `${JSON.stringify(config, null, JSON_INDENT)}\n`
  );
  renameSync(TEMP_PATH, CONFIG_PATH);
}

/** Persist a module's enabled/disabled state. */
export function setModuleState(
  module_name: string,
  enabled: boolean,
  root: string = process.cwd()
): void {
  const CONFIG = loadConfig(root);
  const WITHOUT = CONFIG.disabled.filter((name: string): boolean => {
    return name !== module_name;
  });
  CONFIG.disabled = enabled ? WITHOUT : [...WITHOUT, module_name];
  saveConfig(CONFIG, root);
}

/** Add a module entry. Returns false when its spec is already present. */
export function addModuleEntry(
  entry: ModuleEntry,
  root: string = process.cwd()
): boolean {
  const CONFIG = loadConfig(root);
  const SPEC = moduleEntrySpec(entry);
  const EXISTS = CONFIG.modules.some((item: ModuleEntry): boolean => {
    return moduleEntrySpec(item) === SPEC;
  });

  if (EXISTS) {
    return false;
  }

  CONFIG.modules.push(entry);
  saveConfig(CONFIG, root);
  return true;
}

/** Remove a module entry by spec or name. Returns false when absent. */
export function removeModuleEntry(
  spec_or_name: string,
  root: string = process.cwd()
): boolean {
  const CONFIG = loadConfig(root);
  const KEPT = CONFIG.modules.filter((item: ModuleEntry): boolean => {
    return moduleEntrySpec(item) !== spec_or_name &&
      moduleEntryName(item) !== spec_or_name;
  });

  if (KEPT.length === CONFIG.modules.length) {
    return false;
  }

  CONFIG.modules = KEPT;
  saveConfig(CONFIG, root);
  return true;
}

/** Read one module's persisted configuration section. */
export function getModuleConfig<T = Record<string, unknown>>(
  module_id: string,
  root: string = process.cwd()
): T | undefined {
  return loadConfig(root).module_config[module_id] as T | undefined;
}

/** Write one module's persisted configuration section. */
export function setModuleConfig(
  module_id: string,
  value: unknown,
  root: string = process.cwd()
): void {
  const CONFIG = loadConfig(root);
  CONFIG.module_config[module_id] = value;
  saveConfig(CONFIG, root);
}
