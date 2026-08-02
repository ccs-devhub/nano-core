/**
 * C7: the shipped default text layer — general user-facing strings
 * any module needs. THE LAYERING LAW: lookup is config-first,
 * constant-fallback (per-guild templates override these; this is
 * also the i18n seam). THE BOUNDARY: constants hold INVARIANTS only
 * — a value a guild may override belongs in a zod schema default,
 * and log lines stay inline. `{slot}` placeholders are filled by
 * fillSlots() from the barrel.
 */
export const TEXT_GUILD_ONLY =
  'This command can only be used in a server.';
export const TEXT_DISABLED_MODULE =
  'This command belongs to a disabled module.';
export const TEXT_COOLDOWN = 'Slow down, try again in {seconds}s.';
export const TEXT_FOREIGN_BUTTONS =
  'These buttons belong to someone else.';
export const TEXT_CONFIRM_LABEL = 'Confirm';
export const TEXT_CANCEL_LABEL = 'Cancel';
export const TEXT_CONFIRM_CANCELLED = 'Cancelled, nothing was changed.';
export const TEXT_PAGE_PREV = 'Prev';
export const TEXT_PAGE_NEXT = 'Next';
export const TEXT_NONE = 'None';
export const TEXT_NO_DESCRIPTION = 'No description.';
export const TEXT_NOT_CONFIGURED = 'Not configured yet.';
export const TEXT_OWNER_ONLY =
  'Only the bot owner can run this, it affects every server this ' +
  'bot serves.';
export const TEXT_GENERIC_ERROR =
  'Something went wrong while running this command.';
/* The help surface (the house card style). Every string here is
   host-overridable via nano.style.toml [text] (lowercase key). */
/* The index description, four parts in order: greeting (picked at
   random from the pool, replaceable via nano.style.toml [help]
   greetings) -> about -> tip -> commands intro (the last three are
   [text] keys). PROSE LAW for help narrative text: dots and commas
   only, no colons, semicolons or dashes. */
/* Greeting rules, no Discord-colliding words (channel, thread,
   role), connection language only, and every line points at what
   is ACTUALLY happening, the command index loading below. */
export const TEXT_HELP_GREETINGS: string[] = [
  'Connection established, **{user}**. You are linked to the core ' +
  'that runs **{guild}**.',
  'Handshake complete, **{user}**. Retrieving every command the ' +
  'core operates for **{guild}**.',
  'Link online, **{user}**. The core is ready, its command index ' +
  'for **{guild}** loads below.',
];
export const TEXT_HELP_ABOUT =
  'I am **{bot}**, running on **[nano-core]({repo_url})**, a ' +
  'modular bot framework. Every ability I have comes from a ' +
  'module plugged into the core.';
export const TEXT_HELP_TIP =
  '**Tip:** `/help command:<name>` opens any command in detail.';
export const TEXT_HELP_COMMANDS_INTRO =
  'These are the **{count}** commands you can use, grouped by the ' +
  'module that provides them.';
export const TEXT_HELP_PROPERTIES_LABEL = '**Command Properties**';
export const TEXT_HELP_SYNTAX_LABEL = '**Syntax:**';
export const TEXT_HELP_COOLDOWN_LABEL = '**Cooldown:**';
export const TEXT_HELP_EXAMPLES_LABEL = '**Examples:**';
export const TEXT_HELP_MODULE_LABEL = '**Module:**';
export const TEXT_HELP_PERMISSIONS_LABEL = '**Permissions:**';
export const TEXT_HELP_SCOPE_LABEL = '**Scope:**';
export const TEXT_HELP_SCOPE_GUILD = '`Server only`';
export const TEXT_HELP_SCOPE_GLOBAL = '`Everywhere`';
export const TEXT_HELP_NSFW_MARK = ' `NSFW`';
export const TEXT_HELP_EVERYONE = '_***Everyone***_';
export const TEXT_HELP_RESTRICTED = '_***Restricted***_';
export const TEXT_HELP_DISABLED_SUFFIX = ' (disabled)';
/* Card footers (plain text, footers cannot carry markdown or
   links). Core surfaces wear the nano-core identity, everything
   else wears its own module identity. */
export const TEXT_FOOTER_CORE =
  'nano-core v{version} · all systems nominal';
export const TEXT_FOOTER_MODULE =
  '{module} v{version} · module link stable';
