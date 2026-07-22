import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { ModuleEntry } from '@/registry/nano-config.js';
import {
  loadConfig,
  moduleEntryName,
  moduleEntrySpec
} from '@/registry/nano-config.js';

/**
 * Flat, render-ready view of the configured modules for the TUI:
 * enabled state, provenance, and whether the module ships a
 * declarative nano-tui.json panel.
 */
export interface TuiModuleRow {
  name: string;
  spec: string;
  source: string;
  version?: string;
  trusted: boolean;
  enabled: boolean;
  manifest_path?: string;
}

export function listModuleRows(
  root: string = process.cwd()
): TuiModuleRow[] {
  const CONFIG = loadConfig(root);

  return CONFIG.modules.map((entry: ModuleEntry): TuiModuleRow => {
    const NAME = moduleEntryName(entry);
    const SPEC = moduleEntrySpec(entry);
    const IS_LOCAL = SPEC.startsWith('.') || SPEC.startsWith('/');
    const MANIFEST = IS_LOCAL
      ? join(resolve(root, SPEC), 'nano-tui.json')
      : join(root, 'node_modules', SPEC, 'nano-tui.json');

    const FALLBACK_SOURCE = IS_LOCAL ? 'local' : 'npm';

    return {
      name: NAME,
      spec: SPEC,
      source: typeof entry === 'string' ? FALLBACK_SOURCE : entry.source,
      version: typeof entry === 'string' ? undefined : entry.version,
      trusted: typeof entry === 'string'
        ? IS_LOCAL
        : entry.trusted !== false,
      enabled: !CONFIG.disabled.includes(NAME),
      manifest_path: existsSync(MANIFEST) ? MANIFEST : undefined,
    };
  });
}
