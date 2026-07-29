import type { EmbedBuilder } from 'discord.js';

import type { EmbedFieldSpec, EmbedSpec } from '@/api/embed.js';
import { buildEmbed } from '@/api/embed.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * Named, reusable embed layouts. A template is an EmbedSpec whose
 * string fields may contain `{{slot}}` placeholders; rendering fills
 * the slots, applies overrides (e.g. an attached image), and returns
 * a fully themed embed. Core ships the `default` template so every
 * embed is covered with default styling before any module installs;
 * modules register their own on enable (like themes).
 */
export interface EmbedTemplate {
  name: string;
  description?: string;
  /** Slot names the spec consumes; derived from the spec if omitted. */
  slots?: string[];
  spec: EmbedSpec;
}

const SLOT_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

const TEMPLATES = new Map<string, EmbedTemplate>();

export const DEFAULT_EMBED_TEMPLATE: EmbedTemplate = {
  name: 'default',
  description: 'Plain themed embed: a title and a body.',
  spec: {
    title: '{{title}}',
    description: '{{description}}',
    timestamp: true,
  },
};

/** Every {{slot}} name referenced anywhere in a spec. */
export function collectTemplateSlots(spec: EmbedSpec): string[] {
  const FOUND = new Set<string>();
  const SCAN = (value?: string): void => {
    for (const _match of (value ?? '').matchAll(SLOT_PATTERN)) {
      FOUND.add(_match[1].toLowerCase());
    }
  };

  SCAN(spec.title);
  SCAN(spec.description);
  SCAN(spec.footer_text);
  SCAN(spec.author_name);

  for (const _field of spec.fields ?? []) {
    SCAN(_field.name);
    SCAN(_field.value);
  }
  return Array.from(FOUND);
}

export function registerEmbedTemplate(
  template: EmbedTemplate
): NanoResult<string> {
  if (!template.name) {
    return err('Embed template needs a name.');
  }

  TEMPLATES.set(template.name, {
    ...template,
    slots: template.slots ?? collectTemplateSlots(template.spec),
  });
  return ok(template.name);
}

export function getEmbedTemplate(name: string): EmbedTemplate | undefined {
  return TEMPLATES.get(name);
}

export function listEmbedTemplates(): EmbedTemplate[] {
  return Array.from(TEMPLATES.values());
}

/**
 * Replace every `{{slot}}` with its value (missing slots become '');
 * the input spec is never mutated.
 */
export function fillTemplateSlots(
  spec: EmbedSpec,
  slots: Record<string, string>
): EmbedSpec {
  const FILL = (value?: string): string | undefined => {
    if (value === undefined) {
      return undefined;
    }

    const FILLED = value.replace(
      SLOT_PATTERN,
      (full: string, key: string): string => {
        return slots[key.toLowerCase()] ?? '';
      }
    ).trim();
    return FILLED.length > 0 ? FILLED : undefined;
  };

  return {
    ...spec,
    title: FILL(spec.title),
    description: FILL(spec.description),
    footer_text: FILL(spec.footer_text),
    author_name: FILL(spec.author_name),
    fields: spec.fields?.map((field: EmbedFieldSpec): EmbedFieldSpec => {
      return {
        name: FILL(field.name) ?? '',
        value: FILL(field.value) ?? '',
        inline: field.inline,
      };
    }).filter((field: EmbedFieldSpec): boolean => {
      return field.name.length > 0 && field.value.length > 0;
    }),
  };
}

/**
 * Render a registered template: fill its slots, apply spec overrides
 * (overrides win — e.g. an attached image or a forced theme), and
 * build the themed embed.
 */
export function renderEmbedTemplate(
  name: string,
  slots: Record<string, string> = {},
  overrides: Partial<EmbedSpec> = {}
): NanoResult<EmbedBuilder> {
  const TEMPLATE = TEMPLATES.get(name);

  if (!TEMPLATE) {
    const KNOWN = listEmbedTemplates()
      .map((template: EmbedTemplate): string => {
        return template.name;
      })
      .join(', ');
    return err(`Unknown embed template '${name}'. Known: ${KNOWN}.`);
  }

  const FILLED = fillTemplateSlots(TEMPLATE.spec, slots);
  const SPEC: EmbedSpec = { ...FILLED, ...overrides };
  return ok(buildEmbed(SPEC, SPEC.theme));
}

registerEmbedTemplate(DEFAULT_EMBED_TEMPLATE);
