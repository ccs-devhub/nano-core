import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DatabaseService } from '@/services/database.js';

import { ROLES_CONFIG_SCHEMA } from '@modules/roles/config.js';
import type {
  PanelRow,
  PickContext,
  ResolvedPanel
} from '@modules/roles/panels.js';
import {
  decidePick,
  decideUnpick,
  listPanels,
  matchPanelEntry,
  panelById,
  panelByMessage,
  parseResolvedPanel,
  resolvePanel,
  setPanelMessage,
  setPanelStatus,
  upsertPanel
} from '@modules/roles/panels.js';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'modules',
  'roles',
  'migrations'
);
const GUILD_ID = 'g1';
const CUSTOM_ID = '763464848457072701';
const NOW = 1785700000000;
const MS_PER_DAY = 86400000;
const MS_PER_MINUTE = 60000;
const AGE_DAYS = 7;
const TENURE_MINUTES = 10;

function openTemp(): DatabaseService {
  const ROOT = mkdtempSync(join(tmpdir(), 'nano-roles-panels-'));
  const RESULT = DatabaseService.open({ driver: 'sqlite' }, ROOT);

  if (!RESULT.ok) {
    throw new Error(RESULT.error);
  }

  const MIGRATED = RESULT.data.runModuleMigrations(
    'roles',
    MIGRATIONS_DIR
  );

  if (!MIGRATED.ok) {
    throw new Error(MIGRATED.error);
  }
  return RESULT.data;
}

function panel(
  overrides: Partial<ResolvedPanel> = {}
): ResolvedPanel {
  return {
    id: 'picker',
    surface: 'reaction',
    map: [
      {
        role_id: 'r1',
        emoji_slot: CUSTOM_ID,
        label: 'one',
        description: null,
      },
      {
        role_id: 'r2',
        emoji_slot: '🔥',
        label: 'two',
        description: null,
      },
      {
        role_id: 'r3',
        emoji_slot: null,
        label: 'three',
        description: null,
      },
    ],
    exclusive: false,
    max: null,
    gates: {
      min_account_age_days: 0,
      min_guild_tenure_minutes: 0,
      refuse_sanctioned: true,
    },
    ...overrides,
  };
}

function context(overrides: Partial<PickContext> = {}): PickContext {
  return {
    held_role_ids: [],
    account_created_at: NOW - MS_PER_DAY * AGE_DAYS * 2,
    joined_at: NOW - MS_PER_MINUTE * TENURE_MINUTES * 2,
    sanctioned: false,
    now: NOW,
    ...overrides,
  };
}

describe('panel resolution', (): void => {
  it('freezes config panels and round-trips through JSON',
    (): void => {
      const CONFIG = ROLES_CONFIG_SCHEMA.parse({
        panels: [{
          id: 'picker',
          surface: 'button',
          channel_id: CUSTOM_ID,
          map: [{ role_id: CUSTOM_ID, label: 'pick me' }],
          exclusive: true,
        }],
      });
      const RESOLVED = resolvePanel(CONFIG.panels[0]);

      expect(RESOLVED.surface).toBe('button');
      expect(RESOLVED.exclusive).toBe(true);
      expect(RESOLVED.gates.refuse_sanctioned).toBe(true);

      const PARSED = parseResolvedPanel(JSON.stringify(RESOLVED));

      expect(PARSED.ok).toBe(true);

      if (PARSED.ok) {
        expect(PARSED.data).toEqual(RESOLVED);
      }
    });

  it('rejects unreadable and misshapen config_json', (): void => {
    expect(parseResolvedPanel('not json').ok).toBe(false);
    expect(parseResolvedPanel('{"id":1}').ok).toBe(false);
    expect(
      parseResolvedPanel('{"id":"x","surface":"pigeon","map":[]}').ok
    ).toBe(false);
  });
});

describe('matchPanelEntry', (): void => {
  it('matches custom emojis by ID even when names differ',
    (): void => {
      const ENTRY = matchPanelEntry(panel(), {
        id: CUSTOM_ID,
        name: 'renamed_since',
      });

      expect(ENTRY?.role_id).toBe('r1');
    });

  it('matches unicode by exact literal only', (): void => {
    expect(matchPanelEntry(panel(), { id: null, name: '🔥' })?.role_id)
      .toBe('r2');
    expect(matchPanelEntry(panel(), { id: null, name: '🔥🔥' }))
      .toBeNull();
  });

  it('never matches a custom emoji by name', (): void => {
    expect(matchPanelEntry(panel(), { id: '999999999999999999', name: '🔥' }))
      .toBeNull();
  });
});

describe('decidePick', (): void => {
  it('refuses a role the panel does not offer', (): void => {
    expect(decidePick(panel(), context(), 'intruder').refusal)
      .toBe('unknown_role');
  });

  it('gates sanctioned members only when configured', (): void => {
    expect(
      decidePick(panel(), context({ sanctioned: true }), 'r1').refusal
    ).toBe('gate_sanctioned');

    const OPEN = panel({
      gates: {
        min_account_age_days: 0,
        min_guild_tenure_minutes: 0,
        refuse_sanctioned: false,
      },
    });

    expect(decidePick(OPEN, context({ sanctioned: true }), 'r1').refusal)
      .toBeNull();
  });

  it('gates account age at the exact boundary', (): void => {
    const GATED = panel({
      gates: {
        min_account_age_days: AGE_DAYS,
        min_guild_tenure_minutes: 0,
        refuse_sanctioned: true,
      },
    });
    const AT_BOUNDARY = context({
      account_created_at: NOW - MS_PER_DAY * AGE_DAYS,
    });
    const UNDER = context({
      account_created_at: NOW - MS_PER_DAY * AGE_DAYS + 1,
    });

    expect(decidePick(GATED, AT_BOUNDARY, 'r1').refusal).toBeNull();
    expect(decidePick(GATED, UNDER, 'r1').refusal).toBe('gate_age');
  });

  it('fails a tenure gate closed when the join time is unknown',
    (): void => {
      const GATED = panel({
        gates: {
          min_account_age_days: 0,
          min_guild_tenure_minutes: TENURE_MINUTES,
          refuse_sanctioned: true,
        },
      });

      expect(decidePick(GATED, context({ joined_at: null }), 'r1')
        .refusal).toBe('gate_tenure');
      expect(decidePick(panel(), context({ joined_at: null }), 'r1')
        .refusal).toBeNull();
    });

  it('treats an already-held pick as an idempotent no-op',
    (): void => {
      const DECISION = decidePick(
        panel(),
        context({ held_role_ids: ['r1'] }),
        'r1'
      );

      expect(DECISION.refusal).toBeNull();
      expect(DECISION.change.add).toEqual([]);
      expect(DECISION.change.remove).toEqual([]);
    });

  it('computes the exclusive swap in one delta', (): void => {
    const DECISION = decidePick(
      panel({ exclusive: true }),
      context({ held_role_ids: ['r1', 'r2', 'outsider'] }),
      'r3'
    );

    expect(DECISION.refusal).toBeNull();
    expect(DECISION.change.add).toEqual(['r3']);
    expect([...DECISION.change.remove].sort()).toEqual(['r1', 'r2']);
  });

  it('caps picks at max but always allows the exclusive swap',
    (): void => {
      const CAPPED = panel({ max: 2 });

      expect(decidePick(
        CAPPED,
        context({ held_role_ids: ['r1', 'r2'] }),
        'r3'
      ).refusal).toBe('max_picks');

      const EXCLUSIVE_AT_CAP = panel({ exclusive: true, max: 1 });

      expect(decidePick(
        EXCLUSIVE_AT_CAP,
        context({ held_role_ids: ['r1'] }),
        'r2'
      ).refusal).toBeNull();
    });
});

describe('decideUnpick', (): void => {
  it('revokes only held panel roles', (): void => {
    expect(decideUnpick(panel(), ['r2'], 'r2').remove).toEqual(['r2']);
    expect(decideUnpick(panel(), ['r2'], 'outsider').remove)
      .toEqual([]);
    expect(decideUnpick(panel(), [], 'r2').remove).toEqual([]);
  });
});

describe('panel row store', (): void => {
  it('upserts, looks up by id and message, and updates status',
    (): void => {
      const SERVICE = openTemp();
      const DB = SERVICE.getDb();
      const ROW: PanelRow = {
        guild_id: GUILD_ID,
        panel_id: 'picker',
        channel_id: 'c1',
        message_id: null,
        surface: 'reaction',
        config_json: JSON.stringify(panel()),
        status: 'active',
        updated_at: 1,
      };
      upsertPanel(DB, ROW);
      upsertPanel(DB, { ...ROW, channel_id: 'c2', updated_at: 2 });

      const BY_ID = panelById(DB, GUILD_ID, 'picker');

      expect(BY_ID?.channel_id).toBe('c2');
      expect(BY_ID?.updated_at).toBe(2);

      setPanelMessage(DB, GUILD_ID, 'picker', 'm1', 3);

      expect(panelByMessage(DB, GUILD_ID, 'm1')?.panel_id)
        .toBe('picker');
      expect(panelByMessage(DB, GUILD_ID, 'm404')).toBeNull();

      setPanelStatus(DB, GUILD_ID, 'picker', 'broken', 4);

      const BROKEN = panelById(DB, GUILD_ID, 'picker');

      expect(BROKEN?.status).toBe('broken');

      setPanelMessage(DB, GUILD_ID, 'picker', 'm2', 5);

      const REPUBLISHED = panelById(DB, GUILD_ID, 'picker');

      expect(REPUBLISHED?.status).toBe('active');
      expect(REPUBLISHED?.message_id).toBe('m2');
      expect(listPanels(DB, GUILD_ID)).toHaveLength(1);
      SERVICE.close();
    });
});
