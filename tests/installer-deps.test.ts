import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { installFromStore } from '@/store/installer.js';
import type { StoreRegistry } from '@/store/store-client.js';
import { StoreClient } from '@/store/store-client.js';

const REGISTRY: StoreRegistry = {
  store_version: 1,
  modules: [
    {
      name: 'depmod',
      description: 'A module with its own npm dependencies.',
      author: 'somedev',
      source: 'github',
      repo: 'somedev/nano-depmod',
      version: '0.1.0',
      min_core: '0.1.0',
      validated_at: '2026-07-01',
    },
  ],
};

function createClient(root: string): StoreClient {
  const FETCH = vi.fn(async (): Promise<Response> => {
    return new Response(JSON.stringify(REGISTRY));
  }) as unknown as typeof fetch;
  return new StoreClient({
    registry_url: 'https://example.test/registry.json',
    root,
    fetch_fn: FETCH,
  });
}

interface ExecFake {
  commands: string[];
  exec: (command: string) => string;
}

function createExec(
  root: string,
  manifest: Record<string, unknown> | null
): ExecFake {
  const COMMANDS: string[] = [];
  const EXEC = (command: string): string => {
    COMMANDS.push(command);

    if (command.startsWith('mv ') && manifest) {
      const TARGET = join(root, 'modules', 'depmod');
      mkdirSync(TARGET, { recursive: true });
      writeFileSync(
        join(TARGET, 'package.json'), JSON.stringify(manifest)
      );
    }
    return '';
  };
  return { commands: COMMANDS, exec: EXEC };
}

describe('installer module dependencies', (): void => {
  it('runs a scoped npm install after the swap when the module ' +
    'declares dependencies', async (): Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-deps-'));
    const FAKE = createExec(ROOT, {
      name: 'depmod',
      dependencies: { 'left-pad': '1.0.0' },
    });

    const RESULT = await installFromStore(
      createClient(ROOT), 'depmod', { root: ROOT, exec: FAKE.exec }
    );

    expect(RESULT.ok).toBe(true);
    const NPM = FAKE.commands.find((command: string): boolean => {
      return command.startsWith('npm install --prefix modules/depmod');
    });
    expect(NPM).toBeDefined();
    expect(NPM).toContain('--omit=dev');
    expect(NPM).toContain('--ignore-scripts');
  });

  it('skips npm install when the module has no dependencies', async ():
  Promise<void> => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-deps-'));
    const FAKE = createExec(ROOT, { name: 'depmod' });

    const RESULT = await installFromStore(
      createClient(ROOT), 'depmod', { root: ROOT, exec: FAKE.exec }
    );

    expect(RESULT.ok).toBe(true);
    expect(FAKE.commands.some((command: string): boolean => {
      return command.includes('npm install --prefix');
    })).toBe(false);
  });

  it('skips npm install when the module ships no package.json',
    async (): Promise<void> => {
      const ROOT = mkdtempSync(join(tmpdir(), 'nano-deps-'));
      const FAKE = createExec(ROOT, null);

      const RESULT = await installFromStore(
        createClient(ROOT), 'depmod', { root: ROOT, exec: FAKE.exec }
      );

      expect(RESULT.ok).toBe(true);
      expect(FAKE.commands.some((command: string): boolean => {
        return command.includes('npm install --prefix');
      })).toBe(false);
    });
});
