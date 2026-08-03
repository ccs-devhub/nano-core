import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { RolesPanel } from './config.js';

import type { NanoResult } from '@ccs-devhub/nano-core';
import { err, ok } from '@ccs-devhub/nano-core';

/**
 * R1: the panel store and the pure pick engine. A published panel's
 * truth is its ROW — config_json is resolved at publish time and
 * runtime reads the table, never live config (edits apply on
 * refresh). Pick decisions (gates, exclusive, max) are pure
 * functions here; mutations flow through applyRoleChange and the
 * messaging engine lives beside the event handlers.
 */

const MS_PER_DAY = 86400000;
const MS_PER_MINUTE = 60000;
/* Custom emoji ids are snowflakes; a unicode literal never is. */
const CUSTOM_EMOJI_ID_PATTERN = /^\d{17,20}$/;

export interface ResolvedPanelEntry {
  role_id: string;
  emoji_slot: string | null;
  label: string | null;
  description: string | null;
}

export interface ResolvedPanel {
  id: string;
  surface: 'reaction' | 'button';
  map: ResolvedPanelEntry[];
  exclusive: boolean;
  max: number | null;
  gates: {
    min_account_age_days: number;
    min_guild_tenure_minutes: number;
    refuse_sanctioned: boolean;
  };
}

export interface PanelRow {
  guild_id: string;
  panel_id: string;
  channel_id: string;
  message_id: string | null;
  surface: 'reaction' | 'button';
  config_json: string;
  status: 'active' | 'broken';
  updated_at: number;
}

/** Freeze a config panel into its publish-time runtime shape. */
export function resolvePanel(panel: RolesPanel): ResolvedPanel {
  return {
    id: panel.id,
    surface: panel.surface,
    map: panel.map.map(
      (entry: RolesPanel['map'][number]): ResolvedPanelEntry => {
        return {
          role_id: entry.role_id,
          emoji_slot: entry.emoji_slot,
          label: entry.label,
          description: entry.description,
        };
      }
    ),
    exclusive: panel.exclusive,
    max: panel.max,
    gates: { ...panel.gates },
  };
}

/** Parse a stored config_json; a broken row errs, never throws. */
export function parseResolvedPanel(
  config_json: string
): NanoResult<ResolvedPanel> {
  try {
    const PARSED = JSON.parse(config_json) as ResolvedPanel;

    if (
      typeof PARSED?.id !== 'string' ||
      !Array.isArray(PARSED.map) ||
      (PARSED.surface !== 'reaction' && PARSED.surface !== 'button')
    ) {
      return err('Panel config_json has an unexpected shape.');
    }
    return ok(PARSED);
  } catch (error: unknown) {
    return err(`Panel config_json is unreadable: ${String(error)}`);
  }
}

/**
 * Match a reaction emoji against the panel map: CUSTOM EMOJI BY ID
 * first, unicode by EXACT literal — never by name (the emoji-name
 * hardcoding lesson from the legacy bot).
 */
export function matchPanelEntry(
  panel: ResolvedPanel,
  emoji: { id: string | null; name: string | null }
): ResolvedPanelEntry | null {
  for (const _entry of panel.map) {
    if (!_entry.emoji_slot) {
      continue;
    }

    if (CUSTOM_EMOJI_ID_PATTERN.test(_entry.emoji_slot)) {
      if (emoji.id === _entry.emoji_slot) {
        return _entry;
      }
      continue;
    }

    if (emoji.id === null && emoji.name === _entry.emoji_slot) {
      return _entry;
    }
  }
  return null;
}

export type PickRefusal =
  | 'unknown_role'
  | 'gate_sanctioned'
  | 'gate_age'
  | 'gate_tenure'
  | 'max_picks';

export interface PickContext {
  held_role_ids: string[];
  /** Account creation, epoch ms. */
  account_created_at: number;
  /** Guild join, epoch ms; null = unknown (fails a tenure gate). */
  joined_at: number | null;
  /** Caller-resolved sanction verdict (roles or moderation API). */
  sanctioned: boolean;
  now: number;
}

export interface PickDecision {
  refusal: PickRefusal | null;
  /** The applyRoleChange delta when the pick is allowed. */
  change: { add: string[]; remove: string[] };
}

const NO_CHANGE: PickDecision['change'] = { add: [], remove: [] };

/**
 * The pure pick decision (EX3: evaluated server-side on EVERY pick,
 * never trusted from the component payload): gates first, then the
 * max cap, then the exclusive delta in one step — grant plus the
 * revokes of every other held role of this panel, ONE PATCH.
 */
export function decidePick(
  panel: ResolvedPanel,
  context: PickContext,
  role_id: string
): PickDecision {
  const ENTRY = panel.map.find(
    (entry: ResolvedPanelEntry): boolean => {
      return entry.role_id === role_id;
    }
  );

  if (!ENTRY) {
    return { refusal: 'unknown_role', change: NO_CHANGE };
  }

  if (panel.gates.refuse_sanctioned && context.sanctioned) {
    return { refusal: 'gate_sanctioned', change: NO_CHANGE };
  }

  const MIN_AGE_MS = panel.gates.min_account_age_days * MS_PER_DAY;

  if (context.now - context.account_created_at < MIN_AGE_MS) {
    return { refusal: 'gate_age', change: NO_CHANGE };
  }

  const MIN_TENURE_MS =
    panel.gates.min_guild_tenure_minutes * MS_PER_MINUTE;

  if (MIN_TENURE_MS > 0) {
    if (
      context.joined_at === null ||
      context.now - context.joined_at < MIN_TENURE_MS
    ) {
      return { refusal: 'gate_tenure', change: NO_CHANGE };
    }
  }

  const PANEL_ROLE_IDS = panel.map.map(
    (entry: ResolvedPanelEntry): string => {
      return entry.role_id;
    }
  );
  const HELD_FROM_PANEL = context.held_role_ids.filter(
    (held: string): boolean => {
      return PANEL_ROLE_IDS.includes(held);
    }
  );

  if (HELD_FROM_PANEL.includes(role_id)) {
    /* Already held: an idempotent no-op, not a refusal. */
    return { refusal: null, change: NO_CHANGE };
  }

  if (panel.exclusive) {
    return {
      refusal: null,
      change: { add: [role_id], remove: HELD_FROM_PANEL },
    };
  }

  if (panel.max !== null && HELD_FROM_PANEL.length >= panel.max) {
    return { refusal: 'max_picks', change: NO_CHANGE };
  }
  return { refusal: null, change: { add: [role_id], remove: [] } };
}

/** The unpick delta: revoke only when the role is a panel role. */
export function decideUnpick(
  panel: ResolvedPanel,
  held_role_ids: string[],
  role_id: string
): PickDecision['change'] {
  const IS_PANEL_ROLE = panel.map.some(
    (entry: ResolvedPanelEntry): boolean => {
      return entry.role_id === role_id;
    }
  );

  if (!IS_PANEL_ROLE || !held_role_ids.includes(role_id)) {
    return NO_CHANGE;
  }
  return { add: [], remove: [role_id] };
}

/* ---------------------------------------------------------------
 * The panel row store (mod_roles_panels).
 * --------------------------------------------------------------- */

export function upsertPanel(
  db: BetterSQLite3Database,
  row: PanelRow
): void {
  db.run(sql`
    INSERT INTO mod_roles_panels
      (guild_id, panel_id, channel_id, message_id, surface,
       config_json, status, updated_at)
    VALUES (${row.guild_id}, ${row.panel_id}, ${row.channel_id},
      ${row.message_id}, ${row.surface}, ${row.config_json},
      ${row.status}, ${row.updated_at})
    ON CONFLICT (guild_id, panel_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      message_id = excluded.message_id,
      surface = excluded.surface,
      config_json = excluded.config_json,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);
}

export function panelById(
  db: BetterSQLite3Database,
  guild_id: string,
  panel_id: string
): PanelRow | null {
  const ROWS = db.all(sql`
    SELECT guild_id, panel_id, channel_id, message_id, surface,
      config_json, status, updated_at
    FROM mod_roles_panels
    WHERE guild_id = ${guild_id} AND panel_id = ${panel_id}
  `) as PanelRow[];
  return ROWS[0] ?? null;
}

/** The event-path lookup: which panel owns this message. */
export function panelByMessage(
  db: BetterSQLite3Database,
  guild_id: string,
  message_id: string
): PanelRow | null {
  const ROWS = db.all(sql`
    SELECT guild_id, panel_id, channel_id, message_id, surface,
      config_json, status, updated_at
    FROM mod_roles_panels
    WHERE guild_id = ${guild_id} AND message_id = ${message_id}
  `) as PanelRow[];
  return ROWS[0] ?? null;
}

export function listPanels(
  db: BetterSQLite3Database,
  guild_id: string
): PanelRow[] {
  return db.all(sql`
    SELECT guild_id, panel_id, channel_id, message_id, surface,
      config_json, status, updated_at
    FROM mod_roles_panels
    WHERE guild_id = ${guild_id}
    ORDER BY panel_id ASC
  `) as PanelRow[];
}

/** B12: a vanished message marks the panel broken, never silent. */
export function setPanelStatus(
  db: BetterSQLite3Database,
  guild_id: string,
  panel_id: string,
  status: PanelRow['status'],
  updated_at: number
): void {
  db.run(sql`
    UPDATE mod_roles_panels
    SET status = ${status}, updated_at = ${updated_at}
    WHERE guild_id = ${guild_id} AND panel_id = ${panel_id}
  `);
}

/** Republish support: point the row at the fresh message. */
export function setPanelMessage(
  db: BetterSQLite3Database,
  guild_id: string,
  panel_id: string,
  message_id: string | null,
  updated_at: number
): void {
  db.run(sql`
    UPDATE mod_roles_panels
    SET message_id = ${message_id}, status = 'active',
      updated_at = ${updated_at}
    WHERE guild_id = ${guild_id} AND panel_id = ${panel_id}
  `);
}
