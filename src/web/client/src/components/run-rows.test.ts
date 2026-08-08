import { describe, expect, it } from 'vitest';

import type {
  DashboardAction,
  DashboardActionGroup,
  DashboardField,
  DataView
} from '../lib/types';

import RunRows from './run-rows.vue';

import { mount } from '@vue/test-utils';

const PANEL_ID: DashboardField = {
  key: 'panel_id',
  label: 'Panel id',
  type: 'text',
};

const ACTIONS: DashboardAction[] = [
  {
    id: 'publish-panel',
    label: 'Publish panel',
    provides: 'publishPanelAction',
    help: 'Post the panel message.',
    group: 'panel',
    params: [PANEL_ID],
  },
  {
    id: 'refresh-panel',
    label: 'Refresh panel',
    provides: 'refreshPanelAction',
    group: 'panel',
    params: [PANEL_ID],
  },
  {
    id: 'run-sweep',
    label: 'Run full sweep',
    provides: 'runSweepAction',
    help: 'Check every member in one pass.',
  },
];

const GROUPS: DashboardActionGroup[] = [
  {
    id: 'panel',
    title: 'Panels',
    help: 'Manage a panel message using its panel id.',
    see: 'panel-status',
  },
];

const VIEWS: DataView[] = [
  {
    id: 'panel-status',
    title: 'Panel status',
    provides: 'panelStatus',
  },
];

function mountRows(): ReturnType<typeof mount> {
  return mount(RunRows, {
    props: {
      actions: ACTIONS,
      groups: GROUPS,
      views: VIEWS,
      reference: null,
      hostOwner: false,
    },
  });
}

describe('run-rows', (): void => {
  it('groups shared actions into one complex row that leads, with' +
    ' the one-click run last', (): void => {
    const WRAPPER = mountRows();
    const ROWS = WRAPPER.findAll('.run-row');

    expect(ROWS).toHaveLength(2);
    expect(ROWS[0].classes()).toContain('complex');
    expect(ROWS[1].classes()).toContain('simple');
    /* Both panel actions share ONE deduped panel id input. */
    expect(ROWS[0].findAll('input')).toHaveLength(1);
    expect(ROWS[0].text()).toContain('panels');
    expect(ROWS[1].text()).toContain('run full sweep');
  });

  it('emits run with the group\'s typed params', async ():
  Promise<void> => {
    const WRAPPER = mountRows();

    await WRAPPER.find('.run-params input').setValue('colors');

    const PUBLISH = WRAPPER.findAll('button').find(
      (button): boolean => {
        return button.text().includes('publish');
      }
    );

    await PUBLISH?.trigger('click');

    const EMITTED = WRAPPER.emitted('run');

    expect(EMITTED).toBeTruthy();

    const [ACTION, PARAMS] = EMITTED?.[0] ?? [];

    expect((ACTION as DashboardAction).id).toBe('publish-panel');
    expect(PARAMS).toEqual({ panel_id: 'colors' });
  });

  it('renders the see-link from the group reference and emits see',
    async (): Promise<void> => {
      const WRAPPER = mountRows();
      const SEE = WRAPPER.find('.see-link');

      expect(SEE.exists()).toBe(true);
      expect(SEE.text()).toContain('panel status');

      await SEE.trigger('click');

      expect(WRAPPER.emitted('see')?.[0]).toEqual(['panel-status']);
    });
});
