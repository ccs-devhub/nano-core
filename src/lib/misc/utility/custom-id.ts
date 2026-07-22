/**
 * The customId routing convention for message components and modals:
 * `module:action:...args`. Discord caps customIds at 100 characters —
 * enforced here at build time so it never fails silently at runtime.
 */
export interface ParsedCustomId {
  module: string;
  action: string;
  args: string[];
}

const MAX_CUSTOM_ID_LENGTH = 100;
const ERROR_PREVIEW_LENGTH = 40;
const SEPARATOR = ':';

/** Compose a routable customId. Throws when over Discord's 100 chars. */
export function buildCustomId(
  module_name: string,
  action: string,
  ...args: string[]
): string {
  const CUSTOM_ID = [module_name, action, ...args].join(SEPARATOR);

  if (CUSTOM_ID.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error(
      `customId '${CUSTOM_ID.slice(0, ERROR_PREVIEW_LENGTH)}...' exceeds ` +
      `${MAX_CUSTOM_ID_LENGTH} characters. Store state server-side ` +
      'and pass a key instead.'
    );
  }
  return CUSTOM_ID;
}

/** Split a customId back into module, action, and args. */
export function parseCustomId(custom_id: string): ParsedCustomId | null {
  const [MODULE, ACTION, ...ARGS] = custom_id.split(SEPARATOR);

  if (!MODULE || !ACTION) {
    return null;
  }
  return { module: MODULE, action: ACTION, args: ARGS };
}
