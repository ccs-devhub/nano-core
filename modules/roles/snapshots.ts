import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * The snapshot store (mod_roles_snapshots): history, never live
 * state. R4 writes a row when a member leaves; R3 reads the latest
 * pending row on rejoin and stamps it done after the restore PATCH.
 * A row that stays pending is VISIBLE state (health metric), never
 * silently resolved.
 */

export type SnapshotReason =
  | 'leave'
  | 'kick'
  | 'ban'
  | 'unknown'
  | 'pre_sanction'
  | 'manual';

export type RestoreState = 'none' | 'pending' | 'done';

/** One stored role: managed is MARKED here, excluded at restore. */
export interface SnapshotRole {
  id: string;
  name: string;
  managed: boolean;
}

export interface SnapshotRow {
  guild_id: string;
  user_id: string;
  taken_at: number;
  roles_json: string;
  reason: SnapshotReason;
  actor_id: string | null;
  partial: number;
  restore_state: RestoreState;
  restored_at: number | null;
}

/** The newest pending snapshot for one member, or null. */
export function latestPendingSnapshot(
  db: BetterSQLite3Database,
  guild_id: string,
  user_id: string
): SnapshotRow | null {
  const ROWS = db.all(sql`
    SELECT guild_id, user_id, taken_at, roles_json, reason,
      actor_id, partial, restore_state, restored_at
    FROM mod_roles_snapshots
    WHERE guild_id = ${guild_id} AND user_id = ${user_id}
      AND restore_state = 'pending'
    ORDER BY taken_at DESC
    LIMIT 1
  `) as SnapshotRow[];
  return ROWS[0] ?? null;
}

/** Every pending snapshot, newest first (the onEnable rescan). */
export function pendingSnapshots(
  db: BetterSQLite3Database
): SnapshotRow[] {
  return db.all(sql`
    SELECT guild_id, user_id, taken_at, roles_json, reason,
      actor_id, partial, restore_state, restored_at
    FROM mod_roles_snapshots
    WHERE restore_state = 'pending'
    ORDER BY taken_at DESC
  `) as SnapshotRow[];
}

/** Pending-restore count for the health metrics. */
export function countPendingSnapshots(
  db: BetterSQLite3Database
): number {
  const ROWS = db.all(sql`
    SELECT COUNT(*) AS pending FROM mod_roles_snapshots
    WHERE restore_state = 'pending'
  `) as { pending: number }[];
  return ROWS[0]?.pending ?? 0;
}

export function setSnapshotState(
  db: BetterSQLite3Database,
  guild_id: string,
  user_id: string,
  taken_at: number,
  state: RestoreState,
  restored_at?: number
): void {
  db.run(sql`
    UPDATE mod_roles_snapshots
    SET restore_state = ${state},
      restored_at = ${restored_at ?? null}
    WHERE guild_id = ${guild_id} AND user_id = ${user_id}
      AND taken_at = ${taken_at}
  `);
}

/**
 * Parse a stored roles_json. Null on garbage — the caller logs and
 * leaves the row pending rather than restoring from a broken record.
 */
export function parseSnapshotRoles(
  roles_json: string
): SnapshotRole[] | null {
  try {
    const PARSED: unknown = JSON.parse(roles_json);

    if (!Array.isArray(PARSED)) {
      return null;
    }

    const ROLES: SnapshotRole[] = [];

    for (const _entry of PARSED) {
      const CANDIDATE = _entry as Partial<SnapshotRole>;

      if (typeof CANDIDATE.id !== 'string') {
        return null;
      }

      ROLES.push({
        id: CANDIDATE.id,
        name: typeof CANDIDATE.name === 'string'
          ? CANDIDATE.name
          : CANDIDATE.id,
        managed: CANDIDATE.managed === true,
      });
    }
    return ROLES;
  } catch {
    return null;
  }
}
