import { ansiColor, getLogoLines, getStyle } from
  '@/registry/nano-style.js';

/**
 * The fastfetch-style boot banner: project logo on the left, a
 * key/value info column on the right (vertically centered). Layout,
 * palette, and artwork all come from nano.style.toml. Falls back to
 * stacking when the terminal is narrow, and to plain text when not a
 * TTY.
 */
export interface BannerInfo {
  version: string;
  bot_name: string;
  node_version: string;
  discordjs_version: string;
  modules: string[];
  intents: string[];
  database: string;
  dev_guild_id?: string;
}

const ANSI_RESET = '\u001b[0m';
const ANSI_BOLD = '\u001b[1m';
const ANSI_DIM = '\u001b[2m';
const GAP = '   ';
const CENTER_DIVISOR = 2;

export function buildBannerLines(
  info: BannerInfo,
  columns: number = process.stdout.columns ?? 0,
  color: boolean = process.stdout.isTTY ?? false,
  root: string = process.cwd()
): string[] {
  const STYLE = getStyle(root);
  const LOGO = getLogoLines(root);
  const LOGO_WIDTH = Math.max(
    ...LOGO.map((line: string): number => {
      return line.length;
    }),
    0
  );
  const PAINT = (code: string, text: string): string => {
    return color ? `${code}${text}${ANSI_RESET}` : text;
  };
  const KEY = (name: string): string => {
    return PAINT(
      ANSI_BOLD + ansiColor(STYLE.palette.accent),
      name.padEnd(STYLE.banner.key_width)
    );
  };
  const LOGO_COLOR = ansiColor(STYLE.logo.color);
  const INFO_LINES = [
    PAINT(
      ANSI_BOLD + ansiColor(STYLE.palette.primary),
      `nano-core v${info.version}`
    ),
    PAINT(ANSI_DIM, '-'.repeat(STYLE.banner.rule_width)),
    `${KEY('bot')}${info.bot_name}`,
    `${KEY('node')}${info.node_version}`,
    `${KEY('discord.js')}v${info.discordjs_version}`,
    `${KEY('modules')}${info.modules.join(', ')}`,
    `${KEY('intents')}${info.intents.join(', ')}`,
    `${KEY('database')}${info.database}`,
    `${KEY('commands')}guild scope: ${info.dev_guild_id ?? 'global'}`,
    '',
    `${PAINT(ansiColor(STYLE.palette.primary), '▣')} ${PAINT(
      ANSI_DIM,
      'Cyber Code Syndicate (CCS)'
    )}`,
  ];

  if (columns < STYLE.banner.side_by_side_min_columns) {
    return [
      ...LOGO.map((line: string): string => {
        return PAINT(LOGO_COLOR, line);
      }),
      '',
      ...INFO_LINES,
    ];
  }

  /* Side by side: the taller block centers the shorter one. */
  const TOTAL = Math.max(LOGO.length, INFO_LINES.length);
  const LOGO_OFFSET = Math.floor((TOTAL - LOGO.length) / CENTER_DIVISOR);
  const INFO_OFFSET = Math.floor((TOTAL - INFO_LINES.length) / CENTER_DIVISOR);
  const LINES: string[] = [];

  for (let index = 0; index < TOTAL; index += 1) {
    const LOGO_LINE = LOGO[index - LOGO_OFFSET] ?? '';
    const INFO_LINE = INFO_LINES[index - INFO_OFFSET] ?? '';
    const LEFT = PAINT(LOGO_COLOR, LOGO_LINE.padEnd(LOGO_WIDTH));
    LINES.push(`${LEFT}${INFO_LINE ? GAP + INFO_LINE : ''}`);
  }
  return LINES;
}

/** Print the banner once at bot boot. */
export function printBootBanner(info: BannerInfo): void {
  process.stdout.write(`\n${buildBannerLines(info).join('\n')}\n\n`);
}
