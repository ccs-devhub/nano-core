import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { RoleChangeSource } from './apply-role-change.js';

/**
 * The member-role ledger (mod_roles_member_roles): one row per
 * grant this module performed or adopted, keyed guild/user/role.
 * The ledger is LIVE STATE (rows leave when the role leaves or the
 * member leaves); snapshots carry history. Every write path goes
 * through these helpers so R2 drift capture, R5 reconcile and the
 * rule engine read one truth.
 */

export interface LedgerRow {
  guild_id: string;
  user_id: string;
  role_id: string;
  source: RoleChangeSource;
  granted_by: string | null;
  granted_at: number;
}

/** Upsert grants: a re-grant refreshes source, actor and time. */
export function recordGrants(
  db: BetterSQLite3Database,
  rows: LedgerRow[]
): void {
  for (const _row of rows) {
    db.run(sql`
      INSERT INTO mod_roles_member_roles
        (guild_id, user_id, role_id, source, granted_by, granted_at)
      VALUES (${_row.guild_id}, ${_row.user_id}, ${_row.role_id},
        ${_row.source}, ${_row.granted_by}, ${_row.granted_at})
      ON CONFLICT (guild_id, user_id, role_id) DO UPDATE SET
        source = excluded.source,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at
    `);
  }
}

/** Delete ledger rows for revoked roles. */
export function removeGrants(
  db: BetterSQLite3Database,
  guild_id: string,
  user_id: string,
  role_ids: string[]
): void {
  for (const _role_id of role_ids) {
    db.run(sql`
      DELETE FROM mod_roles_member_roles
      WHERE guild_id = ${guild_id} AND user_id = ${user_id}
        AND role_id = ${_role_id}
    `);
  }
}

/** Every ledger row for one member, oldest grant first. */
export function memberLedger(
  db: BetterSQLite3Database,
  guild_id: string,
  user_id: string
): LedgerRow[] {
  return db.all(sql`
    SELECT guild_id, user_id, role_id, source, granted_by, granted_at
    FROM mod_roles_member_roles
    WHERE guild_id = ${guild_id} AND user_id = ${user_id}
    ORDER BY granted_at ASC
  `) as LedgerRow[];
}

/** Drop a member's whole ledger (R4: rows leave with the member). */
export function clearMemberLedger(
  db: BetterSQLite3Database,
  guild_id: string,
  user_id: string
): number {
  const RESULT = db.run(sql`
    DELETE FROM mod_roles_member_roles
    WHERE guild_id = ${guild_id} AND user_id = ${user_id}
  `) as { changes?: number };
  return RESULT.changes ?? 0;
}
