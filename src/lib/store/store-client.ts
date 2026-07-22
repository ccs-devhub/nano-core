import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * Client for the curated nano-store registry (a single registry.json
 * in a GitHub repo, Obsidian-style). Fetched via raw URL, cached with
 * a TTL; a stale cache is still served when offline. Only modules the
 * store maintainer merged appear here — that is the whole trust model.
 */
export const STORE_MODULE_SCHEMA = z.object({
  name: z.string(),
  description: z.string(),
  author: z.string(),
  license: z.string().optional(),
  source: z.enum(['npm', 'github']),
  package: z.string().optional(),
  repo: z.string().optional(),
  version: z.string(),
  commit: z.string().optional(),
  min_core: z.string().optional(),
  tags: z.array(z.string()).optional(),
  validated_at: z.string(),
});

export type StoreModule = z.infer<typeof STORE_MODULE_SCHEMA>;

export const STORE_REGISTRY_SCHEMA = z.object({
  store_version: z.number(),
  modules: z.array(STORE_MODULE_SCHEMA),
});

export type StoreRegistry = z.infer<typeof STORE_REGISTRY_SCHEMA>;

export interface StoreClientOptions {
  registry_url: string;
  cache_ttl_hours?: number;
  root?: string;
  fetch_fn?: typeof fetch;
}

interface CacheFile {
  fetched_at: number;
  registry: StoreRegistry;
}

const CACHE_DIR = '.nano';
const CACHE_FILE = 'store-cache.json';
const DEFAULT_TTL_HOURS = 24;
const MS_PER_HOUR = 3600000;
const JSON_INDENT = 2;

export class StoreClient {
  private registry_url: string;
  private ttl_ms: number;
  private root: string;
  private fetch_fn: typeof fetch;

  constructor(options: StoreClientOptions) {
    this.registry_url = options.registry_url;
    this.ttl_ms = (options.cache_ttl_hours ?? DEFAULT_TTL_HOURS) *
      MS_PER_HOUR;
    this.root = options.root ?? process.cwd();
    this.fetch_fn = options.fetch_fn ?? fetch;
  }

  /** The registry: fresh cache, then network, then stale cache. */
  async getRegistry(refresh: boolean = false):
  Promise<NanoResult<StoreRegistry>> {
    const CACHED = this.readCache();

    if (
      !refresh &&
      CACHED &&
      Date.now() - CACHED.fetched_at < this.ttl_ms
    ) {
      return ok(CACHED.registry);
    }

    try {
      const RESPONSE = await this.fetch_fn(this.registry_url);

      if (!RESPONSE.ok) {
        throw new Error(`Registry fetch failed: HTTP ${RESPONSE.status}`);
      }

      const PARSED = STORE_REGISTRY_SCHEMA.safeParse(await RESPONSE.json());

      if (!PARSED.success) {
        throw new Error('Registry JSON does not match the store schema.');
      }

      this.writeCache(PARSED.data);
      return ok(PARSED.data);
    } catch (error: unknown) {
      if (CACHED) {
        process.stdout.write(
          `[WARN] Store unreachable (${String(error)}). ` +
          'Serving the stale cache.\n'
        );
        return ok(CACHED.registry);
      }
      return err(error);
    }
  }

  /** Exact-name lookup, with near-miss suggestions in the error. */
  async resolve(
    name: string,
    refresh: boolean = false
  ): Promise<NanoResult<StoreModule>> {
    const REGISTRY = await this.getRegistry(refresh);

    if (!REGISTRY.ok) {
      return err(REGISTRY.error);
    }

    const FOUND = REGISTRY.data.modules.find(
      (module: StoreModule): boolean => {
        return module.name === name;
      }
    );

    if (FOUND) {
      return ok(FOUND);
    }

    const NEAR = REGISTRY.data.modules
      .filter((module: StoreModule): boolean => {
        return module.name.includes(name) || name.includes(module.name);
      })
      .map((module: StoreModule): string => {
        return module.name;
      });
    const HINT = NEAR.length > 0 ? ` Did you mean: ${NEAR.join(', ')}?` : '';
    return err(`Module '${name}' is not in the store.${HINT}`);
  }

  /** Filter the store by name/description/tag text. */
  async search(text?: string): Promise<NanoResult<StoreModule[]>> {
    const REGISTRY = await this.getRegistry();

    if (!REGISTRY.ok) {
      return err(REGISTRY.error);
    }

    if (!text) {
      return ok(REGISTRY.data.modules);
    }

    const NEEDLE = text.toLowerCase();
    return ok(REGISTRY.data.modules.filter(
      (module: StoreModule): boolean => {
        return module.name.toLowerCase().includes(NEEDLE) ||
          module.description.toLowerCase().includes(NEEDLE) ||
          (module.tags ?? []).some((tag: string): boolean => {
            return tag.toLowerCase().includes(NEEDLE);
          });
      }
    ));
  }

  private cachePath(): string {
    return join(this.root, CACHE_DIR, CACHE_FILE);
  }

  private readCache(): CacheFile | null {
    if (!existsSync(this.cachePath())) {
      return null;
    }

    try {
      return JSON.parse(
        readFileSync(this.cachePath(), 'utf8')
      ) as CacheFile;
    } catch {
      return null;
    }
  }

  private writeCache(registry: StoreRegistry): void {
    const FILE = this.cachePath();
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, `${JSON.stringify(
      { fetched_at: Date.now(), registry },
      null,
      JSON_INDENT
    )}\n`);
  }
}

/**
 * Loose semver gate: is the running core at least `min_core`? Only
 * numeric dotted versions are compared; anything else passes open.
 */
export function checkMinCore(
  min_core: string | undefined,
  core_version: string
): boolean {
  if (!min_core) {
    return true;
  }

  const WANTED = min_core.split('.').map(Number);
  const HAVE = core_version.split('.').map(Number);

  if (WANTED.some(Number.isNaN) || HAVE.some(Number.isNaN)) {
    return true;
  }

  for (let index = 0; index < Math.max(WANTED.length, HAVE.length);
    index += 1) {
    const W = WANTED[index] ?? 0;
    const H = HAVE[index] ?? 0;

    if (H > W) {
      return true;
    }

    if (H < W) {
      return false;
    }
  }
  return true;
}
