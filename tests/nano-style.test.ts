import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NANO_LOGO_SMALL_LINES } from '@/constants/logo.js';
import {
  ansiColor,
  getLogoLines,
  getStyle,
  resetStyleCache
} from '@/registry/nano-style.js';

afterEach((): void => {
  resetStyleCache();
});

describe('nano-style', (): void => {
  it('returns hex defaults when nano.style.toml is missing', (): void => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-style-'));
    const STYLE = getStyle(ROOT);

    expect(STYLE.palette.primary).toBe('#C678DD');
    expect(STYLE.tui.border_style).toBe('round');
    expect(STYLE.banner.key_width).toBe(11);
  });

  it('parses hex and named colors from a custom file', (): void => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-style-'));
    writeFileSync(join(ROOT, 'nano.style.toml'), [
      '[palette]',
      'primary = "#FF0000"',
      'accent = "cyan"',
      '',
      '[tui]',
      'border_style = "double"',
    ].join('\n'));

    const STYLE = getStyle(ROOT);

    expect(STYLE.palette.primary).toBe('#FF0000');
    expect(STYLE.palette.accent).toBe('cyan');
    expect(STYLE.palette.success).toBe('#A6DA95');
    expect(STYLE.tui.border_style).toBe('double');
  });

  it('falls back to defaults on an invalid color', (): void => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-style-'));
    writeFileSync(
      join(ROOT, 'nano.style.toml'),
      '[palette]\nprimary = "not-a-color"'
    );

    expect(getStyle(ROOT).palette.primary).toBe('#C678DD');
  });

  it('maps hex to truecolor and names to classic ANSI', (): void => {
    expect(ansiColor('#FF0000')).toBe('[38;2;255;0;0m');
    expect(ansiColor('#0f0')).toBe('[38;2;0;255;0m');
    expect(ansiColor('magenta')).toBe('[35m');
    expect(ansiColor('bogus')).toBe(ansiColor('#C678DD'));
  });

  it('serves the embedded logo when the artwork file is missing',
    (): void => {
      const ROOT = mkdtempSync(join(tmpdir(), 'nano-style-'));
      const LOGO = getLogoLines(ROOT);

      expect(LOGO).toEqual(NANO_LOGO_SMALL_LINES);
    });

  it('reads and caps a custom logo file', (): void => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-style-'));
    writeFileSync(join(ROOT, 'nano.style.toml'), [
      '[logo]',
      'path = "my-logo.txt"',
      'max_width = 5',
    ].join('\n'));
    writeFileSync(join(ROOT, 'my-logo.txt'), 'ABCDEFGHIJ\nXY\n\n');

    expect(getLogoLines(ROOT)).toEqual(['ABCDE', 'XY']);
  });
});
