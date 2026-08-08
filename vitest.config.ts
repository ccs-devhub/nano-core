import tsconfig_paths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

import vue from '@vitejs/plugin-vue';

/**
 * Two projects (A9): the core suite runs in node against tests/**;
 * the web client suite runs in happy-dom against the Vue SFCs under
 * src/web/client (which the core tsconfig excludes).
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
    },
    projects: [
      {
        plugins: [tsconfig_paths({ projects: ['./tsconfig.json'] })],
        test: {
          name: 'core',
          environment: 'node',
          include: ['tests/**/*.test.{ts,tsx}'],
        },
      },
      {
        plugins: [vue()],
        test: {
          name: 'web-client',
          environment: 'happy-dom',
          include: ['src/web/client/**/*.test.ts'],
        },
      },
    ],
  },
});
