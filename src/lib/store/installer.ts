import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { NANO_VERSION } from '@/constants/nano.js';
import type { ModuleEntry, ModuleProvenance } from
  '@/registry/nano-config.js';
import {
  addModuleEntry,
  loadConfig,
  moduleEntryName,
  removeModuleEntry,
  saveConfig
} from '@/registry/nano-config.js';
import type { StoreClient, StoreModule } from '@/store/store-client.js';
import { checkMinCore } from '@/store/store-client.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * Install flows. Store installs are pinned to the exact validated
 * version and recorded as trusted provenance. Anything NOT in the
 * store is an EXTERNAL install: it requires explicit confirmation of
 * the risk warning and is recorded `trusted: false`.
 */
export interface InstallerDeps {
  exec?: (command: string) => string;
  root?: string;
  now?: () => string;
}

export const EXTERNAL_RISK_WARNING =
  'WARNING: this module is NOT in the nano-store and has NOT been ' +
  'reviewed by CCS. Module code runs with the SAME privileges as your ' +
  'bot process: your Discord token, every guild the bot is in, your ' +
  'filesystem and network. Install it only if you trust the author. ' +
  'Re-run with --allow-external to confirm.';

const PACKAGE_NAME_PATTERN =
  /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function defaultExec(command: string): string {
  return execSync(command, { stdio: 'pipe' }).toString();
}

function defaultNow(): string {
  return new Date().toISOString();
}

/** Install a validated module from the store by name. */
export async function installFromStore(
  client: StoreClient,
  name: string,
  deps: InstallerDeps = {}
): Promise<NanoResult<ModuleProvenance>> {
  const EXEC = deps.exec ?? defaultExec;
  const ROOT = deps.root ?? process.cwd();
  const RESOLVED = await client.resolve(name);

  if (!RESOLVED.ok) {
    return err(RESOLVED.error);
  }

  const MODULE = RESOLVED.data;

  if (!checkMinCore(MODULE.min_core, NANO_VERSION)) {
    return err(
      `'${MODULE.name}' needs nano-core >= ${MODULE.min_core} ` +
      `(you run ${NANO_VERSION}).`
    );
  }

  const SPEC_RESULT = installSource(MODULE, EXEC, ROOT);

  if (!SPEC_RESULT.ok) {
    return err(SPEC_RESULT.error);
  }

  const PROVENANCE: ModuleProvenance = {
    name: MODULE.name,
    source: 'store',
    spec: SPEC_RESULT.data,
    version: MODULE.version,
    installed_at: (deps.now ?? defaultNow)(),
    trusted: true,
  };
  upsertEntry(PROVENANCE, ROOT);
  return ok(PROVENANCE);
}

/**
 * Install an unreviewed module (npm name or local path). Refused
 * until the caller confirms the risk warning.
 */
export function installExternal(
  spec: string,
  confirmed: boolean,
  deps: InstallerDeps = {}
): NanoResult<ModuleProvenance> {
  const EXEC = deps.exec ?? defaultExec;
  const ROOT = deps.root ?? process.cwd();
  const IS_LOCAL = spec.startsWith('.') || spec.startsWith('/');

  if (!IS_LOCAL && !confirmed) {
    return err(EXTERNAL_RISK_WARNING);
  }

  if (IS_LOCAL) {
    if (!existsSync(resolve(ROOT, spec))) {
      return err(`Local module path '${spec}' does not exist.`);
    }
  } else {
    if (!PACKAGE_NAME_PATTERN.test(spec)) {
      return err(`Invalid npm package name '${spec}'.`);
    }

    EXEC(`npm install ${spec}`);
  }

  const PROVENANCE: ModuleProvenance = {
    name: spec.replace(/^.*\//, ''),
    source: IS_LOCAL ? 'local' : 'external',
    spec,
    installed_at: (deps.now ?? defaultNow)(),
    trusted: IS_LOCAL,
  };
  upsertEntry(PROVENANCE, ROOT);
  return ok(PROVENANCE);
}

export interface OutdatedModule {
  name: string;
  installed: string;
  latest: string;
}

/** Store-installed modules whose registry version moved on. */
export async function listOutdated(
  client: StoreClient,
  root: string = process.cwd()
): Promise<NanoResult<OutdatedModule[]>> {
  const REGISTRY = await client.getRegistry();

  if (!REGISTRY.ok) {
    return err(REGISTRY.error);
  }

  const CONFIG = loadConfig(root);
  const OUTDATED: OutdatedModule[] = [];

  for (const _entry of CONFIG.modules) {
    if (typeof _entry === 'string' || _entry.source !== 'store') {
      continue;
    }

    const LATEST = REGISTRY.data.modules.find(
      (module: StoreModule): boolean => {
        return module.name === _entry.name;
      }
    );

    if (!LATEST) {
      OUTDATED.push({
        name: _entry.name,
        installed: _entry.version ?? 'unknown',
        latest: 'removed from store',
      });
      continue;
    }

    if (LATEST.version !== _entry.version) {
      OUTDATED.push({
        name: _entry.name,
        installed: _entry.version ?? 'unknown',
        latest: LATEST.version,
      });
    }
  }
  return ok(OUTDATED);
}

/** Re-install a store module at its current validated version. */
export async function updateModule(
  client: StoreClient,
  name: string,
  deps: InstallerDeps = {}
): Promise<NanoResult<ModuleProvenance>> {
  return installFromStore(client, name, deps);
}

/**
 * GitHub installs are staged: clone into a hidden staging dir, verify,
 * and only then swap into modules/<name>. The existing target is
 * NEVER touched before the new copy is fully validated, and a target
 * the store does not manage (local dev code) is never overwritten.
 */
function installSource(
  module: StoreModule,
  exec: (command: string) => string,
  root: string
): NanoResult<string> {
  try {
    if (module.source === 'npm') {
      if (!module.package) {
        return err(`Store entry '${module.name}' is missing 'package'.`);
      }

      exec(`npm install ${module.package}@${module.version}`);
      return ok(module.package);
    }

    if (!module.repo) {
      return err(`Store entry '${module.name}' is missing 'repo'.`);
    }

    const TARGET = `modules/${module.name}`;
    const STAGING = `modules/.staging-${module.name}`;

    if (
      existsSync(resolve(root, TARGET)) &&
      !isStoreManaged(module.name, root)
    ) {
      return err(
        `'${TARGET}' exists locally and is not a store-managed ` +
        'install. Remove or rename it before installing from the store.'
      );
    }

    if (existsSync(resolve(root, STAGING))) {
      exec(`rm -rf ${STAGING}`);
    }

    exec(
      `git clone --depth 1 --branch v${module.version} ` +
      `https://github.com/${module.repo}.git ${STAGING}`
    );

    if (module.commit) {
      const HEAD = exec(`git -C ${STAGING} rev-parse HEAD`).trim();

      if (!HEAD.startsWith(module.commit)) {
        exec(`rm -rf ${STAGING}`);
        return err(
          `Commit mismatch for '${module.name}': expected ` +
          `${module.commit}, cloned ${HEAD}. Aborted.`
        );
      }
    }

    if (existsSync(resolve(root, TARGET))) {
      exec(`rm -rf ${TARGET}`);
    }

    exec(`mv ${STAGING} ${TARGET}`);
    return ok(`./${TARGET}`);
  } catch (error: unknown) {
    return err(error);
  }
}

function isStoreManaged(module_name: string, root: string): boolean {
  return loadConfig(root).modules.some((entry: ModuleEntry): boolean => {
    return typeof entry !== 'string' &&
      entry.name === module_name &&
      entry.source === 'store';
  });
}

function upsertEntry(provenance: ModuleProvenance, root: string): void {
  const CONFIG = loadConfig(root);
  const EXISTS = CONFIG.modules.some((entry: ModuleEntry): boolean => {
    return moduleEntryName(entry) === provenance.name;
  });

  if (EXISTS) {
    removeModuleEntry(provenance.name, root);
  }

  addModuleEntry(provenance, root);
  saveConfig(loadConfig(root), root);
}
