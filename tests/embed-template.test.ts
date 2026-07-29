import { describe, expect, it } from 'vitest';

import type { EmbedTemplate } from '@/api/embed-template.js';
import {
  collectTemplateSlots,
  fillTemplateSlots,
  getEmbedTemplate,
  listEmbedTemplates,
  registerEmbedTemplate,
  renderEmbedTemplate
} from '@/api/embed-template.js';

describe('embed templates', (): void => {
  it('ships the default template out of the box', (): void => {
    const DEFAULT = getEmbedTemplate('default');

    expect(DEFAULT).toBeDefined();
    expect(DEFAULT?.slots).toEqual(['title', 'description']);
  });

  it('derives slots from the spec on registration', (): void => {
    const RESULT = registerEmbedTemplate({
      name: 'greeting',
      spec: {
        title: 'Hello {{user}}',
        description: '{{message}}',
        fields: [{ name: 'Guild', value: '{{guild}}' }],
      },
    });

    expect(RESULT.ok).toBe(true);
    expect(getEmbedTemplate('greeting')?.slots)
      .toEqual(['user', 'message', 'guild']);
    expect(listEmbedTemplates().map((template: EmbedTemplate): string => {
      return template.name;
    })).toContain('greeting');
  });

  it('fills slots, drops empty fields, never mutates', (): void => {
    const SPEC = {
      title: '{{title}}',
      description: 'Hi {{user}}!',
      fields: [
        { name: 'Left', value: '{{gone}}' },
        { name: 'Kept', value: 'static' },
      ],
    };
    const FILLED = fillTemplateSlots(SPEC, { user: 'Kyo' });

    expect(FILLED.title).toBeUndefined();
    expect(FILLED.description).toBe('Hi Kyo!');
    expect(FILLED.fields).toEqual([{
      name: 'Kept',
      value: 'static',
      inline: undefined,
    }]);
    expect(SPEC.description).toBe('Hi {{user}}!');
  });

  it('renders a registered template with overrides winning', (): void => {
    const RESULT = renderEmbedTemplate(
      'default',
      { title: 'Ping', description: 'Pong' },
      { image_url: 'https://example.com/i.png' }
    );

    expect(RESULT.ok).toBe(true);

    if (RESULT.ok) {
      const DATA = RESULT.data.toJSON();
      expect(DATA.title).toBe('Ping');
      expect(DATA.description).toBe('Pong');
      expect(DATA.image?.url).toBe('https://example.com/i.png');
    }
  });

  it('rejects unknown templates with the known list', (): void => {
    const RESULT = renderEmbedTemplate('nope');

    expect(RESULT.ok).toBe(false);

    if (!RESULT.ok) {
      expect(RESULT.error).toContain('default');
    }
  });

  it('collects slots case-insensitively and deduplicated', (): void => {
    expect(collectTemplateSlots({
      title: '{{User}} and {{user}}',
      footer_text: '{{ spaced }}',
    })).toEqual(['user', 'spaced']);
  });
});
