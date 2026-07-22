import type { ColorResolvable } from 'discord.js';

import type { NanoResult } from '@/types/nano-result.js';
import { ok } from '@/types/nano-result.js';

/**
 * A named visual identity for embeds. Style modules register themes on
 * enable; any command can then reference a theme by name.
 */
export interface NanoTheme {
  name: string;
  color: ColorResolvable;
  footer_text?: string;
  footer_icon_url?: string;
}

export const DEFAULT_THEME: NanoTheme = {
  name: 'nano',
  color: '#5865F2',
};

const THEMES: Map<string, NanoTheme> = new Map([
  [DEFAULT_THEME.name, DEFAULT_THEME],
]);

/** Register (or overwrite) a theme that embeds can reference by name. */
export function registerTheme(theme: NanoTheme): NanoResult<string> {
  THEMES.set(theme.name, theme);
  return ok(theme.name);
}

/** Resolve a theme by name, falling back to the default theme. */
export function getTheme(theme_name?: string): NanoTheme {
  if (!theme_name) {
    return DEFAULT_THEME;
  }
  return THEMES.get(theme_name) ?? DEFAULT_THEME;
}

/** List all registered theme names. */
export function listThemes(): string[] {
  return Array.from(THEMES.keys());
}
