import { describe, expect, it } from 'vitest';

import { buildEmbed } from '@/api/embed.js';
import { DEFAULT_THEME, getTheme, listThemes, registerTheme } from
  '@/api/theme.js';

describe('theme registry', (): void => {
  it('falls back to the default theme', (): void => {
    expect(getTheme()).toEqual(DEFAULT_THEME);
    expect(getTheme('does-not-exist')).toEqual(DEFAULT_THEME);
  });

  it('registers and resolves custom themes', (): void => {
    const RESULT = registerTheme({
      name: 'test-theme',
      color: '#FF0000',
      footer_text: 'themed footer',
    });

    expect(RESULT.ok).toBe(true);
    expect(getTheme('test-theme').color).toBe('#FF0000');
    expect(listThemes()).toContain('test-theme');
  });
});

describe('buildEmbed', (): void => {
  it('applies spec fields and theme color', (): void => {
    const EMBED = buildEmbed({
      title: 'Hello',
      description: 'World',
      fields: [{ name: 'a', value: 'b', inline: true }],
    });

    expect(EMBED.data.title).toBe('Hello');
    expect(EMBED.data.description).toBe('World');
    expect(EMBED.data.fields).toEqual([
      { name: 'a', value: 'b', inline: true },
    ]);
    expect(EMBED.data.color).toBe(0x36393F);
  });

  it('prefers the named theme and its footer', (): void => {
    registerTheme({
      name: 'footer-theme',
      color: '#00FF00',
      footer_text: 'from theme',
    });

    const EMBED = buildEmbed({ title: 'x' }, 'footer-theme');

    expect(EMBED.data.color).toBe(0x00FF00);
    expect(EMBED.data.footer?.text).toBe('from theme');
  });

  it('lets an explicit spec color override the theme', (): void => {
    const EMBED = buildEmbed({ title: 'x', color: '#0000FF' }, 'footer-theme');

    expect(EMBED.data.color).toBe(0x0000FF);
  });
});

describe('gridFields', (): void => {
  it('lays pairs out as two columns with a spacer third slot',
    async (): Promise<void> => {
      const { gridFields: GRID_FIELDS, spacerField: SPACER_FIELD } =
        await import('@/api/embed.js');
      const GRID = GRID_FIELDS([
        { name: 'a', value: '1' },
        { name: 'b', value: '2' },
        { name: 'c', value: '3' },
      ]);

      expect(GRID).toHaveLength(4);
      expect(GRID[0]).toEqual({ name: 'a', value: '1', inline: true });
      expect(GRID[1]).toEqual({ name: 'b', value: '2', inline: true });
      expect(GRID[2]).toEqual(SPACER_FIELD());
      /* the odd tail gets its own row, no trailing spacer */
      expect(GRID[3]).toEqual({ name: 'c', value: '3', inline: true });
    });
});
