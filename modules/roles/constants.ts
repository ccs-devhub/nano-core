/**
 * C7: texts owned by the roles module. Core texts come from the
 * package and are never duplicated here. `{slot}` placeholders are
 * filled by fillSlots() from the barrel. THE LAYERING LAW applies:
 * a per-guild template in config overrides any constant below.
 */

export const TEXT_ROLES_DB_REQUIRED =
  'The roles module needs the database service, it stays disabled ' +
  'without one.';

export const TEXT_ROLES_HEALTH_NO_DB =
  'Database unavailable, role state cannot persist.';

export const TEXT_ROLES_HEALTH_READY =
  'Ledger, snapshots and panels storage ready.';

/* Fallback for restore.notice (config-first, constant-fallback). */
export const TEXT_ROLES_RESTORE_NOTICE =
  'Your roles were restored. Roles that no longer exist were ' +
  'skipped, {dropped}.';

/* Pick refusals, sent as a notice or an ephemeral reply. */
export const TEXT_ROLES_PICK_GATE_AGE =
  'Your account is too new for this panel, try again in a few days.';
export const TEXT_ROLES_PICK_GATE_TENURE =
  'You joined this server recently, this panel unlocks after a ' +
  'short wait.';
export const TEXT_ROLES_PICK_GATE_SANCTIONED =
  'This panel is not available to you right now.';
export const TEXT_ROLES_PICK_MAX =
  'You already hold the maximum picks from this panel, remove one ' +
  'first.';
export const TEXT_ROLES_PICK_UNKNOWN =
  'That option is not part of this panel.';
export const TEXT_ROLES_PICK_GRANTED = 'Role granted.';
export const TEXT_ROLES_PICK_REMOVED = 'Role removed.';
