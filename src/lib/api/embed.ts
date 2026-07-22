import type { ColorResolvable } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

import { getTheme } from '@/api/theme.js';

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
    BUILDER.addFields(spec.fields.slice(0, MAX_FIELDS));
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

const SUCCESS_COLOR = '#57F287';
const ERROR_COLOR = '#ED4245';
const INFO_COLOR = '#5865F2';

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
