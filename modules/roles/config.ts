import { z } from 'zod';

/**
 * Guild config schema for the roles module. Every key carries a
 * default so `{}` parses to a complete config, defaults ARE the
 * unconfigured state (the GuildStore contract). Every default is
 * EMPTY per the reference-config law: the module ships no panels,
 * sections, rules or role ids of its own.
 */

export const ROLES_CONFIG_VERSION = 1;

/* Panel and rule ids share the store-key charset (N16/A8). */
const ID_PATTERN = /^[a-z0-9_-]{1,32}$/;
/* Snowflakes stay TEXT and equality-only (DB11). */
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const DEFAULT_DIVIDER_COLOR = '#232428';
const DEFAULT_SETTLE_WINDOW_S = 60;
const MAX_SETTLE_WINDOW_S = 3600;
const DEFAULT_MAX_REARMS = 2;
const MAX_REARMS = 10;
const MAX_ACCOUNT_AGE_DAYS = 3650;
const MAX_TENURE_MINUTES = 43200;
const MAX_PANEL_PICKS = 25;
const MAX_LABEL_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 100;
const MIN_COUNT_POOL = 2;

const SNOWFLAKE = z.string().regex(SNOWFLAKE_PATTERN);

const PANEL_ENTRY_SCHEMA = z.object({
  role_id: SNOWFLAKE,
  emoji_slot: z.string().min(1)
    .nullable()
    .default(null),
  label: z.string().min(1)
    .max(MAX_LABEL_LENGTH)
    .nullable()
    .default(null),
  description: z.string().min(1)
    .max(MAX_DESCRIPTION_LENGTH)
    .nullable()
    .default(null),
});

/**
 * Server-side pick gates (R1, the EX3 law): re-evaluated on EVERY
 * pick, never trusted from the component payload. These make the
 * verse-picker style panel expressible as pure config.
 */
const PANEL_GATES_SCHEMA = z.object({
  min_account_age_days: z.number().int()
    .min(0)
    .max(MAX_ACCOUNT_AGE_DAYS)
    .default(0),
  min_guild_tenure_minutes: z.number().int()
    .min(0)
    .max(MAX_TENURE_MINUTES)
    .default(0),
  refuse_sanctioned: z.boolean().default(true),
});

/* message_id is TABLE-OWNED (mod_roles_panels), never config. */
const PANEL_SCHEMA = z.object({
  id: z.string().regex(ID_PATTERN),
  surface: z.enum(['reaction', 'button']),
  channel_id: SNOWFLAKE,
  template: z.string().min(1)
    .nullable()
    .default(null),
  map: z.array(PANEL_ENTRY_SCHEMA).min(1),
  exclusive: z.boolean().default(false),
  max: z.number().int()
    .min(1)
    .max(MAX_PANEL_PICKS)
    .nullable()
    .default(null),
  gates: PANEL_GATES_SCHEMA.prefault({}),
});

export type RolesPanel = z.infer<typeof PANEL_SCHEMA>;

const PANELS_SCHEMA = z.array(PANEL_SCHEMA)
  .superRefine((panels: RolesPanel[], refinement: z.RefinementCtx):
  void => {
    const IDS = new Set<string>();
    panels.forEach((panel: RolesPanel, index: number): void => {
      if (IDS.has(panel.id)) {
        refinement.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `Duplicate panel id '${panel.id}'.`,
        });
      }

      IDS.add(panel.id);
      const ROLE_IDS = new Set<string>();
      panel.map.forEach(
        (entry: RolesPanel['map'][number], entry_index: number):
        void => {
          if (ROLE_IDS.has(entry.role_id)) {
            refinement.addIssue({
              code: 'custom',
              path: [index, 'map', entry_index, 'role_id'],
              message:
                `Duplicate role '${entry.role_id}' in panel ` +
                `'${panel.id}'.`,
            });
          }
          ROLE_IDS.add(entry.role_id);
        }
      );
    });
  })
  .default([]);

/**
 * Declared divider sections, ORDERED top to bottom (DIVIDER LAW
 * v22). `class` separates TAG sections from SIMPLE machinery roles
 * that never claim the name colour.
 */
const SECTION_SCHEMA = z.object({
  name: z.string().min(1)
    .max(MAX_LABEL_LENGTH),
  divider_role_id: SNOWFLAKE.nullable().default(null),
  role_ids: z.array(SNOWFLAKE).default([]),
  class: z.enum(['tag', 'simple']).default('tag'),
});

export type RolesSection = z.infer<typeof SECTION_SCHEMA>;

const SECTIONS_SCHEMA = z.array(SECTION_SCHEMA)
  .superRefine(
    (sections: RolesSection[], refinement: z.RefinementCtx): void => {
      const NAMES = new Set<string>();
      const DIVIDERS = new Set<string>();
      const MEMBER_ROLES = new Set<string>();
      sections.forEach(
        (section: RolesSection, index: number): void => {
          if (NAMES.has(section.name)) {
            refinement.addIssue({
              code: 'custom',
              path: [index, 'name'],
              message: `Duplicate section name '${section.name}'.`,
            });
          }

          NAMES.add(section.name);

          if (section.divider_role_id) {
            if (DIVIDERS.has(section.divider_role_id)) {
              refinement.addIssue({
                code: 'custom',
                path: [index, 'divider_role_id'],
                message:
                  `Divider '${section.divider_role_id}' is used ` +
                  'by two sections.',
              });
            }
            DIVIDERS.add(section.divider_role_id);
          }

          section.role_ids.forEach(
            (role_id: string, role_index: number): void => {
              if (MEMBER_ROLES.has(role_id)) {
                refinement.addIssue({
                  code: 'custom',
                  path: [index, 'role_ids', role_index],
                  message:
                    `Role '${role_id}' appears in two sections.`,
                });
              }
              MEMBER_ROLES.add(role_id);
            }
          );
        }
      );
      sections.forEach(
        (section: RolesSection, index: number): void => {
          if (
            section.divider_role_id &&
            MEMBER_ROLES.has(section.divider_role_id)
          ) {
            refinement.addIssue({
              code: 'custom',
              path: [index, 'divider_role_id'],
              message:
                `Divider '${section.divider_role_id}' is also ` +
                'listed as a section member role.',
            });
          }
        }
      );
    }
  )
  .default([]);

const RULE_WHEN_SCHEMA = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('holds_any'),
    role_ids: z.array(SNOWFLAKE).min(1),
  }),
  z.object({
    kind: z.literal('holds_all'),
    role_ids: z.array(SNOWFLAKE).min(1),
  }),
  z.object({
    kind: z.literal('holds_count'),
    role_ids: z.array(SNOWFLAKE).min(MIN_COUNT_POOL),
    at_least: z.number().int()
      .min(1),
  }),
  z.object({ kind: z.literal('is_bot') }),
  z.object({
    kind: z.literal('level_at_least'),
    level: z.number().int()
      .min(1),
  }),
]);

/**
 * Derivation rules (R2). `enforce` defaults to grant_only: a rule
 * revokes ONLY what it granted and never touches manual grants.
 * 'strict' additionally revokes when the condition flips, the
 * sanctioned use is the VIAJERO key-derivation rule (Q5).
 */
const RULE_SCHEMA = z.object({
  id: z.string().regex(ID_PATTERN)
    .optional(),
  when: RULE_WHEN_SCHEMA,
  then: z.object({
    action: z.enum(['grant', 'revoke']),
    role_id: SNOWFLAKE,
  }),
  enforce: z.enum(['grant_only', 'strict']).default('grant_only'),
});

export type RolesRule = z.infer<typeof RULE_SCHEMA>;

const RULES_SCHEMA = z.array(RULE_SCHEMA)
  .superRefine(
    (rules: RolesRule[], refinement: z.RefinementCtx): void => {
      const IDS = new Set<string>();
      rules.forEach((rule: RolesRule, index: number): void => {
        if (!rule.id) {
          return;
        }

        if (IDS.has(rule.id)) {
          refinement.addIssue({
            code: 'custom',
            path: [index, 'id'],
            message: `Duplicate rule id '${rule.id}'.`,
          });
        }
        IDS.add(rule.id);
      });
    }
  )
  .default([]);

const RESTORE_SCHEMA = z.object({
  enabled: z.boolean().default(true),
  settle_window_s: z.number().int()
    .min(0)
    .max(MAX_SETTLE_WINDOW_S)
    .default(DEFAULT_SETTLE_WINDOW_S),
  max_rearms: z.number().int()
    .min(0)
    .max(MAX_REARMS)
    .default(DEFAULT_MAX_REARMS),
  /* Per-guild template override, constant fallback (C7 layering). */
  notice: z.string().min(1)
    .nullable()
    .default(null),
});

export const ROLES_CONFIG_SCHEMA = z.object({
  enabled: z.boolean().default(true),
  entry_role_id: SNOWFLAKE.nullable().default(null),
  bot_role_id: SNOWFLAKE.nullable().default(null),
  divider_color: z.string().regex(HEX_COLOR_PATTERN)
    .default(DEFAULT_DIVIDER_COLOR),
  panels: PANELS_SCHEMA,
  sections: SECTIONS_SCHEMA,
  rules: RULES_SCHEMA,
  never_restore: z.array(SNOWFLAKE).default([]),
  sanction_roles: z.array(SNOWFLAKE).default([]),
  restore: RESTORE_SCHEMA.prefault({}),
});

export type RolesConfig = z.infer<typeof ROLES_CONFIG_SCHEMA>;

export type ConfigSurface = 'discord' | 'ops';

/**
 * THE CONFIG TIER LAW (C6): 'discord' keys are tier-1 operational
 * knobs reachable from /roles config; 'ops' keys are structural
 * and move ONLY through the ops CLI import path.
 */
export const ROLES_CONFIG_SURFACES = {
  enabled: 'discord',
  entry_role_id: 'discord',
  divider_color: 'discord',
  restore: 'discord',
  bot_role_id: 'ops',
  panels: 'ops',
  sections: 'ops',
  rules: 'ops',
  never_restore: 'ops',
  sanction_roles: 'ops',
} as const satisfies Record<keyof RolesConfig, ConfigSurface>;
