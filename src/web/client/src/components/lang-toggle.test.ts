import { describe, expect, it } from 'vitest';

import LangToggle from './lang-toggle.vue';

import { mount } from '@vue/test-utils';

describe('lang-toggle', (): void => {
  it('renders every code, marks the active one, and emits picks',
    async (): Promise<void> => {
      const WRAPPER = mount(LangToggle, {
        props: {
          options: ['en', 'es'],
          modelValue: 'es',
          label: 'interface language',
        },
      });

      const BUTTONS = WRAPPER.findAll('button');

      expect(BUTTONS).toHaveLength(2);
      expect(BUTTONS[1].classes()).toContain('active');

      await BUTTONS[0].trigger('click');

      expect(WRAPPER.emitted('update:modelValue')?.[0])
        .toEqual(['en']);
    });

  it('offers the auto choice for per-module toggles', async ():
  Promise<void> => {
    const WRAPPER = mount(LangToggle, {
      props: {
        options: ['en', 'es'],
        modelValue: '',
        label: 'module language',
        auto: true,
        autoLabel: 'auto',
      },
    });

    const BUTTONS = WRAPPER.findAll('button');

    expect(BUTTONS).toHaveLength(3);
    expect(BUTTONS[0].text()).toBe('auto');
    expect(BUTTONS[0].classes()).toContain('active');

    await BUTTONS[2].trigger('click');

    expect(WRAPPER.emitted('update:modelValue')?.[0])
      .toEqual(['es']);
  });
});
