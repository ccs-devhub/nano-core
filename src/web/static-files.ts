import { existsSync, readFileSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join, normalize, resolve, sep } from 'node:path';

/**
 * Traversal-safe static serving for the web host (B15). Lookup roots
 * in order: the built client (dist/web/app) first, then the dev
 * fallback (src/web/static). `/` and unknown `/app/*` paths serve
 * index.html (SPA history fallback); `/assets/*` serves files only.
 * Every candidate path is decoded, normalized, and REQUIRED to stay
 * inside its root — `GET /app/..%2f..%2f.env` is a 404, never a read.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const APP_PREFIX = '/app';

export interface StaticOptions {
  /** Lookup roots, first hit wins. */
  roots: string[];
}

export function defaultStaticRoots(root: string = process.cwd()): string[] {
  return [join(root, 'dist', 'web', 'app'), join(root, 'src', 'web', 'static')];
}

export function contentTypeFor(path: string): string {
  const DOT = path.lastIndexOf('.');
  const EXT = DOT >= 0 ? path.slice(DOT) : '';
  return CONTENT_TYPES[EXT] ?? 'application/octet-stream';
}

/**
 * Resolve a URL path to a real file inside one of the roots. Returns
 * null on traversal attempts, encoding tricks, or a plain miss.
 */
export function resolveStaticFile(
  url_path: string,
  roots: string[]
): string | null {
  let decoded: string;

  try {
    decoded = decodeURIComponent(url_path);
  } catch {
    return null;
  }

  if (decoded.includes('\0')) {
    return null;
  }

  for (const _root of roots) {
    const ROOT = resolve(_root);

    if (!existsSync(ROOT)) {
      continue;
    }

    const CANDIDATE = normalize(join(ROOT, decoded));

    if (CANDIDATE !== ROOT && !CANDIDATE.startsWith(ROOT + sep)) {
      continue;
    }

    if (existsSync(CANDIDATE) && statSync(CANDIDATE).isFile()) {
      return CANDIDATE;
    }
  }
  return null;
}

/**
 * Serve a static route. Returns true when a response was written.
 * Handles `/`, `/app/*` (with the SPA index fallback), and
 * `/assets/*` (files only, no fallback).
 */
export function serveStatic(
  res: ServerResponse,
  pathname: string,
  options: StaticOptions
): boolean {
  const ROOTS = options.roots;
  let lookup: string | null = null;
  let spa_fallback = false;

  if (pathname === '/' || pathname === `${APP_PREFIX}/` ||
      pathname === APP_PREFIX) {
    lookup = '/index.html';
  } else if (pathname.startsWith(`${APP_PREFIX}/`)) {
    lookup = pathname.slice(APP_PREFIX.length);
    spa_fallback = true;
  } else if (pathname.startsWith('/assets/')) {
    lookup = pathname;
  } else {
    return false;
  }

  let file = resolveStaticFile(lookup, ROOTS);

  if (!file && spa_fallback && !lookup.includes('.')) {
    /* vue-router history mode: /app/guilds/123 serves the shell. */
    file = resolveStaticFile('/index.html', ROOTS);
  }

  if (!file) {
    res.writeHead(HTTP_NOT_FOUND, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return true;
  }

  res.writeHead(HTTP_OK, { 'Content-Type': contentTypeFor(file) });
  res.end(readFileSync(file));
  return true;
}
