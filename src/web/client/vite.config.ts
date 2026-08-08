import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';

import vue from '@vitejs/plugin-vue';

/**
 * The client build config lives INSIDE src/web/client (A10): the
 * docker build context COPY list includes src/ but not arbitrary
 * repo-root files, so a root-level vite config would never enter the
 * fleet image. Assets build under /app/ — the host serves the SPA at
 * /app/* with an index.html history fallback.
 */
const CLIENT_ROOT = fileURLToPath(new URL('.', import.meta.url));
const OUT_DIR = fileURLToPath(
  new URL('../../../dist/web/app', import.meta.url)
);
const DEV_PROXY_TARGET = 'http://127.0.0.1:4777';

export default defineConfig({
  root: CLIENT_ROOT,
  base: '/app/',
  plugins: [vue()],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': DEV_PROXY_TARGET,
      '/auth': DEV_PROXY_TARGET,
    },
  },
});
