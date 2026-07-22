import { describe, expect, it } from 'vitest';

import type { BannerInfo } from '@/misc/utility/banner.js';
import { buildBannerLines } from '@/misc/utility/banner.js';
import { getLogoLines, resetStyleCache } from '@/registry/nano-style.js';

const INFO: BannerInfo = {
  version: '0.1.0',
  bot_name: 'nano-bot',
  node_version: 'v25.0.0',
  discordjs_version: '14.25.1',
  modules: ['nano', 'core', 'synapse'],
  intents: ['Guilds'],
  database: 'sqlite',
};

describe('buildBannerLines', (): void => {
  it('renders side by side on wide terminals', (): void => {
    resetStyleCache();
    const LOGO = getLogoLines();
    const LINES = buildBannerLines(INFO, 140, false);

    expect(LINES.length).toBe(Math.max(LOGO.length, 9));
    expect(LINES.join('\n')).toContain('nano-core v0.1.0');
    expect(LINES.join('\n')).toContain('nano, core, synapse');
    expect(LINES.join('\n')).toContain('sqlite');
  });

  it('stacks logo and info on narrow terminals', (): void => {
    resetStyleCache();
    const LOGO = getLogoLines();
    const LINES = buildBannerLines(INFO, 60, false);

    expect(LINES.length).toBeGreaterThan(LOGO.length);
    expect(LINES.join('\n')).toContain('nano-core v0.1.0');
  });

  it('emits no ANSI codes when color is off', (): void => {
    const LINES = buildBannerLines(INFO, 140, false);

    expect(LINES.join('')).not.toContain('[');
  });

  it('emits ANSI codes when color is on', (): void => {
    const LINES = buildBannerLines(INFO, 140, true);

    expect(LINES.join('')).toContain('[');
  });

  it('respects the logo max_width cap', (): void => {
    resetStyleCache();
    const LOGO = getLogoLines();
    const WIDEST = Math.max(...LOGO.map((line: string): number => {
      return line.length;
    }));

    expect(WIDEST).toBeLessThanOrEqual(40);
  });
});
