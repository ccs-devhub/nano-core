import { applyRoleChange } from './apply-role-change.js';
import { privilegedPermissionNames } from './command.js';
import type { RolesConfig } from './config.js';
import {
  TEXT_ROLES_RESTORE_NONE_DROPPED,
  TEXT_ROLES_RESTORE_NOTICE
} from './constants.js';
import {
  latestPendingSnapshot,
  parseSnapshotRoles,
  pendingSnapshots,
  setSnapshotState
} from './snapshots.js';

import type { Client, NanoResult } from '@ccs-devhub/nano-core';
import {
  fillSlots,
  getModuleLogger,
  sendMemberNotice
} from '@ccs-devhub/nano-core';

/**
 * R3, the join pipeline: entry role on first join, rejoin restore
 * from the latest pending snapshot. The one-shot is convenience —
 * the snapshot table's restore_state is the durable truth, and the
 * onEnable rescan re-arms whatever a crash or downtime dropped
 * (N2/N3). Job names are per-entity (restore:<guild>:<user>) so a
 * mass-join never collides (PF2-5/DB19).
 */

const MODULE_NAME = 'roles';
const MS_PER_SECOND = 1000;

export interface JoinMemberLike {
  id: string;
  guild: { id: string };
  roles?: { cache: { map<T>(cb: (role: { id: string }) => T): T[] } };
}

/** Payload of the persisted restore one-shot. seen null = execute
    at fire without the settle comparison (the rescan path). */
export interface RestorePayload {
  guild_id: string;
  user_id: string;
  rearms_left: number;
  seen: string[] | null;
}

interface SanctionsApi {
  getActiveSanctions(
    guild_id: string,
    user_id: string
  ): Promise<NanoResult<string[]>> | NanoResult<string[]>;
}

/**
 * N13: active sanction ROLE ids from the moderation module, lazily
 * resolved at every call. Absent or broken module = empty set. The
 * amended EX11 (re-issuing a remaining native timeout) rides the
 * moderation module's own rejoin handling when P3 lands — a role
 * module cannot re-issue what it has no case data for.
 */
async function activeSanctions(
  bot: Client,
  guild_id: string,
  user_id: string
): Promise<string[]> {
  const API = bot.nano.getModuleApi('moderation') as
    SanctionsApi | undefined;

  if (!API || typeof API.getActiveSanctions !== 'function') {
    return [];
  }

  try {
    const RESULT = await API.getActiveSanctions(guild_id, user_id);
    return RESULT.ok ? RESULT.data : [];
  } catch {
    return [];
  }
}

function restoreJobName(guild_id: string, user_id: string): string {
  return `restore:${guild_id}:${user_id}`;
}

function sameRoleSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const RIGHT_SET = new Set(right);
  return left.every((role_id: string): boolean => {
    return RIGHT_SET.has(role_id);
  });
}

/**
 * Arm the persistent settle one-shot. A duplicate name means the
 * member is already armed — the refusal is the dedupe (PF2-5).
 */
export function armRestore(
  bot: Client,
  guild_id: string,
  user_id: string,
  seen: string[] | null,
  rearms_left: number
): void {
  const CONFIG = bot.services.guild_store
    .getGuildModuleConfig<RolesConfig>(guild_id, MODULE_NAME);
  const PAYLOAD: RestorePayload = {
    guild_id,
    user_id,
    rearms_left,
    seen,
  };
  const ARMED = bot.services.scheduler.scheduleOnce(
    MODULE_NAME,
    restoreJobName(guild_id, user_id),
    CONFIG.restore.settle_window_s * MS_PER_SECOND,
    (payload?: unknown): Promise<void> => {
      return runRestore(bot, payload);
    },
    { persistent: true, payload: PAYLOAD }
  );

  if (ARMED.ok) {
    getModuleLogger(MODULE_NAME).info(
      { guild_id, user_id, rearms_left },
      'Rejoin restore armed'
    );
  }
}

/**
 * guildMemberAdd: a pending snapshot arms the restore, otherwise a
 * configured entry role is granted unless the member carries an
 * active sanction.
 */
export async function handleMemberAdd(
  bot: Client,
  member: JoinMemberLike
): Promise<void> {
  const DATABASE = bot.services.database;

  if (!DATABASE) {
    return;
  }

  const GUILD_ID = member.guild.id;
  const CONFIG = bot.services.guild_store
    .getGuildModuleConfig<RolesConfig>(GUILD_ID, MODULE_NAME);

  if (!CONFIG.enabled) {
    return;
  }

  const SNAPSHOT = latestPendingSnapshot(
    DATABASE.getDb(),
    GUILD_ID,
    member.id
  );

  if (SNAPSHOT && CONFIG.restore.enabled) {
    const SEEN = member.roles?.cache.map(
      (role: { id: string }): string => {
        return role.id;
      }
    ) ?? [];
    armRestore(
      bot,
      GUILD_ID,
      member.id,
      SEEN,
      CONFIG.restore.max_rearms
    );
    return;
  }

  if (!CONFIG.entry_role_id) {
    return;
  }

  const SANCTIONS = await activeSanctions(bot, GUILD_ID, member.id);

  if (SANCTIONS.length > 0) {
    getModuleLogger(MODULE_NAME).info(
      { guild_id: GUILD_ID, user_id: member.id },
      'Entry role skipped, member is under an active sanction'
    );
    return;
  }

  const RESULT = await applyRoleChange(
    bot,
    GUILD_ID,
    member.id,
    { add: [CONFIG.entry_role_id] },
    'entry'
  );

  if (!RESULT.ok) {
    getModuleLogger(MODULE_NAME).warn(
      { guild_id: GUILD_ID, user_id: member.id, error: RESULT.error },
      'Entry role grant failed'
    );
  }
}

function parsePayload(payload: unknown): RestorePayload | null {
  const CANDIDATE = payload as Partial<RestorePayload> | null;

  if (
    !CANDIDATE ||
    typeof CANDIDATE.guild_id !== 'string' ||
    typeof CANDIDATE.user_id !== 'string' ||
    typeof CANDIDATE.rearms_left !== 'number'
  ) {
    return null;
  }
  return {
    guild_id: CANDIDATE.guild_id,
    user_id: CANDIDATE.user_id,
    rearms_left: CANDIDATE.rearms_left,
    seen: Array.isArray(CANDIDATE.seen) ? CANDIDATE.seen : null,
  };
}

/**
 * The settle one-shot handler: while onboarding picks are still
 * landing (the role set moved since arming) re-arm bounded, then
 * execute. A member who left again leaves the row visibly pending.
 */
export async function runRestore(
  bot: Client,
  payload: unknown
): Promise<void> {
  const PARSED = parsePayload(payload);
  const LOGGER = getModuleLogger(MODULE_NAME);

  if (!PARSED) {
    LOGGER.error({ payload }, 'Restore payload unreadable, dropped');
    return;
  }

  const DATABASE = bot.services.database;

  if (!DATABASE) {
    return;
  }

  const CONFIG = bot.services.guild_store
    .getGuildModuleConfig<RolesConfig>(PARSED.guild_id, MODULE_NAME);

  if (!CONFIG.enabled || !CONFIG.restore.enabled) {
    return;
  }

  let current: string[];

  try {
    const GUILD = await bot.guilds.fetch(PARSED.guild_id);
    const MEMBER = await GUILD.members.fetch(PARSED.user_id);
    current = MEMBER.roles.cache.map(
      (role: { id: string }): string => {
        return role.id;
      }
    );
  } catch {
    /* 10007: gone again before the settle fired. The snapshot row
       stays pending and the next join re-arms it. */
    LOGGER.info(
      { guild_id: PARSED.guild_id, user_id: PARSED.user_id },
      'Restore deferred, member is no longer in the guild'
    );
    return;
  }

  if (
    PARSED.seen !== null &&
    !sameRoleSet(current, PARSED.seen) &&
    PARSED.rearms_left > 0
  ) {
    armRestore(
      bot,
      PARSED.guild_id,
      PARSED.user_id,
      current,
      PARSED.rearms_left - 1
    );
    return;
  }

  await executeRestore(bot, PARSED.guild_id, PARSED.user_id, current);
}

/**
 * ADDITIVE-UNION (N8): target = union(current, stored minus
 * never_restore minus managed minus deleted minus EX9-privileged),
 * active sanctions ALWAYS re-applied on top, ONE PATCH through the
 * shared write path with source 'restore'. Failure leaves the row
 * pending; success stamps it done and notifies the member with the
 * dropped-deleted roles.
 */
async function executeRestore(
  bot: Client,
  guild_id: string,
  user_id: string,
  current: string[]
): Promise<void> {
  const LOGGER = getModuleLogger(MODULE_NAME);
  const DATABASE = bot.services.database;

  if (!DATABASE) {
    return;
  }

  const SNAPSHOT = latestPendingSnapshot(
    DATABASE.getDb(),
    guild_id,
    user_id
  );

  if (!SNAPSHOT) {
    return;
  }

  const STORED = parseSnapshotRoles(SNAPSHOT.roles_json);

  if (!STORED) {
    LOGGER.error(
      { guild_id, user_id, taken_at: SNAPSHOT.taken_at },
      'Snapshot roles unreadable, row left pending'
    );
    return;
  }

  const CONFIG = bot.services.guild_store
    .getGuildModuleConfig<RolesConfig>(guild_id, MODULE_NAME);
  const GUILD = await bot.guilds.fetch(guild_id);
  const ADD: string[] = [];
  const DROPPED_DELETED: string[] = [];
  const DROPPED_PRIVILEGED: string[] = [];

  for (const _stored of STORED) {
    if (_stored.managed || _stored.id === guild_id) {
      continue;
    }

    if (CONFIG.never_restore.includes(_stored.id)) {
      continue;
    }

    let live: {
      permissions: { toArray(): string[] };
    } | null;

    try {
      live = await GUILD.roles.fetch(_stored.id);
    } catch {
      live = null;
    }

    if (!live) {
      DROPPED_DELETED.push(_stored.name);
      continue;
    }

    /* EX9: permissions may have GROWN since the snapshot — a role
       that carries privileged permissions NOW is never restored by
       automation; a moderator hands it back through /roles grant
       and its confirm listing. */
    if (privilegedPermissionNames(live.permissions.toArray())
      .length > 0) {
      DROPPED_PRIVILEGED.push(_stored.name);
      continue;
    }

    if (!current.includes(_stored.id) && !ADD.includes(_stored.id)) {
      ADD.push(_stored.id);
    }
  }

  const SANCTIONS = await activeSanctions(bot, guild_id, user_id);

  for (const _sanction of SANCTIONS) {
    if (!current.includes(_sanction) && !ADD.includes(_sanction)) {
      ADD.push(_sanction);
    }
  }

  if (DROPPED_PRIVILEGED.length > 0) {
    LOGGER.warn(
      { guild_id, user_id, roles: DROPPED_PRIVILEGED },
      'Restore skipped roles carrying privileged permissions (EX9)'
    );
  }

  const RESULT = await applyRoleChange(
    bot,
    guild_id,
    user_id,
    { add: ADD },
    'restore',
    undefined,
    { allow_sanctions: SANCTIONS }
  );

  if (!RESULT.ok) {
    /* 50013 and friends: visibly pending, never silently done. */
    LOGGER.warn(
      { guild_id, user_id, error: RESULT.error },
      'Restore PATCH failed, snapshot row stays pending'
    );
    return;
  }

  setSnapshotState(
    DATABASE.getDb(),
    guild_id,
    user_id,
    SNAPSHOT.taken_at,
    'done',
    Date.now()
  );

  if (RESULT.data.refused.length > 0) {
    LOGGER.warn(
      { guild_id, user_id, refused: RESULT.data.refused },
      'Restore applied with refusals'
    );
  }

  if (
    RESULT.data.applied_add.length === 0 &&
    DROPPED_DELETED.length === 0
  ) {
    return;
  }

  const TEMPLATE = CONFIG.restore.notice ?? TEXT_ROLES_RESTORE_NOTICE;
  const DROPPED = DROPPED_DELETED.length > 0
    ? DROPPED_DELETED.join(' · ')
    : TEXT_ROLES_RESTORE_NONE_DROPPED;
  const NOTICE = await sendMemberNotice(
    bot,
    user_id,
    fillSlots(TEMPLATE, { dropped: DROPPED })
  );

  if (!NOTICE.ok) {
    LOGGER.info(
      { guild_id, user_id, error: NOTICE.error },
      'Restore notice undeliverable'
    );
  }
}

/**
 * onEnable rescan (N2/N3): every pending snapshot re-arms its
 * one-shot at now+settle with seen null (execute at fire). Arming
 * only touches the scheduler, so it is safe before login; duplicate
 * names mean a persisted job already fired the arm.
 */
export function rescanPendingRestores(bot: Client): number {
  const DATABASE = bot.services.database;

  if (!DATABASE) {
    return 0;
  }

  const SEEN_MEMBERS = new Set<string>();
  let armed = 0;

  for (const _row of pendingSnapshots(DATABASE.getDb())) {
    const KEY = `${_row.guild_id}:${_row.user_id}`;

    if (SEEN_MEMBERS.has(KEY)) {
      continue;
    }

    SEEN_MEMBERS.add(KEY);

    const CONFIG = bot.services.guild_store
      .getGuildModuleConfig<RolesConfig>(_row.guild_id, MODULE_NAME);

    if (!CONFIG.enabled || !CONFIG.restore.enabled) {
      continue;
    }

    armRestore(
      bot,
      _row.guild_id,
      _row.user_id,
      null,
      CONFIG.restore.max_rearms
    );
    armed += 1;
  }
  return armed;
}
