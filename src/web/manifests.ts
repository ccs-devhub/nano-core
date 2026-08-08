import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import type { Client } from 'discord.js';

import type { ModuleEntry } from '@/registry/nano-config.js';
import {
  loadConfig,
  moduleEntryName,
  moduleEntrySpec
} from '@/registry/nano-config.js';
import { getModuleLogger } from '@/services/logger.js';
import type { DashboardManifest } from '@/types/nano-dashboard.js';
import {
  DASHBOARD_MANIFEST_FILENAME,
  loadDashboardManifest
} from '@/types/nano-dashboard.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * Path-based nano-dashboard.json discovery (the module-rows.ts
 * pattern): the host resolves each configured module entry's
 * directory and looks for the descriptor file beside the entry.
 * NEVER imports module code — descriptors are data (the
 * declarative-only law). Availability rides the live registry:
 * disabled or failed-to-load modules keep their descriptor on disk
 * but render an explicit unavailable state (A5).
 */
export interface DashboardModuleRow {
  name: string;
  has_descriptor: boolean;
  available: boolean;
  /** Set when unavailable: 'disabled' | 'not-registered'. */
  reason?: string;
  /** A descriptor EXISTS but failed to load — never silent (A4). */
  descriptor_error?: string;
  /** The guild-store registered config version (handshake fuel). */
  registered_config_version: number | null;
}

/**
 * Config reads for the web layer NEVER throw: a mid-edit
 * nano.config.json falls back to an empty module list instead of
 * darkening every module route (the A4 posture).
 */
function safeModuleEntries(root: string): ModuleEntry[] {
  try {
    return loadConfig(root).modules;
  } catch (error: unknown) {
    getModuleLogger('web').warn(
      { err: error },
      'nano.config.json unreadable, module list empty this request'
    );
    return [];
  }
}

/** F1: absolute filesystem paths never reach a web client — the
    checkout root collapses to '.' in served error strings. */
function scrubRoot(error: unknown, root: string): string {
  return String(error).replaceAll(root, '.');
}

function descriptorPathFor(
  entry: ModuleEntry,
  root: string
): string {
  const SPEC = moduleEntrySpec(entry);
  const IS_LOCAL = SPEC.startsWith('.') || SPEC.startsWith('/');
  return IS_LOCAL
    ? join(resolve(root, SPEC), DASHBOARD_MANIFEST_FILENAME)
    : join(root, 'node_modules', SPEC, DASHBOARD_MANIFEST_FILENAME);
}

/**
 * The module NAME an entry answers to. Provenance objects carry it;
 * a bare LOCAL path names its module by directory basename (the
 * './modules/roles' convention); a bare npm spec names it verbatim.
 */
export function entryModuleName(entry: ModuleEntry): string {
  if (typeof entry !== 'string') {
    return moduleEntryName(entry);
  }

  const IS_LOCAL = entry.startsWith('.') || entry.startsWith('/');
  return IS_LOCAL ? basename(entry) : entry;
}

function availabilityOf(
  bot: Client,
  module_name: string
): { available: boolean; reason?: string } {
  const ENTRY = bot.nano?.get(module_name);

  if (!ENTRY) {
    return { available: false, reason: 'not-registered' };
  }

  if (!ENTRY.enabled) {
    return { available: false, reason: 'disabled' };
  }
  return { available: true };
}

export function listDashboardModules(
  bot: Client,
  root: string = process.cwd()
): DashboardModuleRow[] {
  return safeModuleEntries(root).map(
    (entry: ModuleEntry): DashboardModuleRow => {
      const NAME = entryModuleName(entry);
      const AVAILABILITY = availabilityOf(bot, NAME);
      const PATH = descriptorPathFor(entry, root);
      const DESCRIPTOR = loadDashboardManifest(PATH);
      /* A descriptor that EXISTS but fails to parse is a defect the
         author must see — never indistinguishable from absence. */
      const BROKEN = !DESCRIPTOR.ok && existsSync(PATH);

      if (BROKEN) {
        getModuleLogger('web').warn(
          { module: NAME, error: DESCRIPTOR.ok ? '' : DESCRIPTOR.error },
          'Dashboard descriptor failed to load'
        );
      }

      return {
        name: NAME,
        has_descriptor: DESCRIPTOR.ok,
        available: AVAILABILITY.available,
        ...(AVAILABILITY.reason ? { reason: AVAILABILITY.reason } : {}),
        ...(BROKEN && !DESCRIPTOR.ok
          ? { descriptor_error: scrubRoot(DESCRIPTOR.error, root) }
          : {}),
        registered_config_version:
          bot.services.guild_store.schemaVersionOf(NAME),
      };
    }
  );
}

/** Module presentation assets live beside the descriptor. */
export const DASHBOARD_ASSETS_DIRNAME = 'nano-dashboard-assets';

const ASSET_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const ASSET_EXTENSIONS =
  ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'];

/**
 * Resolve one module asset file, refusing traversal, dotfiles, and
 * anything outside the raster whitelist. The dirname keeps assets
 * an explicit opt-in — the host never serves arbitrary module
 * files.
 */
export function moduleAssetPath(
  module_id: string,
  file: string,
  root: string = process.cwd()
): NanoResult<string> {
  if (!ASSET_NAME_PATTERN.test(file) || file.includes('..')) {
    return err(`Bad asset name '${file}'.`);
  }

  if (!ASSET_EXTENSIONS.includes(extname(file).toLowerCase())) {
    return err(`Asset type not allowed for '${file}'.`);
  }

  const ENTRY = safeModuleEntries(root).find(
    (item: ModuleEntry): boolean => {
      return entryModuleName(item) === module_id;
    }
  );

  if (!ENTRY) {
    return err(`No configured module named '${module_id}'.`);
  }

  const SPEC = moduleEntrySpec(ENTRY);
  const IS_LOCAL = SPEC.startsWith('.') || SPEC.startsWith('/');
  const MODULE_DIR = IS_LOCAL
    ? resolve(root, SPEC)
    : join(root, 'node_modules', SPEC);
  const FULL = join(MODULE_DIR, DASHBOARD_ASSETS_DIRNAME, file);

  if (!existsSync(FULL)) {
    return err(`No asset '${file}' for module '${module_id}'.`);
  }
  return ok(FULL);
}

export interface LoadedDescriptor {
  manifest: DashboardManifest;
  available: boolean;
  reason?: string;
  registered_config_version: number | null;
}

export function loadModuleDescriptor(
  bot: Client,
  module_id: string,
  root: string = process.cwd()
): NanoResult<LoadedDescriptor> {
  const ENTRY = safeModuleEntries(root).find(
    (item: ModuleEntry): boolean => {
      return entryModuleName(item) === module_id;
    }
  );

  if (!ENTRY) {
    return err(`No configured module named '${module_id}'.`);
  }

  const MANIFEST = loadDashboardManifest(
    descriptorPathFor(ENTRY, root)
  );

  if (!MANIFEST.ok) {
    /* F1: loader errors carry absolute paths for the CLI author;
       the web seam serves the scrubbed form. */
    return err(scrubRoot(MANIFEST.error, root));
  }

  const AVAILABILITY = availabilityOf(bot, module_id);
  return ok({
    manifest: MANIFEST.data,
    available: AVAILABILITY.available,
    ...(AVAILABILITY.reason ? { reason: AVAILABILITY.reason } : {}),
    registered_config_version:
      bot.services.guild_store.schemaVersionOf(module_id),
  });
}
