import { render } from 'ink-testing-library';

import { App } from '@/tui/app.js';

import 'dotenv/config';

/**
 * Headless TUI frame preview for design audits:
 *   npx tsx tests/tui-preview.tsx
 * Renders the app once and prints the dashboard frame without ANSI.
 */
const RENDER_SETTLE_MS = 300;
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

const INSTANCE = render(<App />);
await new Promise((resolve: (value: unknown) => void): void => {
  setTimeout(resolve, RENDER_SETTLE_MS);
});

/* Optional: pass keys (e.g. 6 or 2s) and an extra settle in ms. */
const KEYS = process.argv[2] ?? '';
const EXTRA_SETTLE = Number(process.argv[3] ?? 0);

for (const _key of KEYS) {
  INSTANCE.stdin.write(_key);
  await new Promise((resolve: (value: unknown) => void): void => {
    setTimeout(resolve, RENDER_SETTLE_MS);
  });
}

if (EXTRA_SETTLE > 0) {
  await new Promise((resolve: (value: unknown) => void): void => {
    setTimeout(resolve, EXTRA_SETTLE);
  });
}

const FRAME = INSTANCE.lastFrame() ?? '';
INSTANCE.unmount();
process.stdout.write(`${FRAME.replace(ANSI, '')}\n`);
process.exit(0);
