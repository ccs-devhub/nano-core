import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

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

    if (extname(_entry) !== '.ts') {
      continue;
    }

    const _module = await import(
      new URL(entry_path, import.meta.url).href
    );

    if (_module?.default) {
      _modules.push(_module.default);
    }
  }

  return _modules;
}
