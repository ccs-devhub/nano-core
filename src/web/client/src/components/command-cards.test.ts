import { describe, expect, it } from 'vitest';

import type { CommandSummary, GuildReference } from '../lib/types';

import CommandCards from './command-cards.vue';

import { mount } from '@vue/test-utils';

const COMMANDS: CommandSummary[] = [
  {
    name: 'roles',
    description: 'Role management.',
    default_member_permissions: null,
    cooldown: null,
    help: {
      long: 'Manage roles by hand.',
      usage: '/roles <grant|revoke> <member> <role>',
      examples: ['/roles grant @kyo @Blue'],
      subcommands: {
        grant: {
          long: 'Grant one role.',
          usage: '/roles grant <member> <role>',
          examples: [],
        },
      },
    },
    args: [],
    subcommands: [
      {
        path: 'grant',
        description: 'Grant a role.',
        args: [
          {
            name: 'member',
            description: 'Who',
            type: 6,
            required: true,
          },
        ],
        help: null,
      },
      {
        path: 'revoke',
        description: 'Remove a role.',
        args: [],
        help: null,
      },
    ],
  },
  {
    name: 'module',
    description: 'The module manager.',
    default_member_permissions: null,
    cooldown: null,
    help: null,
    args: [],
    subcommands: [],
  },
];

const REFERENCE: GuildReference = {
  roles: [
    {
      id: '111111111111111111',
      name: 'Mods',
      color: '#fff',
      position: 1,
      managed: false,
    },
  ],
  channels: [],
};

function mountCards(): ReturnType<typeof mount> {
  return mount(CommandCards, {
    props: {
      guildId: 'g1',
      commands: COMMANDS,
      gates: {},
      ungateable: ['module'],
      reference: REFERENCE,
      counts: { commands: 2, subcommands: 2 },
    },
  });
}

describe('command-cards', (): void => {
  it('renders cards, usage, subcommand rows, and count tiles', ():
  void => {
    const WRAPPER = mountCards();

    expect(WRAPPER.text()).toContain('/roles');
    expect(WRAPPER.text())
      .toContain('/roles <grant|revoke> <member> <role>');
    /* Generated usage when the sub ships no help card. */
    expect(WRAPPER.text()).toContain('/roles grant <member>');
    expect(WRAPPER.text()).toContain('/roles revoke');
    /* Count tiles at the bottom. */
    expect(WRAPPER.findAll('.stat-entry')).toHaveLength(3);
  });

  it('keeps the recovery command switchless', (): void => {
    const WRAPPER = mountCards();
    const CARDS = WRAPPER.findAll('.command-card');

    expect(CARDS[1].text()).toContain('/module');
    expect(CARDS[1].findAll('[role="switch"]')).toHaveLength(0);
  });

  it('emits the whole gates object when a path toggles', async ():
  Promise<void> => {
    const WRAPPER = mountCards();
    const SWITCH = WRAPPER.find('[role="switch"]');

    await SWITCH.trigger('click');

    const EMITTED = WRAPPER.emitted('update:gates');

    expect(EMITTED).toBeTruthy();
    expect(EMITTED?.[0]?.[0])
      .toEqual({ roles: { enabled: false } });
  });
});
