import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parse } from 'smol-toml';
import { z } from 'zod';

import { NANO_LOGO_SMALL_LINES } from '@/constants/logo.js';

/**
 * nano.style.toml — the single source of truth for colors, palettes,
 * logo artwork, and layout thresholds shared by the boot banner and
 * the TUI. Missing file or fields fall back to safe defaults; the
 * logo falls back to the embedded artwork when its file is absent
 * (npm installs ship only dist/).
 */
const COLOR_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'gray',
] as const;

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Hex (#RRGGBB or #RGB) is canonical; terminal names stay accepted. */
const COLOR_SCHEMA = z.union([
  z.string().regex(HEX_COLOR_PATTERN),
  z.enum(COLOR_NAMES),
]);

const DEFAULT_PRIMARY = '#C678DD';
const DEFAULT_ACCENT = '#B4A7E5';
const DEFAULT_SUCCESS = '#A6DA95';
const DEFAULT_ERROR = '#ED8796';
const DEFAULT_WARNING = '#EED49F';

const DEFAULT_LOGO_MAX_WIDTH = 40;
const DEFAULT_MIN_COLUMNS = 84;
const DEFAULT_KEY_WIDTH = 11;
const DEFAULT_RULE_WIDTH = 24;
const DEFAULT_LOGO_MIN_ROWS = 26;

export const NANO_STYLE_SCHEMA = z.object({
  palette: z.object({
    primary: COLOR_SCHEMA.default(DEFAULT_PRIMARY),
    accent: COLOR_SCHEMA.default(DEFAULT_ACCENT),
    success: COLOR_SCHEMA.default(DEFAULT_SUCCESS),
    error: COLOR_SCHEMA.default(DEFAULT_ERROR),
    warning: COLOR_SCHEMA.default(DEFAULT_WARNING),
  }).default({
    primary: DEFAULT_PRIMARY,
    accent: DEFAULT_ACCENT,
    success: DEFAULT_SUCCESS,
    error: DEFAULT_ERROR,
    warning: DEFAULT_WARNING,
  }),
  logo: z.object({
    path: z.string().default('.github/logo-nano-core-small.txt'),
    full_path: z.string().default('.github/logo-nano-core.txt'),
    color: COLOR_SCHEMA.default(DEFAULT_PRIMARY),
    max_width: z.number().default(DEFAULT_LOGO_MAX_WIDTH),
  }).default({
    path: '.github/logo-nano-core-small.txt',
    full_path: '.github/logo-nano-core.txt',
    color: DEFAULT_PRIMARY,
    max_width: DEFAULT_LOGO_MAX_WIDTH,
  }),
  banner: z.object({
    side_by_side_min_columns: z.number().default(DEFAULT_MIN_COLUMNS),
    key_width: z.number().default(DEFAULT_KEY_WIDTH),
    rule_width: z.number().default(DEFAULT_RULE_WIDTH),
  }).default({
    side_by_side_min_columns: DEFAULT_MIN_COLUMNS,
    key_width: DEFAULT_KEY_WIDTH,
    rule_width: DEFAULT_RULE_WIDTH,
  }),
  tui: z.object({
    border_style: z.enum(
      ['single', 'double', 'round', 'bold', 'classic']
    ).default('round'),
    logo_min_rows: z.number().default(DEFAULT_LOGO_MIN_ROWS),
    logo_min_columns: z.number().default(DEFAULT_MIN_COLUMNS),
  }).default({
    border_style: 'round',
    logo_min_rows: DEFAULT_LOGO_MIN_ROWS,
    logo_min_columns: DEFAULT_MIN_COLUMNS,
  }),
});

export type NanoStyle = z.infer<typeof NANO_STYLE_SCHEMA>;

export const STYLE_FILE_NAME = 'nano.style.toml';

const ANSI_BY_COLOR: Record<string, string> = {
  black: '[30m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  blue: '[34m',
  magenta: '[35m',
  cyan: '[36m',
  white: '[37m',
  gray: '[90m',
};

let cached_style: NanoStyle | null = null;
let cached_root: string | null = null;

/** Load nano.style.toml (defaults on absence or errors). Cached. */
export function getStyle(root: string = process.cwd()): NanoStyle {
  if (cached_style && cached_root === root) {
    return cached_style;
  }

  cached_root = root;
  cached_style = loadStyleFile(root);
  return cached_style;
}

/** Drop the cache (tests, or after the TUI edits the file). */
export function resetStyleCache(): void {
  cached_style = null;
  cached_root = null;
}

/**
 * The logo to render: the configured artwork file, truncated to
 * `max_width`, or the embedded small logo when the file is missing.
 */
export function getLogoLines(root: string = process.cwd()): string[] {
  const STYLE = getStyle(root);
  const FILE = resolve(root, STYLE.logo.path);
  const RAW = existsSync(FILE)
    ? readFileSync(FILE, 'utf8').split('\n')
    : [...NANO_LOGO_SMALL_LINES];

  while (RAW.length > 0 && !RAW[RAW.length - 1].trim()) {
    RAW.pop();
  }
  return RAW.map((line: string): string => {
    return line.slice(0, STYLE.logo.max_width).replace(/\s+$/, '');
  });
}

const HEX_SHORT_LENGTH = 3;
const HEX_BASE = 16;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;
const CHANNEL_MASK = 255;

/**
 * The ANSI escape for a palette color (banner rendering): truecolor
 * for hex values, the classic 16-color escape for named colors.
 */
export function ansiColor(color: string): string {
  if (color.startsWith('#')) {
    const RGB = hexToRgb(color);

    if (RGB) {
      const [R, G, B] = RGB;
      return `\u001b[38;2;${R};${G};${B}m`;
    }
  }
  return ANSI_BY_COLOR[color] ?? ansiColor(DEFAULT_PRIMARY);
}

function hexToRgb(hex: string): [number, number, number] | null {
  const CLEAN = hex.replace('#', '');
  const FULL = CLEAN.length === HEX_SHORT_LENGTH
    ? CLEAN.split('').map((digit: string): string => {
      return digit + digit;
    })
      .join('')
    : CLEAN;

  if (!/^[0-9a-fA-F]{6}$/.test(FULL)) {
    return null;
  }

  const VALUE = Number.parseInt(FULL, HEX_BASE);
  return [
    (VALUE >> RED_SHIFT) & CHANNEL_MASK,
    (VALUE >> GREEN_SHIFT) & CHANNEL_MASK,
    VALUE & CHANNEL_MASK,
  ];
}

function loadStyleFile(root: string): NanoStyle {
  const STYLE_PATH = join(root, STYLE_FILE_NAME);

  if (!existsSync(STYLE_PATH)) {
    return NANO_STYLE_SCHEMA.parse({});
  }

  try {
    const PARSED = NANO_STYLE_SCHEMA.safeParse(
      parse(readFileSync(STYLE_PATH, 'utf8'))
    );

    if (!PARSED.success) {
      process.stdout.write(
        `[WARN] Invalid ${STYLE_FILE_NAME} — using default styling.\n`
      );
      return NANO_STYLE_SCHEMA.parse({});
    }
    return PARSED.data;
  } catch (error: unknown) {
    process.stdout.write(
      `[WARN] Unreadable ${STYLE_FILE_NAME}: ${String(error)}. ` +
      'Using default styling.\n'
    );
    return NANO_STYLE_SCHEMA.parse({});
  }
}
