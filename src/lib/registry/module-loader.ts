import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { NANO_VERSION } from '@/constants/nano.js';
import { loadModules } from '@/misc/io/load-ts-modules.js';
import type { ModuleOrigin } from '@/registry/module-registry.js';
import type { NanoConfig } from '@/registry/nano-config.js';
import { moduleEntrySpec } from '@/registry/nano-config.js';
import type { NanoModule } from '@/types/nano-module.js';
import {
  isNanoCommand,
  isNanoEvent,
  isNanoModule
} from '@/types/nano-module.js';

export interface ExternalModule {
  module: NanoModule;
  origin: ModuleOrigin;
  entry: string;
}

/**
 * Bundle everything under src/core/commands and src/core/events into the
 * built-in 'core' module, so drop-in files keep working as before.
 */
export async function loadCoreModule(base_dir: string): Promise<NanoModule> {
  const COMMANDS_PATH = join(base_dir, 'core', 'commands');
  const EVENTS_PATH = join(base_dir, 'core', 'events');
  const RAW_COMMANDS = existsSync(COMMANDS_PATH)
    ? await loadModules(COMMANDS_PATH)
    : [];
  const RAW_EVENTS = existsSync(EVENTS_PATH)
    ? await loadModules(EVENTS_PATH)
    : [];

  return {
    name: 'core',
    version: NANO_VERSION,
    description: 'Built-in utility commands and events.',
    license: 'MPL-2.0',
    commands: RAW_COMMANDS.filter(isNanoCommand),
    events: RAW_EVENTS.filter(isNanoEvent),
  };
}

/**
 * Import every module entry declared in nano.config.json. Entries that
 * start with '.' or '/' are local paths; anything else is an installed
 * npm package. A broken entry is logged and skipped, never fatal.
 */
export async function loadExternalModules(
  config: NanoConfig
): Promise<ExternalModule[]> {
  const LOADED: ExternalModule[] = [];

  for (const _entry of config.modules) {
    const SPEC = moduleEntrySpec(_entry);

    try {
      const IS_LOCAL = SPEC.startsWith('.') || SPEC.startsWith('/');
      const TARGET = IS_LOCAL ? resolveLocalEntry(SPEC) : SPEC;
      const IMPORTED: { default?: unknown } = await import(TARGET);
      const CANDIDATE = IMPORTED?.default;

      if (!isNanoModule(CANDIDATE)) {
        process.stdout.write(
          `[WARN] Entry '${SPEC}' does not export a NanoModule. Skipping.\n`
        );
        continue;
      }

      LOADED.push({
        module: CANDIDATE,
        origin: IS_LOCAL ? 'local' : 'npm',
        entry: SPEC,
      });
    } catch (error: unknown) {
      process.stdout.write(
        `[ERROR] Failed to load module '${SPEC}': ${String(error)}\n`
      );
    }
  }
  return LOADED;
}

function resolveLocalEntry(entry: string): string {
  const ABSOLUTE = resolve(process.cwd(), entry);
  const CANDIDATES = [
    ABSOLUTE,
    join(ABSOLUTE, 'index.ts'),
    join(ABSOLUTE, 'index.js'),
  ];

  for (const _candidate of CANDIDATES) {
    if (existsSync(_candidate) && statSync(_candidate).isFile()) {
      return pathToFileURL(_candidate).href;
    }
  }
  throw new Error(`No module entry found at '${entry}'.`);
}
