import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

/** Load nano.config.json, falling back to defaults on any error. */
export function loadConfig(root: string = process.cwd()): NanoConfig {
  const CONFIG_PATH = join(root, CONFIG_FILE_NAME);

  if (!existsSync(CONFIG_PATH)) {
    return defaultConfig();
  }

  try {
    const RAW: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const PARSED = NANO_CONFIG_SCHEMA.safeParse(RAW);

    if (!PARSED.success) {
      process.stdout.write(
        `[ERROR] Invalid ${CONFIG_FILE_NAME}: ` +
        `${PARSED.error.issues.map((issue: z.core.$ZodIssue): string => {
          return `${issue.path.join('.')}: ${issue.message}`;
        }).join('; ')}. Using defaults.\n`
      );
      return defaultConfig();
    }
    return PARSED.data;
  } catch (error: unknown) {
    process.stdout.write(
      `[ERROR] Unreadable ${CONFIG_FILE_NAME}: ${String(error)}. ` +
      'Using defaults.\n'
    );
    return defaultConfig();
  }
}

/** Persist the configuration back to nano.config.json. */
export function saveConfig(
  config: NanoConfig,
  root: string = process.cwd()
): void {
  const CONFIG_PATH = join(root, CONFIG_FILE_NAME);
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, JSON_INDENT)}\n`);
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
