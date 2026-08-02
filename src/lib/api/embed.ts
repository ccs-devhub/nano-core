import type { ColorResolvable } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

import { getTheme } from '@/api/theme.js';
import { NANO_VERSION } from '@/constants/nano.js';
import {
  TEXT_FOOTER_CORE,
  TEXT_FOOTER_MODULE
} from '@/constants/text.js';
import {
  UI_COLOR_ERROR,
  UI_COLOR_INFO,
  UI_COLOR_SUCCESS,
  UI_SPACER
} from '@/constants/ui.js';
import { fillSlots } from '@/misc/utility/format.js';

export interface EmbedFieldSpec {
  name: string;
  value: string;
  inline?: boolean;
}

/**
 * JSON-friendly embed description. Anything (a command, an AI tool, an
 * external module) can produce this plain object and get a fully styled
 * discord.js embed back.
 */
export interface EmbedSpec {
  title?: string;
  description?: string;
  url?: string;
  color?: string | number;
  theme?: string;
  fields?: EmbedFieldSpec[];
  image_url?: string;
  thumbnail_url?: string;
  footer_text?: string;
  footer_icon_url?: string;
  author_name?: string;
  author_icon_url?: string;
  author_url?: string;
  timestamp?: boolean;
}

const MAX_FIELDS = 25;
const MAX_DESCRIPTION = 4096;
const MAX_TITLE = 256;
const MAX_FIELD_NAME = 256;
const MAX_FIELD_VALUE = 1024;
const TRUNCATION_MARK = '...';
const GRID_COLUMNS = 2;

/** Never emit an empty name/value (Discord rejects both). */
function truncateField(text: string, max_length: number): string {
  const SAFE = text.length > 0 ? text : UI_SPACER;

  if (SAFE.length <= max_length) {
    return SAFE;
  }
  const CUT = SAFE.slice(0, max_length - TRUNCATION_MARK.length);
  return `${CUT}${TRUNCATION_MARK}`;
}

const CORE_MODULE_NAMES = ['nano', 'core'];

/**
 * The identity footer for a card owned by a module: kernel/core
 * surfaces wear the nano-core identity (dynamic version + status),
 * every other module wears its own name and version. Footers are
 * plain text by platform rule, so no links here.
 */
export function moduleFooter(
  module_name?: string,
  module_version?: string
): string {
  if (!module_name || CORE_MODULE_NAMES.includes(module_name)) {
    return fillSlots(TEXT_FOOTER_CORE, { version: NANO_VERSION });
  }
  return fillSlots(TEXT_FOOTER_MODULE, {
    module: module_name,
    version: module_version ?? NANO_VERSION,
  });
}

/** An invisible inline field (fills the third grid slot). */
export function spacerField(): EmbedFieldSpec {
  return { name: UI_SPACER, value: UI_SPACER, inline: true };
}

/**
 * Lay fields out as a two-column grid: every field becomes inline
 * and a spacer fills each row's third slot, so pairs render side by
 * side (the house card style). An odd tail field gets its own row.
 */
export function gridFields(fields: EmbedFieldSpec[]): EmbedFieldSpec[] {
  const GRID: EmbedFieldSpec[] = [];

  for (let index = 0; index < fields.length; index += GRID_COLUMNS) {
    const PAIR = fields.slice(index, index + GRID_COLUMNS);

    for (const _field of PAIR) {
      GRID.push({ ..._field, inline: true });
    }

    if (PAIR.length === GRID_COLUMNS) {
      GRID.push(spacerField());
    }
  }
  return GRID;
}

/**
 * Build a themed EmbedBuilder from a plain EmbedSpec. Discord's hard
 * limits (25 fields, 4096-char description, 256-char title) are
 * enforced by truncation so a spec can never throw at send time.
 */
export function buildEmbed(
  spec: EmbedSpec,
  theme_name?: string
): EmbedBuilder {
  const THEME = getTheme(theme_name ?? spec.theme);
  const BUILDER = new EmbedBuilder();

  BUILDER.setColor((spec.color as ColorResolvable | undefined) ?? THEME.color);

  if (spec.title) {
    BUILDER.setTitle(spec.title.slice(0, MAX_TITLE));
  }

  if (spec.description) {
    BUILDER.setDescription(spec.description.slice(0, MAX_DESCRIPTION));
  }

  if (spec.url) {
    BUILDER.setURL(spec.url);
  }

  if (spec.fields?.length) {
    /* Discord rejects an over-long field name or value with a 400,
       and addFields throws before that — truncate so a spec can
       never kill the command that built it. */
    BUILDER.addFields(
      spec.fields.slice(0, MAX_FIELDS)
        .map((field: EmbedFieldSpec): EmbedFieldSpec => {
          return {
            name: truncateField(field.name, MAX_FIELD_NAME),
            value: truncateField(field.value, MAX_FIELD_VALUE),
            inline: field.inline,
          };
        })
    );
  }

  if (spec.image_url) {
    BUILDER.setImage(spec.image_url);
  }

  if (spec.thumbnail_url) {
    BUILDER.setThumbnail(spec.thumbnail_url);
  }

  const FOOTER_TEXT = spec.footer_text ?? THEME.footer_text;

  if (FOOTER_TEXT) {
    BUILDER.setFooter({
      text: FOOTER_TEXT,
      iconURL: spec.footer_icon_url ?? THEME.footer_icon_url,
    });
  }

  if (spec.author_name) {
    BUILDER.setAuthor({
      name: spec.author_name,
      iconURL: spec.author_icon_url,
      url: spec.author_url,
    });
  }

  if (spec.timestamp) {
    BUILDER.setTimestamp();
  }

  return BUILDER;
}

const SUCCESS_COLOR = UI_COLOR_SUCCESS;
const ERROR_COLOR = UI_COLOR_ERROR;
const INFO_COLOR = UI_COLOR_INFO;

/** A green confirmation embed. */
export function successEmbed(text: string): EmbedBuilder {
  return buildEmbed({ description: text, color: SUCCESS_COLOR });
}

/** A red failure embed. */
export function errorEmbed(text: string): EmbedBuilder {
  return buildEmbed({ description: text, color: ERROR_COLOR });
}

/** A blurple informational embed. */
export function infoEmbed(text: string): EmbedBuilder {
  return buildEmbed({ description: text, color: INFO_COLOR });
}
