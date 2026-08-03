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
