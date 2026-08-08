import { describe, expect, it } from 'vitest';

import type {
  ArrayField,
  DashboardField,
  GuildReference,
  VariantField
} from '../lib/types';
import { defaultFor } from '../lib/widget-defaults';

import WidgetHost from './widget-host.vue';

import { mount } from '@vue/test-utils';

const REFERENCE: GuildReference = {
  roles: [
    {
      id: 'r1',
      name: 'Members',
      color: '#aabbcc',
      position: 3,
      managed: false,
    },
    {
      id: 'r2',
      name: 'Divider',
      color: '#000000',
      position: 2,
      managed: false,
    },
  ],
  channels: [
    { id: 'c1', name: 'general', type: 0, parent_id: null },
  ],
};

function mountWidget(
  field: DashboardField,
  model_value: unknown,
  host_owner = true
): ReturnType<typeof mount> {
  return mount(WidgetHost, {
    props: {
      field,
      modelValue: model_value,
      reference: REFERENCE,
      hostOwner: host_owner,
    },
  });
}

describe('widget-host', (): void => {
  it('renders and toggles a boolean via the slider', async ():
  Promise<void> => {
    const WRAPPER = mountWidget(
      { key: 'enabled', label: 'Enabled', type: 'boolean' },
      false
    );
    const SWITCH = WRAPPER.find('button[role="switch"]');

    expect(SWITCH.exists()).toBe(true);
    await SWITCH.trigger('click');

    expect(WRAPPER.emitted('update:modelValue')?.[0]).toEqual([true]);
  });

  it('edits text and number fields', async (): Promise<void> => {
    const TEXT = mountWidget(
      { key: 'greeting', label: 'Greeting', type: 'text' },
      'hi'
    );

    await TEXT.find('input[type="text"]').setValue('hello');

    expect(TEXT.emitted('update:modelValue')?.[0]).toEqual(['hello']);

    const NUMBER = mountWidget(
      { key: 'count', label: 'Count', type: 'number' },
      1
    );

    await NUMBER.find('input[type="number"]').setValue('5');

    expect(NUMBER.emitted('update:modelValue')?.[0]).toEqual([5]);
  });

  it('renders a role picker from the reference', async ():
  Promise<void> => {
    const WRAPPER = mountWidget(
      {
        key: 'role_id',
        label: 'Role',
        type: 'snowflake',
        kind: 'role',
      },
      ''
    );

    expect(WRAPPER.find('.ui-select').exists()).toBe(true);

    await WRAPPER.find('.ui-select .trigger').trigger('click');

    expect(WRAPPER.text()).toContain('Members');

    const OPTION = WRAPPER.findAll('.ui-select .option').find(
      (option): boolean => {
        return option.text() === 'Members';
      }
    );

    await OPTION?.trigger('click');

    expect(WRAPPER.emitted('update:modelValue')?.[0]).toEqual(['r1']);
  });

  it('falls back to free text for user snowflakes', (): void => {
    const WRAPPER = mountWidget(
      {
        key: 'user_id',
        label: 'User',
        type: 'snowflake',
        kind: 'user',
      },
      ''
    );

    expect(WRAPPER.find('.ui-select').exists()).toBe(false);
    expect(WRAPPER.find('input[type="text"]').exists()).toBe(true);
  });

  it('adds and removes snowflake_list entries', async ():
  Promise<void> => {
    const WRAPPER = mountWidget(
      {
        key: 'sanction_roles',
        label: 'Sanction roles',
        type: 'snowflake_list',
        kind: 'role',
      },
      ['r2']
    );

    expect(WRAPPER.text()).toContain('Divider');

    await WRAPPER.find('.add-row .trigger').trigger('click');

    const OPTION = WRAPPER.findAll('.add-row .option').find(
      (option): boolean => {
        return option.text() === 'Members';
      }
    );

    await OPTION?.trigger('click');

    const EMITTED = WRAPPER.emitted('update:modelValue');

    expect(EMITTED?.[0]).toEqual([['r2', 'r1']]);
  });

  it('nests groups and merges child updates', async ():
  Promise<void> => {
    const WRAPPER = mountWidget(
      {
        key: 'gates',
        label: 'Gates',
        type: 'group',
        fields: [
          { key: 'max_picks', label: 'Max picks', type: 'number' },
          { key: 'strict', label: 'Strict', type: 'boolean' },
        ],
      },
      { max_picks: 3, strict: false }
    );

    await WRAPPER.find('input[type="number"]').setValue('7');

    expect(WRAPPER.emitted('update:modelValue')?.[0]).toEqual([
      { max_picks: 7, strict: false },
    ]);
  });

  it('adds, reorders, and removes ordered array items', async ():
  Promise<void> => {
    const FIELD: ArrayField = {
      key: 'sections',
      label: 'Sections',
      type: 'array',
      ordered: true,
      item: { key: 'section', label: 'Section', type: 'text' },
    };
    const WRAPPER = mountWidget(FIELD, ['alpha', 'beta']);
    const BUTTONS = WRAPPER.findAll('button');
    const DOWN = BUTTONS.find(
      (button): boolean => {
        return button.attributes('data-tip') === 'move down' &&
          !button.attributes('disabled');
      }
    );

    await DOWN?.trigger('click');

    expect(WRAPPER.emitted('update:modelValue')?.[0]).toEqual([
      ['beta', 'alpha'],
    ]);

    const ADD = BUTTONS.find((button): boolean => {
      return button.text().startsWith('add');
    });

    await ADD?.trigger('click');

    const EMITTED = WRAPPER.emitted('update:modelValue');

    expect(EMITTED?.[1]).toEqual([['alpha', 'beta', '']]);
  });

  it('switches variant cases and resets case fields', async ():
  Promise<void> => {
    const FIELD: VariantField = {
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
        { value: 'joined', fields: [] },
      ],
    };
    const WRAPPER = mountWidget(FIELD, {
      kind: 'role_added',
      role_id: 'r1',
    });

    await WRAPPER.find('.variant .trigger').trigger('click');

    const OPTION = WRAPPER.findAll('.variant .option').find(
      (option): boolean => {
        return option.text() === 'joined';
      }
    );

    await OPTION?.trigger('click');

    expect(WRAPPER.emitted('update:modelValue')?.[0]).toEqual([
      { kind: 'joined' },
    ]);
  });

  it('locks host-tier fields for non-owners (C6)', (): void => {
    const FIELD: DashboardField = {
      key: 'bot_role_id',
      label: 'Bot role',
      type: 'snowflake',
      kind: 'role',
      tier: 'host',
    };
    const LOCKED = mountWidget(FIELD, '', false);

    expect(
      LOCKED.find('.ui-select .trigger').attributes('disabled')
    ).toBeDefined();
    expect(LOCKED.text()).toContain('bot owner only');

    const OPEN = mountWidget(FIELD, '', true);

    expect(
      OPEN.find('.ui-select .trigger').attributes('disabled')
    ).toBeUndefined();
  });

  it('produces sensible defaults for every widget type', (): void => {
    expect(defaultFor({
      key: 'x', label: 'X', type: 'boolean',
    })).toBe(false);
    expect(defaultFor({
      key: 'x',
      label: 'X',
      type: 'select',
      options: ['a', 'b'],
    })).toBe('a');
    expect(defaultFor({
      key: 'x',
      label: 'X',
      type: 'group',
      fields: [{ key: 'y', label: 'Y', type: 'number' }],
    })).toEqual({ y: 0 });
    expect(defaultFor({
      key: 'x',
      label: 'X',
      type: 'variant',
      discriminator: 'kind',
      variants: [
        {
          value: 'a',
          fields: [{ key: 'z', label: 'Z', type: 'text' }],
        },
      ],
    })).toEqual({ kind: 'a', z: '' });
  });
});
