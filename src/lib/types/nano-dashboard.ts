import { existsSync, readFileSync, statSync } from 'node:fs';

import { z } from 'zod';

import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * The declarative WEB dashboard contract. A module ships a
 * `nano-dashboard.json` next to its entry file; the web host validates
 * it here and renders configuration windows, data views, and action
 * bars from it. NO module code ever executes inside the host on behalf
 * of a descriptor — descriptors are data, not scripts. The ONLY code
 * references a descriptor may carry are provides function NAMES,
 * resolved lazily per request through the module registry with
 * `guild_id` auto-injected as the first argument.
 *
 * Laws bound to this contract:
 * - DECLARATIVE-ONLY: the nano-tui.json security rule at web scale.
 * - TIERS: every config field carries an edit tier. `discord` fields
 *   ride the module's slash bar, `ops` fields ride the dashboard
 *   admin bar (both gated by the same admin bar today — the tier
 *   records provenance), and `host` fields (a module's privileged
 *   references) render READ-ONLY in the dashboard for everyone
 *   except the bot owner.
 * - CONFIG_VERSION HANDSHAKE: the descriptor declares the module
 *   config version it was written against; the host warns on mismatch,
 *   renders a visible placeholder for widgets whose key is absent from
 *   the stored config, and such widgets contribute NOTHING to a PUT —
 *   never a fabricated default.
 * - VALIDATE HOOK: `config.validate` names an optional provides
 *   function `(guild_id, candidate)` the web PUT invokes after zod so
 *   the module can refuse semantically dangerous writes (for example
 *   grantable role ids that carry privileged permissions).
 * - ACTOR_GATE: every action declares who may trigger it — `ops` (a
 *   dashboard admin, re-checked live bot-side at dispatch) or `host`
 *   (the bot owner only).
 * - NO web-bound provides may trigger a full guild member fetch.
 */

export const DASHBOARD_MANIFEST_FILENAME = 'nano-dashboard.json';

export const DASHBOARD_FIELD_TIERS = ['discord', 'ops', 'host'] as const;

export type DashboardFieldTier = (typeof DASHBOARD_FIELD_TIERS)[number];

/** Tier applied when a field declares none. */
export const DEFAULT_FIELD_TIER: DashboardFieldTier = 'discord';

export const DASHBOARD_ACTOR_GATES = ['ops', 'host'] as const;

export type DashboardActorGate = (typeof DASHBOARD_ACTOR_GATES)[number];

/** Actor gate applied when an action declares none. */
export const DEFAULT_ACTOR_GATE: DashboardActorGate = 'ops';

export const DASHBOARD_SNOWFLAKE_KINDS = ['role', 'channel', 'user'] as const;

export type DashboardSnowflakeKind =
  (typeof DASHBOARD_SNOWFLAKE_KINDS)[number];

/**
 * Human-readable descriptor text: a plain string, or a map keyed by
 * language code ('en', 'es', 'pt-br', ...). A module may be authored
 * in ANY language set — `manifest.languages` declares the codes it
 * ships (the FIRST entry is its default) and plain strings read as
 * that default. The client resolves per-reader: the reader's
 * per-module choice, then the global locale, then the module default,
 * then the first entry present.
 */
export type LocalizedText = string | Record<string, string>;

interface DashboardFieldBase {
  key: string;
  label: LocalizedText;
  help?: LocalizedText;
  tier?: DashboardFieldTier;
  /** Human note describing when a change takes effect (lazy paths). */
  propagation?: LocalizedText;
  /** Action ids the client offers after this field changes on a PUT. */
  offer_actions?: string[];
}

export interface DashboardBooleanField extends DashboardFieldBase {
  type: 'boolean';
  default?: boolean;
}

export interface DashboardNumberField extends DashboardFieldBase {
  type: 'number';
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface DashboardTextField extends DashboardFieldBase {
  type: 'text';
  default?: string;
  placeholder?: LocalizedText;
  /** Client-side validation hint (a regex source string). */
  pattern?: string;
}

export interface DashboardTemplateField extends DashboardFieldBase {
  type: 'template';
  default?: string;
  placeholder?: LocalizedText;
  /** Substitution slot names the template accepts (e.g. user, guild). */
  slots?: string[];
}

export interface DashboardColorField extends DashboardFieldBase {
  type: 'color';
  default?: string;
}

export interface DashboardSelectField extends DashboardFieldBase {
  type: 'select';
  options: string[];
  default?: string;
}

export interface DashboardSnowflakeField extends DashboardFieldBase {
  type: 'snowflake';
  kind: DashboardSnowflakeKind;
  /** Free-text input hint when no picker is available (users). */
  placeholder?: LocalizedText;
}

export interface DashboardSnowflakeListField extends DashboardFieldBase {
  type: 'snowflake_list';
  kind: DashboardSnowflakeKind;
  min?: number;
  max?: number;
}

export interface DashboardGroupField extends DashboardFieldBase {
  type: 'group';
  fields: DashboardField[];
}

export interface DashboardArrayField extends DashboardFieldBase {
  type: 'array';
  /** Spec of one element; its key names the element in issue paths. */
  item: DashboardField;
  /** Ordered arrays render reorder controls; order is meaningful. */
  ordered?: boolean;
  min?: number;
  max?: number;
}

export interface DashboardVariantCase {
  /** The discriminator value selecting this case (a config value). */
  value: string;
  label?: LocalizedText;
  fields: DashboardField[];
}

export interface DashboardVariantField extends DashboardFieldBase {
  type: 'variant';
  /** Property name inside the value whose content picks the case. */
  discriminator: string;
  variants: DashboardVariantCase[];
}

export type DashboardField =
  | DashboardBooleanField
  | DashboardNumberField
  | DashboardTextField
  | DashboardTemplateField
  | DashboardColorField
  | DashboardSelectField
  | DashboardSnowflakeField
  | DashboardSnowflakeListField
  | DashboardGroupField
  | DashboardArrayField
  | DashboardVariantField;

export interface DashboardColumn {
  key: string;
  label: LocalizedText;
}

export interface DashboardDataView {
  id: string;
  title: LocalizedText;
  /** Provides function NAME; guild_id is auto-injected first. */
  provides: string;
  /** Short hover hint for the view header. */
  help?: LocalizedText;
  /** Longer how-to-read text shown beside raw payloads. */
  explain?: LocalizedText;
  columns?: DashboardColumn[];
  /** Extra inputs collected from the user (tier is ignored here). */
  params?: DashboardField[];
  /** Manual views are NEVER auto-loaded by the client — declare it
      on anything expensive (the member-fetch law). */
  manual?: boolean;
  /** Per-guild read cooldown, seconds (CooldownManager-backed). */
  cooldown_s?: number;
}

export interface DashboardAction {
  id: string;
  label: LocalizedText;
  /** Provides function NAME; guild_id is auto-injected first. */
  provides: string;
  /** Short hover hint describing what the action does. */
  help?: LocalizedText;
  /** Actions sharing a group render as one container of buttons. */
  group?: string;
  /** true renders a confirm step; text customizes its message. */
  confirm?: boolean | LocalizedText;
  danger?: boolean;
  actor_gate?: DashboardActorGate;
  /** Per-guild dispatch cooldown, seconds (CooldownManager-backed). */
  cooldown_s?: number;
  params?: DashboardField[];
}

/** A shields-style badge: external image, optional click-through. */
export interface DashboardBadge {
  image: string;
  href?: string;
  alt: LocalizedText;
}

/**
 * One presentation media entry. `image` src is either a file inside
 * the module's nano-dashboard-assets/ directory (served by the
 * host, traversal-safe) or an absolute https URL. `youtube` embeds
 * click-to-load through the nocookie host; `x` embeds a post by its
 * status id the same click-to-load way.
 */
export type DashboardMediaItem =
  | { kind: 'image'; src: string; alt?: LocalizedText }
  | { kind: 'youtube'; id: string; title?: LocalizedText }
  | { kind: 'x'; id: string; title?: LocalizedText };

/** One command the module answers to, shown as a tag. */
export interface DashboardCommandTag {
  name: string;
  help?: LocalizedText;
}

/** The module's own presentation: what it is, badges, media,
    and the command surface it answers to. */
export interface DashboardAbout {
  description: LocalizedText;
  badges?: DashboardBadge[];
  media?: DashboardMediaItem[];
  commands?: DashboardCommandTag[];
}

export interface DashboardConfigSection {
  fields: DashboardField[];
  /** Optional provides name invoked as (guild_id, candidate) on PUT. */
  validate?: string;
}

export interface DashboardActionGroup {
  id: string;
  title?: LocalizedText;
  /** One usage-focused sentence shown on the group's row. */
  help?: LocalizedText;
  /** A data view id offering the context this group's inputs need. */
  see?: string;
}

export interface DashboardManifest {
  title: LocalizedText;
  /** Optional presentation block (description, badges, media). */
  about?: DashboardAbout;
  /** Language codes this module's text ships in; the FIRST entry is
      the module's default. Absent = plain strings only. */
  languages?: string[];
  /** Module provides api_version this descriptor was written for. */
  api_version?: string;
  /** Module __config_version this descriptor was written for. */
  config_version: number;
  config: DashboardConfigSection;
  data?: DashboardDataView[];
  actions?: DashboardAction[];
  /** Metadata for action groups referenced by actions[].group. */
  action_groups?: DashboardActionGroup[];
}

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
const PROVIDES_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const LANG_PATTERN = /^[a-z]{2,3}(-[a-z0-9]+)?$/;

/* F15 DESCRIPTOR BOUNDS: refuse before parsing what no legitimate
   descriptor needs. Roles, the largest real descriptor, measures
   43 KB, JSON depth 13, field nesting 5, longest string 417 chars —
   every cap leaves it room to grow. */
export const MAX_DESCRIPTOR_BYTES = 65536;
const MAX_DESCRIPTOR_JSON_DEPTH = 32;
const MAX_FIELD_NESTING = 8;
const MAX_DESCRIPTOR_TEXT_CHARS = 2048;

/** Free-text descriptor strings all ride the same F15 char bound. */
const BOUNDED_TEXT = z.string().max(MAX_DESCRIPTOR_TEXT_CHARS);

const HTTPS_URL = z.string().regex(/^https:\/\/[^\s]+$/);

/* F19 THE SHARED IMAGE-HOST ALLOWLIST: the only external hosts a
   descriptor IMAGE url may name, and the exact list the F5 CSP
   img-src directive is built from — ONE list, maintained here.
   Click-through hrefs are navigation, not resource loads, and stay
   plain https. */
export const DASHBOARD_IMAGE_HOSTS = [
  'img.shields.io',
  'cdn.discordapp.com',
  'i.ytimg.com',
] as const;

/** The CSP img-src directive value built from the one list (F5
    consumes this — never hand-maintain a second copy). */
export function cspImgSrcDirective(): string {
  const HOSTS = DASHBOARD_IMAGE_HOSTS
    .map((host: string): string => {
      return `https://${host}`;
    })
    .join(' ');

  return `img-src 'self' ${HOSTS}`;
}

function imageHostAllowed(url: string): boolean {
  try {
    const HOST = new URL(url).hostname;

    return (DASHBOARD_IMAGE_HOSTS as readonly string[]).includes(HOST);
  } catch {
    return false;
  }
}

const IMAGE_URL = HTTPS_URL.refine(imageHostAllowed, {
  message: 'Image host is not on the dashboard image allowlist ' +
    `(${DASHBOARD_IMAGE_HOSTS.join(', ')}).`,
});
const ASSET_FILE = z.string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/i)
  .regex(
    /\.(png|jpg|jpeg|webp|gif|avif)$/i,
    'Asset files must be raster images.'
  );
const YOUTUBE_ID = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const X_STATUS_ID = z.string().regex(/^[0-9]{5,25}$/);

const LOCALIZED_TEXT: z.ZodType<LocalizedText> = z.union([
  z.string().min(1)
    .max(MAX_DESCRIPTOR_TEXT_CHARS),
  z.record(
    z.string().regex(LANG_PATTERN),
    z.string().min(1)
      .max(MAX_DESCRIPTOR_TEXT_CHARS)
  )
    .refine((map: Record<string, string>): boolean => {
      return Object.keys(map).length > 0;
    }, 'A localized text map needs at least one language entry.'),
]);

const FIELD_BASE = {
  key: z.string().regex(KEY_PATTERN),
  label: LOCALIZED_TEXT,
  help: LOCALIZED_TEXT.optional(),
  tier: z.enum(DASHBOARD_FIELD_TIERS).optional(),
  propagation: LOCALIZED_TEXT.optional(),
  offer_actions: z.array(z.string().regex(ID_PATTERN)).optional(),
};

export const DASHBOARD_FIELD_SCHEMA: z.ZodType<DashboardField> = z.lazy(
  (): z.ZodType<DashboardField> => {
    return z.discriminatedUnion('type', [
      z.object({
        ...FIELD_BASE,
        type: z.literal('boolean'),
        default: z.boolean().optional(),
      }),
      z.object({
        ...FIELD_BASE,
        type: z.literal('number'),
        default: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
      }),
      z.object({
        ...FIELD_BASE,
        type: z.literal('text'),
        default: BOUNDED_TEXT.optional(),
        placeholder: LOCALIZED_TEXT.optional(),
        pattern: BOUNDED_TEXT.optional(),
      }),
      z.object({
        ...FIELD_BASE,
        type: z.literal('template'),
        default: BOUNDED_TEXT.optional(),
        placeholder: LOCALIZED_TEXT.optional(),
        slots: z.array(BOUNDED_TEXT).optional(),
      }),
      z.object({
        ...FIELD_BASE,
        type: z.literal('color'),
        default: BOUNDED_TEXT.optional(),
      }),
      z.object({
        ...FIELD_BASE,
        type: z.literal('select'),
        options: z.array(BOUNDED_TEXT).min(1),
        default: BOUNDED_TEXT.optional(),
      }),
      z.object({
        ...FIELD_BASE,
        type: z.literal('snowflake'),
        kind: z.enum(DASHBOARD_SNOWFLAKE_KINDS),
        placeholder: LOCALIZED_TEXT.optional(),
      }),
      z.object({
        ...FIELD_BASE,
        type: z.literal('snowflake_list'),
        kind: z.enum(DASHBOARD_SNOWFLAKE_KINDS),
        min: z.number().int()
          .min(0)
          .optional(),
        max: z.number().int()
          .min(0)
          .optional(),
      }),
      z.object({
        ...FIELD_BASE,
        type: z.literal('group'),
        fields: z.array(DASHBOARD_FIELD_SCHEMA),
      }),
      z.object({
        ...FIELD_BASE,
        type: z.literal('array'),
        item: DASHBOARD_FIELD_SCHEMA,
        ordered: z.boolean().optional(),
        min: z.number().int()
          .min(0)
          .optional(),
        max: z.number().int()
          .min(0)
          .optional(),
      }),
      z.object({
        ...FIELD_BASE,
        type: z.literal('variant'),
        discriminator: z.string().regex(KEY_PATTERN),
        variants: z.array(
          z.object({
            value: z.string().min(1)
              .max(MAX_DESCRIPTOR_TEXT_CHARS),
            label: LOCALIZED_TEXT.optional(),
            fields: z.array(DASHBOARD_FIELD_SCHEMA),
          })
        ).min(1),
      }),
    ]);
  }
);

const DASHBOARD_COLUMN_SCHEMA = z.object({
  key: z.string().min(1)
    .max(MAX_DESCRIPTOR_TEXT_CHARS),
  label: LOCALIZED_TEXT,
});

const DASHBOARD_DATA_VIEW_SCHEMA = z.object({
  id: z.string().regex(ID_PATTERN),
  title: LOCALIZED_TEXT,
  provides: z.string().regex(PROVIDES_PATTERN),
  help: LOCALIZED_TEXT.optional(),
  explain: LOCALIZED_TEXT.optional(),
  columns: z.array(DASHBOARD_COLUMN_SCHEMA).optional(),
  params: z.array(DASHBOARD_FIELD_SCHEMA).optional(),
  manual: z.boolean().optional(),
  cooldown_s: z.number().int()
    .min(0)
    .optional(),
});

const DASHBOARD_ACTION_SCHEMA = z.object({
  id: z.string().regex(ID_PATTERN),
  label: LOCALIZED_TEXT,
  provides: z.string().regex(PROVIDES_PATTERN),
  help: LOCALIZED_TEXT.optional(),
  group: z.string().regex(ID_PATTERN)
    .optional(),
  confirm: z.union([z.boolean(), LOCALIZED_TEXT]).optional(),
  danger: z.boolean().optional(),
  actor_gate: z.enum(DASHBOARD_ACTOR_GATES).optional(),
  cooldown_s: z.number().int()
    .min(0)
    .optional(),
  params: z.array(DASHBOARD_FIELD_SCHEMA).optional(),
});

type IssuePath = (string | number)[];

/** Discord snowflakes are 17-20 decimal digits. */
const SNOWFLAKE_VALUE_PATTERN = /^\d{17,20}$/;

/**
 * Does a runtime VALUE match a declared field's type? The web action
 * seam runs this on every declared param (F24) so a hand-crafted
 * POST cannot smuggle a mistyped value past the declared contract.
 * Returns null on a match, else a short human-readable problem.
 */
export function dashboardValueProblem(
  field: DashboardField,
  value: unknown
): string | null {
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : `'${field.key}' must be a boolean`;
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `'${field.key}' must be a finite number`;
      }

      if (field.min !== undefined && value < field.min) {
        return `'${field.key}' must be >= ${field.min}`;
      }

      if (field.max !== undefined && value > field.max) {
        return `'${field.key}' must be <= ${field.max}`;
      }
      return null;
    }
    case 'text':
    case 'template':
    case 'color':
      return typeof value === 'string'
        ? null
        : `'${field.key}' must be a string`;
    case 'select':
      return typeof value === 'string' &&
        field.options.includes(value)
        ? null
        : `'${field.key}' must be one of: ` +
          `${field.options.join(', ')}`;
    case 'snowflake':
      return typeof value === 'string' &&
        SNOWFLAKE_VALUE_PATTERN.test(value)
        ? null
        : `'${field.key}' must be a Discord id`;
    case 'snowflake_list': {
      if (!Array.isArray(value)) {
        return `'${field.key}' must be a list of Discord ids`;
      }

      if (field.min !== undefined && value.length < field.min) {
        return `'${field.key}' needs at least ${field.min} entries`;
      }

      if (field.max !== undefined && value.length > field.max) {
        return `'${field.key}' allows at most ${field.max} entries`;
      }

      for (const _item of value) {
        if (
          typeof _item !== 'string' ||
          !SNOWFLAKE_VALUE_PATTERN.test(_item)
        ) {
          return `'${field.key}' must contain only Discord ids`;
        }
      }
      return null;
    }
    case 'group':
      return objectFieldsProblem(field.key, field.fields, value);
    case 'array': {
      if (!Array.isArray(value)) {
        return `'${field.key}' must be an array`;
      }

      if (field.min !== undefined && value.length < field.min) {
        return `'${field.key}' needs at least ${field.min} items`;
      }

      if (field.max !== undefined && value.length > field.max) {
        return `'${field.key}' allows at most ${field.max} items`;
      }

      for (const _item of value) {
        const PROBLEM = dashboardValueProblem(field.item, _item);

        if (PROBLEM !== null) {
          return PROBLEM;
        }
      }
      return null;
    }
    case 'variant': {
      if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        return `'${field.key}' must be an object`;
      }

      const PICKED = (value as Record<string, unknown>)[
        field.discriminator
      ];
      const CASE = field.variants.find(
        (item: DashboardVariantCase): boolean => {
          return item.value === PICKED;
        }
      );

      if (!CASE) {
        return `'${field.key}.${field.discriminator}' selects no ` +
          'declared case';
      }
      return objectFieldsProblem(field.key, CASE.fields, value);
    }
    /* Unreachable over the closed union; fail CLOSED if a new field
       type ever lands without a case here. */
    default:
      return `'${(field as { key: string }).key}' has an ` +
        'unchecked type';
  }
}

/** Bounded-recursion JSON depth probe: stops descending at the cap,
    so its own stack never exceeds the cap either. */
function jsonTooDeep(node: unknown, depth: number): boolean {
  if (depth > MAX_DESCRIPTOR_JSON_DEPTH) {
    return true;
  }

  if (Array.isArray(node)) {
    return node.some((item: unknown): boolean => {
      return jsonTooDeep(item, depth + 1);
    });
  }

  if (node !== null && typeof node === 'object') {
    return Object.values(node).some((item: unknown): boolean => {
      return jsonTooDeep(item, depth + 1);
    });
  }
  return false;
}

function objectFieldsProblem(
  parent_key: string,
  fields: DashboardField[],
  value: unknown
): string | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return `'${parent_key}' must be an object`;
  }

  const RECORD = value as Record<string, unknown>;

  for (const _field of fields) {
    const ITEM = RECORD[_field.key];

    if (ITEM !== undefined) {
      const PROBLEM = dashboardValueProblem(_field, ITEM);

      if (PROBLEM !== null) {
        return PROBLEM;
      }
    }
  }
  return null;
}

function checkMinMax(
  field: { min?: number; max?: number },
  path: IssuePath,
  ctx: z.RefinementCtx
): void {
  if (
    field.min !== undefined &&
    field.max !== undefined &&
    field.min > field.max
  ) {
    ctx.addIssue({
      code: 'custom',
      message: `min (${field.min}) exceeds max (${field.max}).`,
      path,
    });
  }
}

function checkField(
  field: DashboardField,
  path: IssuePath,
  action_ids: Set<string>,
  ctx: z.RefinementCtx,
  depth: number
): void {
  /* F15: the recursive vocabulary is capped — a descriptor nested
     past this is refused, which also bounds the z.lazy stack. */
  if (depth > MAX_FIELD_NESTING) {
    ctx.addIssue({
      code: 'custom',
      message: `Field nesting exceeds ${MAX_FIELD_NESTING} levels.`,
      path,
    });
    return;
  }

  for (const OFFER of field.offer_actions ?? []) {
    if (!action_ids.has(OFFER)) {
      ctx.addIssue({
        code: 'custom',
        message: `offer_actions references unknown action '${OFFER}'.`,
        path: [...path, 'offer_actions'],
      });
    }
  }

  if (field.type === 'number' ||
      field.type === 'snowflake_list' ||
      field.type === 'array') {
    checkMinMax(field, path, ctx);
  }

  if (field.type === 'group') {
    checkFields(
      field.fields,
      [...path, 'fields'],
      action_ids,
      ctx,
      depth + 1
    );
  }

  if (field.type === 'array') {
    checkField(
      field.item,
      [...path, 'item'],
      action_ids,
      ctx,
      depth + 1
    );
  }

  if (field.type === 'variant') {
    const SEEN_VALUES = new Set<string>();

    field.variants.forEach(
      (variant: DashboardVariantCase, index: number): void => {
        if (SEEN_VALUES.has(variant.value)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate variant value '${variant.value}'.`,
            path: [...path, 'variants', index],
          });
        }
        SEEN_VALUES.add(variant.value);
        checkFields(
          variant.fields,
          [...path, 'variants', index, 'fields'],
          action_ids,
          ctx,
          depth + 1
        );
      }
    );
  }
}

function checkFields(
  fields: DashboardField[],
  path: IssuePath,
  action_ids: Set<string>,
  ctx: z.RefinementCtx,
  depth: number
): void {
  const SEEN = new Set<string>();

  fields.forEach((field: DashboardField, index: number): void => {
    if (SEEN.has(field.key)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate field key '${field.key}'.`,
        path: [...path, index],
      });
    }
    SEEN.add(field.key);
    checkField(field, [...path, index], action_ids, ctx, depth);
  });
}

const COMMAND_NAME = /^\/[a-z0-9 <>|[\]_-]+$/;

const DASHBOARD_ABOUT_SCHEMA: z.ZodType<DashboardAbout> = z.object({
  description: LOCALIZED_TEXT,
  commands: z.array(z.object({
    name: z.string().regex(COMMAND_NAME),
    help: LOCALIZED_TEXT.optional(),
  })).optional(),
  badges: z.array(z.object({
    image: IMAGE_URL,
    href: HTTPS_URL.optional(),
    alt: LOCALIZED_TEXT,
  })).optional(),
  media: z.array(z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('image'),
      src: z.union([IMAGE_URL, ASSET_FILE]),
      alt: LOCALIZED_TEXT.optional(),
    }),
    z.object({
      kind: z.literal('youtube'),
      id: YOUTUBE_ID,
      title: LOCALIZED_TEXT.optional(),
    }),
    z.object({
      kind: z.literal('x'),
      id: X_STATUS_ID,
      title: LOCALIZED_TEXT.optional(),
    }),
  ])).optional(),
});

export const NANO_DASHBOARD_MANIFEST_SCHEMA: z.ZodType<DashboardManifest> =
  z.object({
    title: LOCALIZED_TEXT,
    about: DASHBOARD_ABOUT_SCHEMA.optional(),
    languages: z.array(z.string().regex(LANG_PATTERN))
      .min(1)
      .optional(),
    api_version: z.string().optional(),
    config_version: z.number().int()
      .min(1),
    config: z.object({
      fields: z.array(DASHBOARD_FIELD_SCHEMA),
      validate: z.string().regex(PROVIDES_PATTERN)
        .optional(),
    }),
    data: z.array(DASHBOARD_DATA_VIEW_SCHEMA).optional(),
    actions: z.array(DASHBOARD_ACTION_SCHEMA).optional(),
    action_groups: z.array(z.object({
      id: z.string().regex(ID_PATTERN),
      title: LOCALIZED_TEXT.optional(),
      help: LOCALIZED_TEXT.optional(),
      see: z.string().regex(ID_PATTERN)
        .optional(),
    })).optional(),
  }).superRefine(
    (manifest: DashboardManifest, ctx: z.RefinementCtx): void => {
      const ACTION_IDS = new Set<string>();

      (manifest.actions ?? []).forEach(
        (action: DashboardAction, index: number): void => {
          if (ACTION_IDS.has(action.id)) {
            ctx.addIssue({
              code: 'custom',
              message: `Duplicate action id '${action.id}'.`,
              path: ['actions', index],
            });
          }
          ACTION_IDS.add(action.id);
        }
      );

      const DATA_IDS = new Set<string>();

      (manifest.data ?? []).forEach(
        (view: DashboardDataView, index: number): void => {
          if (DATA_IDS.has(view.id)) {
            ctx.addIssue({
              code: 'custom',
              message: `Duplicate data view id '${view.id}'.`,
              path: ['data', index],
            });
          }
          DATA_IDS.add(view.id);
          checkFields(
            view.params ?? [],
            ['data', index, 'params'],
            ACTION_IDS,
            ctx,
            1
          );
        }
      );

      (manifest.actions ?? []).forEach(
        (action: DashboardAction, index: number): void => {
          checkFields(
            action.params ?? [],
            ['actions', index, 'params'],
            ACTION_IDS,
            ctx,
            1
          );
        }
      );

      checkFields(
        manifest.config.fields,
        ['config', 'fields'],
        ACTION_IDS,
        ctx,
        1
      );
    }
  );

/** Load and validate a module's nano-dashboard.json descriptor. */
export function loadDashboardManifest(
  path: string
): NanoResult<DashboardManifest> {
  if (!existsSync(path)) {
    return err(`No dashboard manifest at '${path}'.`);
  }

  try {
    /* F15: the size cap is checked BEFORE the file is read, and the
       raw JSON depth BEFORE zod — the recursive z.lazy schema never
       sees a pathological document. */
    const SIZE = statSync(path).size;

    if (SIZE > MAX_DESCRIPTOR_BYTES) {
      return err(
        `Dashboard manifest '${path}' is ${SIZE} bytes — the cap ` +
        `is ${MAX_DESCRIPTOR_BYTES}.`
      );
    }

    const RAW: unknown = JSON.parse(readFileSync(path, 'utf8'));

    if (jsonTooDeep(RAW, 1)) {
      return err(
        `Dashboard manifest '${path}' nests deeper than ` +
        `${MAX_DESCRIPTOR_JSON_DEPTH} JSON levels.`
      );
    }

    const PARSED = NANO_DASHBOARD_MANIFEST_SCHEMA.safeParse(RAW);

    if (!PARSED.success) {
      const DETAIL = PARSED.error.issues
        .map((issue: z.core.$ZodIssue): string => {
          const AT = issue.path.map(String).join('.') || '(root)';

          return `${AT}: ${issue.message}`;
        })
        .join('; ');

      return err(`Invalid dashboard manifest '${path}': ${DETAIL}`);
    }
    return ok(PARSED.data);
  } catch (error: unknown) {
    return err(error);
  }
}
