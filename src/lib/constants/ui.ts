/**
 * C7: shared UI symbols — embed color roles, progress glyphs and
 * unicode fallbacks every module renders with. Modules import these
 * from the barrel, never duplicate them.
 */
export const UI_COLOR_SUCCESS = '#57F287';
export const UI_COLOR_ERROR = '#ED4245';
export const UI_COLOR_INFO = '#5865F2';
/**
 * The default embed color: matches Discord's dark-theme embed
 * background so the side bar disappears — cards read as clean
 * panels, not colored notices (the Synchronous noneColor).
 */
export const UI_COLOR_NONE = '#36393F';
/** Invisible field filler for two-column grid layouts. */
export const UI_SPACER = '​';
export const UI_GLYPH_BULLET = '·';
export const UI_GLYPH_BAR_FILLED = '█';
export const UI_GLYPH_BAR_EMPTY = '░';
export const UI_GLYPH_CHECK = 'OK';
export const UI_GLYPH_CROSS = 'X';
