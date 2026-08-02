import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const LOADABLE_EXTENSIONS: string[] = ['.ts', '.js'];

export async function loadModules(
  folder_path: string
): Promise<unknown[]> {
  const _entries: string[] = readdirSync(folder_path);
  const _modules: unknown[] = [];

  for (const _entry of _entries) {
    const entry_path: string = join(folder_path, _entry);

    if (statSync(entry_path).isDirectory()) {
      const nested_modules = await loadModules(entry_path);
      _modules.push(...nested_modules);
      continue;
    }

    /* '.d.ts' must be rejected before the extname test:
       extname('file.d.ts') is '.ts'. */
    if (_entry.endsWith('.d.ts')) {
      continue;
    }

    if (!LOADABLE_EXTENSIONS.includes(extname(_entry))) {
      continue;
    }

    try {
      const _module: { default?: unknown } = await import(
        new URL(entry_path, import.meta.url).href
      );

      if (_module?.default) {
        _modules.push(_module.default);
      }
    } catch (error: unknown) {
      process.stdout.write(
        `[ERROR] Failed to load module file '${entry_path}': ` +
        `${String(error)}\n`
      );
    }
  }

  return _modules;
}
