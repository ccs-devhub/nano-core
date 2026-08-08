import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type {
  DashboardField,
  DashboardManifest
} from '@/types/nano-dashboard.js';
import {
  cspImgSrcDirective,
  DASHBOARD_MANIFEST_FILENAME,
  dashboardValueProblem,
  DEFAULT_ACTOR_GATE,
  DEFAULT_FIELD_TIER,
  loadDashboardManifest,
  MAX_DESCRIPTOR_BYTES,
  NANO_DASHBOARD_MANIFEST_SCHEMA
} from '@/types/nano-dashboard.js';
import { moduleAssetPath } from '@/web/manifests.js';

function minimalManifest(): Record<string, unknown> {
  return {
    title: 'Test Module',
    config_version: 1,
    config: { fields: [] },
  };
}

/**
 * The proof fixture from the P12 spec: the FULL roles config shape —
 * panels as an array with a nested array (map) and a group (gates),
 * sections as an ordered array plus a snowflake_list, rules as an
 * array with a variant (when) and a group (then), restore as a group
 * with a template.
 */
function complexTaxonomyManifest(): Record<string, unknown> {
  return {
    title: 'Roles',
    api_version: '1',
    config_version: 1,
    config: {
      validate: 'validateConfig',
      fields: [
        {
          key: 'enabled',
          label: 'Enabled',
          type: 'boolean',
          default: false,
          tier: 'discord',
        },
        {
          key: 'bot_role_id',
          label: 'Bot role',
          type: 'snowflake',
          kind: 'role',
          tier: 'host',
        },
        {
          key: 'sanction_roles',
          label: 'Sanction roles',
          type: 'snowflake_list',
          kind: 'role',
          tier: 'host',
        },
        {
          key: 'panels',
          label: 'Panels',
          type: 'array',
          tier: 'ops',
          propagation: 'Published panels keep their frozen map.',
          offer_actions: ['refresh_panel'],
          item: {
            key: 'panel',
            label: 'Panel',
            type: 'group',
            fields: [
              {
                key: 'channel_id',
                label: 'Channel',
                type: 'snowflake',
                kind: 'channel',
              },
              {
                key: 'map',
                label: 'Reaction map',
                type: 'array',
                item: {
                  key: 'entry',
                  label: 'Entry',
                  type: 'group',
                  fields: [
                    { key: 'emoji', label: 'Emoji', type: 'text' },
                    {
                      key: 'role_id',
                      label: 'Role',
                      type: 'snowflake',
                      kind: 'role',
                    },
                  ],
                },
              },
              {
                key: 'gates',
                label: 'Gates',
                type: 'group',
                fields: [
                  {
                    key: 'max_picks',
                    label: 'Max picks',
                    type: 'number',
                    min: 0,
                    max: 25,
                  },
                ],
              },
            ],
          },
        },
        {
          key: 'sections',
          label: 'Sections',
          type: 'array',
          ordered: true,
          tier: 'ops',
          item: {
            key: 'section',
            label: 'Section',
            type: 'group',
            fields: [
              {
                key: 'divider_role_id',
                label: 'Divider',
                type: 'snowflake',
                kind: 'role',
              },
              {
                key: 'member_roles',
                label: 'Member roles',
                type: 'snowflake_list',
                kind: 'role',
              },
            ],
          },
        },
        {
          key: 'rules',
          label: 'Rules',
          type: 'array',
          tier: 'ops',
          item: {
            key: 'rule',
            label: 'Rule',
            type: 'group',
            fields: [
              {
                key: 'when',
                label: 'When',
                type: 'variant',
                discriminator: 'kind',
                variants: [
                  {
                    value: 'role_added',
                    fields: [
                      {
                        key: 'role_id',
                        label: 'Role',
                        type: 'snowflake',
                        kind: 'role',
                      },
                    ],
                  },
                  {
                    value: 'joined',
                    fields: [],
                  },
                ],
              },
              {
                key: 'then',
                label: 'Then',
                type: 'group',
                fields: [
                  {
                    key: 'role_id',
                    label: 'Grant role',
                    type: 'snowflake',
                    kind: 'role',
                  },
                ],
              },
            ],
          },
        },
        {
          key: 'restore',
          label: 'Restore',
          type: 'group',
          fields: [
            {
              key: 'notice',
              label: 'Notice',
              type: 'template',
              slots: ['user', 'guild'],
            },
            {
              key: 'divider_color',
              label: 'Divider color',
              type: 'color',
              default: '#2b2d31',
            },
            {
              key: 'mode',
              label: 'Mode',
              type: 'select',
              options: ['immediate', 'delayed'],
              default: 'immediate',
            },
          ],
        },
      ],
    },
    data: [
      {
        id: 'panel-status',
        title: 'Panel status',
        provides: 'panelStatus',
        columns: [
          { key: 'panel_id', label: 'Panel' },
          { key: 'stale', label: 'Stale' },
        ],
      },
      {
        id: 'member-roles',
        title: 'Member roles',
        provides: 'listMemberRoles',
        params: [
          { key: 'user_id', label: 'User', type: 'snowflake', kind: 'user' },
        ],
      },
    ],
    actions: [
      {
        id: 'refresh_panel',
        label: 'Refresh panel',
        provides: 'refreshPanel',
        params: [
          { key: 'panel_id', label: 'Panel id', type: 'text' },
        ],
      },
      {
        id: 'strip-all',
        label: 'Strip all roles',
        provides: 'stripAll',
        confirm: 'This removes every managed role.',
        danger: true,
        actor_gate: 'host',
        cooldown_s: 60,
        params: [
          { key: 'user_id', label: 'User', type: 'snowflake', kind: 'user' },
        ],
      },
    ],
  };
}

describe('nano-dashboard schema', (): void => {
  it('parses a minimal manifest', (): void => {
    const PARSED = NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(
      minimalManifest()
    );

    expect(PARSED.success).toBe(true);
  });

  it('parses the full complex taxonomy fixture', (): void => {
    const PARSED = NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(
      complexTaxonomyManifest()
    );

    expect(PARSED.success).toBe(true);
    if (PARSED.success) {
      const MANIFEST: DashboardManifest = PARSED.data;

      expect(MANIFEST.config.fields).toHaveLength(7);
      expect(MANIFEST.config.validate).toBe('validateConfig');
      expect(MANIFEST.actions?.[1]?.actor_gate).toBe('host');
    }
  });

  it('exposes the tier and actor-gate defaults as constants', (): void => {
    expect(DEFAULT_FIELD_TIER).toBe('discord');
    expect(DEFAULT_ACTOR_GATE).toBe('ops');
    expect(DASHBOARD_MANIFEST_FILENAME).toBe('nano-dashboard.json');
  });

  it('rejects a manifest without config_version', (): void => {
    const BAD = minimalManifest();

    delete BAD['config_version'];
    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD).success)
      .toBe(false);
  });

  it('rejects an unknown widget type', (): void => {
    const BAD = {
      ...minimalManifest(),
      config: {
        fields: [{ key: 'x', label: 'X', type: 'slider' }],
      },
    };

    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD).success)
      .toBe(false);
  });

  it('rejects duplicate field keys at the same level', (): void => {
    const BAD = {
      ...minimalManifest(),
      config: {
        fields: [
          { key: 'twin', label: 'A', type: 'boolean' },
          { key: 'twin', label: 'B', type: 'boolean' },
        ],
      },
    };

    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD).success)
      .toBe(false);
  });

  it('allows the same key on different levels', (): void => {
    const GOOD = {
      ...minimalManifest(),
      config: {
        fields: [
          {
            key: 'outer',
            label: 'Outer',
            type: 'group',
            fields: [{ key: 'outer', label: 'Inner', type: 'boolean' }],
          },
        ],
      },
    };

    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(GOOD).success)
      .toBe(true);
  });

  it('rejects duplicate action ids', (): void => {
    const BAD = {
      ...minimalManifest(),
      actions: [
        { id: 'sync', label: 'Sync', provides: 'syncA' },
        { id: 'sync', label: 'Sync again', provides: 'syncB' },
      ],
    };

    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD).success)
      .toBe(false);
  });

  it('rejects duplicate data view ids', (): void => {
    const BAD = {
      ...minimalManifest(),
      data: [
        { id: 'view', title: 'A', provides: 'viewA' },
        { id: 'view', title: 'B', provides: 'viewB' },
      ],
    };

    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD).success)
      .toBe(false);
  });

  it('rejects offer_actions referencing an unknown action', (): void => {
    const BAD = {
      ...minimalManifest(),
      config: {
        fields: [
          {
            key: 'x',
            label: 'X',
            type: 'boolean',
            offer_actions: ['missing'],
          },
        ],
      },
    };

    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD).success)
      .toBe(false);
  });

  it('rejects duplicate variant values', (): void => {
    const BAD = {
      ...minimalManifest(),
      config: {
        fields: [
          {
            key: 'when',
            label: 'When',
            type: 'variant',
            discriminator: 'kind',
            variants: [
              { value: 'joined', fields: [] },
              { value: 'joined', fields: [] },
            ],
          },
        ],
      },
    };

    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD).success)
      .toBe(false);
  });

  it('rejects an array whose min exceeds max', (): void => {
    const BAD = {
      ...minimalManifest(),
      config: {
        fields: [
          {
            key: 'list',
            label: 'List',
            type: 'array',
            min: 5,
            max: 2,
            item: { key: 'entry', label: 'Entry', type: 'text' },
          },
        ],
      },
    };

    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD).success)
      .toBe(false);
  });

  it('rejects a bad tier and a bad actor_gate', (): void => {
    const BAD_TIER = {
      ...minimalManifest(),
      config: {
        fields: [
          { key: 'x', label: 'X', type: 'boolean', tier: 'root' },
        ],
      },
    };
    const BAD_GATE = {
      ...minimalManifest(),
      actions: [
        {
          id: 'a',
          label: 'A',
          provides: 'doA',
          actor_gate: 'discord',
        },
      ],
    };

    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD_TIER).success)
      .toBe(false);
    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD_GATE).success)
      .toBe(false);
  });

  it('rejects non-snake-case field keys', (): void => {
    const BAD = {
      ...minimalManifest(),
      config: {
        fields: [{ key: 'CamelKey', label: 'X', type: 'boolean' }],
      },
    };

    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD).success)
      .toBe(false);
  });

  it('accepts localized text maps everywhere text renders', ():
  void => {
    const LOCALIZED = {
      title: { en: 'Roles', es: 'Roles' },
      languages: ['en', 'es'],
      config_version: 1,
      config: {
        fields: [
          {
            key: 'greeting',
            label: { en: 'Greeting', es: 'Saludo' },
            help: { en: 'Shown on join.', es: 'Se muestra al entrar.' },
            type: 'text',
            placeholder: { en: 'e.g. hello', es: 'p. ej. hola' },
          },
        ],
      },
      data: [
        {
          id: 'rows',
          title: { en: 'Rows', es: 'Filas' },
          provides: 'listRows',
          explain: { en: 'Read it so.', es: 'Se lee asi.' },
          columns: [
            { key: 'u', label: { en: 'User', es: 'Usuario' } },
          ],
        },
      ],
      actions: [
        {
          id: 'run',
          label: { en: 'Run', es: 'Ejecutar' },
          provides: 'runIt',
          confirm: { en: 'Run this?', es: 'Ejecutar esto?' },
        },
      ],
      action_groups: [
        {
          id: 'ops',
          title: { en: 'Operations', es: 'Operaciones' },
        },
      ],
    };

    expect(
      NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(LOCALIZED).success
    ).toBe(true);
  });

  it('accepts an about block and rejects malformed media', ():
  void => {
    const WITH_ABOUT = {
      ...minimalManifest(),
      about: {
        description: { en: 'What it does.', es: 'Lo que hace.' },
        badges: [
          {
            image: 'https://img.shields.io/badge/x-y-ededed.png',
            href: 'https://github.com/ccs-devhub/nano-core',
            alt: 'Repo',
          },
        ],
        media: [
          { kind: 'image', src: 'roles.jpg', alt: 'The module' },
          {
            kind: 'image',
            src: 'https://cdn.discordapp.com/attachments/1/2/shot.png',
          },
          { kind: 'youtube', id: 'ekzFDeRCdUw' },
          { kind: 'x', id: '1234567890123456789' },
        ],
        commands: [
          {
            name: '/roles grant',
            help: { en: 'Grant a role.', es: 'Otorga un rol.' },
          },
          { name: '/roles inspect' },
        ],
      },
    };

    expect(
      NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(WITH_ABOUT).success
    ).toBe(true);

    const BAD_MEDIA = {
      ...minimalManifest(),
      about: {
        description: 'x',
        media: [{ kind: 'youtube', id: 'not a yt id!' }],
      },
    };
    const TRAVERSAL = {
      ...minimalManifest(),
      about: {
        description: 'x',
        media: [{ kind: 'image', src: '../secret.png' }],
      },
    };
    const BAD_COMMAND = {
      ...minimalManifest(),
      about: {
        description: 'x',
        commands: [{ name: 'no leading slash' }],
      },
    };

    expect(
      NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD_MEDIA).success
    ).toBe(false);
    expect(
      NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(TRAVERSAL).success
    ).toBe(false);
    expect(
      NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD_COMMAND).success
    ).toBe(false);
  });

  it('rejects an empty localized map and a bad language code', ():
  void => {
    const EMPTY_MAP = {
      ...minimalManifest(),
      config: {
        fields: [{ key: 'x', label: {}, type: 'boolean' }],
      },
    };
    const BAD_LANGS = {
      ...minimalManifest(),
      languages: ['English'],
    };

    expect(
      NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(EMPTY_MAP).success
    ).toBe(false);
    expect(
      NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(BAD_LANGS).success
    ).toBe(false);
  });
});

describe('loadDashboardManifest', (): void => {
  function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'nano-dashboard-'));
  }

  it('errors on a missing file', (): void => {
    const RESULT = loadDashboardManifest(
      join(tempDir(), DASHBOARD_MANIFEST_FILENAME)
    );

    expect(RESULT.ok).toBe(false);
  });

  it('errors on invalid JSON', (): void => {
    const PATH = join(tempDir(), DASHBOARD_MANIFEST_FILENAME);

    writeFileSync(PATH, '{ not json');

    expect(loadDashboardManifest(PATH).ok).toBe(false);
  });

  it('errors with issue paths on a schema violation', (): void => {
    const PATH = join(tempDir(), DASHBOARD_MANIFEST_FILENAME);

    writeFileSync(
      PATH,
      JSON.stringify({
        title: 'Broken',
        config_version: 1,
        config: {
          fields: [{ key: 'x', label: 'X', type: 'slider' }],
        },
      })
    );

    const RESULT = loadDashboardManifest(PATH);

    expect(RESULT.ok).toBe(false);
    if (!RESULT.ok) {
      expect(RESULT.error).toContain('config.fields');
    }
  });

  it('loads and validates a full manifest from disk', (): void => {
    const PATH = join(tempDir(), DASHBOARD_MANIFEST_FILENAME);

    writeFileSync(PATH, JSON.stringify(complexTaxonomyManifest()));

    const RESULT = loadDashboardManifest(PATH);

    expect(RESULT.ok).toBe(true);
    if (RESULT.ok) {
      expect(RESULT.data.title).toBe('Roles');
    }
  });

  it('refuses an oversize descriptor before parsing (F15)',
    (): void => {
      const PATH = join(tempDir(), DASHBOARD_MANIFEST_FILENAME);
      const MANIFEST = minimalManifest();

      MANIFEST.padding = 'x'.repeat(MAX_DESCRIPTOR_BYTES);
      writeFileSync(PATH, JSON.stringify(MANIFEST));

      const RESULT = loadDashboardManifest(PATH);

      expect(RESULT.ok).toBe(false);
      if (!RESULT.ok) {
        expect(RESULT.error).toContain('bytes');
      }
    });

  it('refuses a descriptor nested past the JSON cap (F15)',
    (): void => {
      const PATH = join(tempDir(), DASHBOARD_MANIFEST_FILENAME);
      const DEEP_LEVELS = 40;
      const MANIFEST = minimalManifest();

      MANIFEST.junk = JSON.parse(
        `${'['.repeat(DEEP_LEVELS)}1${']'.repeat(DEEP_LEVELS)}`
      );
      writeFileSync(PATH, JSON.stringify(MANIFEST));

      const RESULT = loadDashboardManifest(PATH);

      expect(RESULT.ok).toBe(false);
      if (!RESULT.ok) {
        expect(RESULT.error).toContain('JSON levels');
      }
    });
});

describe('descriptor field bounds (F15)', (): void => {
  const NESTING_LIMIT = 8;
  const TEXT_LIMIT = 2048;

  function nestedGroups(levels: number): Record<string, unknown> {
    let field: Record<string, unknown> = {
      key: 'leaf',
      label: 'Leaf',
      type: 'boolean',
    };

    for (let index = 0; index < levels - 1; index += 1) {
      field = {
        key: `g${index}`,
        label: 'Group',
        type: 'group',
        fields: [field],
      };
    }
    return field;
  }

  it('allows nesting at the cap and refuses one past it',
    (): void => {
      const AT_CAP = minimalManifest();

      AT_CAP.config = { fields: [nestedGroups(NESTING_LIMIT)] };
      expect(
        NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(AT_CAP).success
      ).toBe(true);

      const OVER = minimalManifest();

      OVER.config = { fields: [nestedGroups(NESTING_LIMIT + 1)] };
      const PARSED = NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(OVER);

      expect(PARSED.success).toBe(false);
      expect(JSON.stringify(PARSED.error?.issues))
        .toContain('Field nesting exceeds');
    });

  it('locks descriptor image urls to the shared allowlist (F19)',
    (): void => {
      const OK = minimalManifest();

      OK.about = {
        description: 'A module',
        badges: [{
          image: 'https://img.shields.io/badge/v-1.0-blue',
          href: 'https://github.com/ccs-devhub/nano-core',
          alt: 'version',
        }],
      };
      expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(OK).success)
        .toBe(true);

      const EVIL = minimalManifest();

      EVIL.about = {
        description: 'A module',
        badges: [{
          image: 'https://evil.example/beacon.png',
          alt: 'tracker',
        }],
      };
      const PARSED = NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(EVIL);

      expect(PARSED.success).toBe(false);
      expect(JSON.stringify(PARSED.error?.issues))
        .toContain('allowlist');

      expect(cspImgSrcDirective()).toBe(
        "img-src 'self' https://img.shields.io " +
        'https://cdn.discordapp.com https://i.ytimg.com'
      );
    });

  it('bounds free-text strings (F15)', (): void => {
    const OK = minimalManifest();

    OK.config = {
      fields: [{
        key: 'note',
        label: 'x'.repeat(TEXT_LIMIT),
        type: 'text',
      }],
    };
    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(OK).success)
      .toBe(true);

    const OVER = minimalManifest();

    OVER.config = {
      fields: [{
        key: 'note',
        label: 'x'.repeat(TEXT_LIMIT + 1),
        type: 'text',
      }],
    };
    expect(NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(OVER).success)
      .toBe(false);
  });
});

describe('moduleAssetPath', (): void => {
  const ROOT = mkdtempSync(join(tmpdir(), 'nano-assets-'));

  beforeAll((): void => {
    mkdirSync(join(ROOT, 'mod-a', 'nano-dashboard-assets'), {
      recursive: true,
    });
    writeFileSync(
      join(ROOT, 'mod-a', 'nano-dashboard-assets', 'face.png'),
      'PNG'
    );
    writeFileSync(
      join(ROOT, 'mod-a', 'nano-dashboard-assets', 'notes.txt'),
      'text'
    );
    writeFileSync(
      join(ROOT, 'nano.config.json'),
      JSON.stringify({
        bot: { name: 'test' },
        modules: ['./mod-a'],
      })
    );
  });

  it('serves only whitelisted rasters from the assets dir', ():
  void => {
    const HIT = moduleAssetPath('mod-a', 'face.png', ROOT);

    expect(HIT.ok).toBe(true);
    if (HIT.ok) {
      expect(HIT.data.endsWith('face.png')).toBe(true);
    }
  });

  it('refuses traversal, bad names, and non-raster types', ():
  void => {
    expect(moduleAssetPath('mod-a', '../secret.png', ROOT).ok)
      .toBe(false);
    expect(moduleAssetPath('mod-a', '.hidden.png', ROOT).ok)
      .toBe(false);
    expect(moduleAssetPath('mod-a', 'notes.txt', ROOT).ok)
      .toBe(false);
    expect(moduleAssetPath('mod-a', 'missing.png', ROOT).ok)
      .toBe(false);
    expect(moduleAssetPath('other', 'face.png', ROOT).ok)
      .toBe(false);
  });
});

describe('dashboardValueProblem (F24)', (): void => {
  const SNOWFLAKE = '12345678901234567';
  const COUNT_MAX = 10;
  const OVER_MAX = 99;

  it('accepts matching scalar values', (): void => {
    expect(dashboardValueProblem(
      { key: 'on', label: 'On', type: 'boolean' }, true
    )).toBeNull();
    expect(dashboardValueProblem(
      { key: 'n', label: 'N', type: 'number', max: COUNT_MAX }, 5
    )).toBeNull();
    expect(dashboardValueProblem(
      { key: 't', label: 'T', type: 'text' }, 'hello'
    )).toBeNull();
    expect(dashboardValueProblem(
      { key: 's', label: 'S', type: 'select', options: ['a', 'b'] },
      'a'
    )).toBeNull();
    expect(dashboardValueProblem(
      { key: 'id', label: 'Id', type: 'snowflake', kind: 'user' },
      SNOWFLAKE
    )).toBeNull();
  });

  it('rejects mistyped scalar values', (): void => {
    expect(dashboardValueProblem(
      { key: 'on', label: 'On', type: 'boolean' }, 'true'
    )).toContain('boolean');
    expect(dashboardValueProblem(
      { key: 'n', label: 'N', type: 'number', max: COUNT_MAX },
      OVER_MAX
    )).toContain('<=');
    expect(dashboardValueProblem(
      { key: 'n', label: 'N', type: 'number' }, Number.NaN
    )).toContain('finite');
    expect(dashboardValueProblem(
      { key: 's', label: 'S', type: 'select', options: ['a', 'b'] },
      'z'
    )).toContain('one of');
    expect(dashboardValueProblem(
      { key: 'id', label: 'Id', type: 'snowflake', kind: 'user' },
      'abc'
    )).toContain('Discord id');
  });

  it('checks snowflake lists item by item with bounds', (): void => {
    const FIELD: DashboardField = {
      key: 'ids',
      label: 'Ids',
      type: 'snowflake_list',
      kind: 'role',
      min: 1,
      max: 2,
    };
    expect(dashboardValueProblem(FIELD, [SNOWFLAKE])).toBeNull();
    expect(dashboardValueProblem(FIELD, [])).toContain('at least');
    expect(dashboardValueProblem(
      FIELD,
      [SNOWFLAKE, SNOWFLAKE, SNOWFLAKE]
    )).toContain('at most');
    expect(dashboardValueProblem(FIELD, [SNOWFLAKE, 'abc']))
      .toContain('only Discord ids');
    expect(dashboardValueProblem(FIELD, 'not-a-list'))
      .toContain('list');
  });

  it('recurses through group, array and variant', (): void => {
    const GROUP: DashboardField = {
      key: 'g',
      label: 'G',
      type: 'group',
      fields: [{ key: 'n', label: 'N', type: 'number' }],
    };
    expect(dashboardValueProblem(GROUP, { n: 1 })).toBeNull();
    expect(dashboardValueProblem(GROUP, { n: 'x' }))
      .toContain('number');
    expect(dashboardValueProblem(GROUP, 'flat'))
      .toContain('object');

    const LIST: DashboardField = {
      key: 'list',
      label: 'List',
      type: 'array',
      item: { key: 'item', label: 'Item', type: 'text' },
    };
    expect(dashboardValueProblem(LIST, ['a', 'b'])).toBeNull();
    expect(dashboardValueProblem(LIST, ['a', 1]))
      .toContain('string');

    const VARIANT: DashboardField = {
      key: 'v',
      label: 'V',
      type: 'variant',
      discriminator: 'mode',
      variants: [
        {
          value: 'basic',
          fields: [{ key: 'on', label: 'On', type: 'boolean' }],
        },
      ],
    };
    expect(dashboardValueProblem(VARIANT, { mode: 'basic', on: true }))
      .toBeNull();
    expect(dashboardValueProblem(VARIANT, { mode: 'other' }))
      .toContain('no declared case');
    expect(dashboardValueProblem(VARIANT, { mode: 'basic', on: 3 }))
      .toContain('boolean');
  });
});
