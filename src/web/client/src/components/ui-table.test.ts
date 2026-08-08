import { describe, expect, it } from 'vitest';

import UiTable from './ui-table.vue';

import { mount } from '@vue/test-utils';

const COLUMNS = [
  { key: 'user_tag', label: 'User' },
  { key: 'reason', label: 'Reason' },
];

function rows(count: number): Record<string, unknown>[] {
  const RESULT: Record<string, unknown>[] = [];

  for (let i = 0; i < count; i += 1) {
    RESULT.push({
      user_tag: i === 0 ? 'kyo#0001' : `member${i}`,
      reason: i % 2 === 0 ? 'leave' : 'ban',
    });
  }
  return RESULT;
}

describe('ui-table', (): void => {
  it('searches across every column by default', async ():
  Promise<void> => {
    const WRAPPER = mount(UiTable, {
      props: { columns: COLUMNS, rows: rows(12) },
    });

    await WRAPPER.find('input.search').setValue('kyo');

    expect(WRAPPER.text()).toContain('kyo#0001');
    expect(WRAPPER.text()).toContain('1 / 1 rows');
  });

  it('scopes the search to one column with colon syntax', async ():
  Promise<void> => {
    const WRAPPER = mount(UiTable, {
      props: { columns: COLUMNS, rows: rows(12) },
    });

    /* 'leave' appears only in the reason column; scoping by the
       User column must therefore match nothing. */
    await WRAPPER.find('input.search').setValue('user: leave');

    expect(WRAPPER.text()).toContain('0 / 0 rows');

    await WRAPPER.find('input.search').setValue('reason: leave');

    expect(WRAPPER.text()).toContain('6 / 6 rows');
  });

  it('paginates past the page size', async (): Promise<void> => {
    const WRAPPER = mount(UiTable, {
      props: { columns: COLUMNS, rows: rows(20), pageSize: 8 },
    });

    expect(WRAPPER.text()).toContain('8 / 20 rows');
    expect(WRAPPER.text()).toContain('page 1 / 3');

    const NEXT = WRAPPER.findAll('button').find(
      (button): boolean => {
        return button.text() === '>';
      }
    );

    await NEXT?.trigger('click');

    expect(WRAPPER.text()).toContain('page 2 / 3');
  });

  it('shows the search box even under one page of rows', ():
  void => {
    const WRAPPER = mount(UiTable, {
      props: { columns: COLUMNS, rows: rows(3) },
    });

    expect(WRAPPER.find('input.search').exists()).toBe(true);

    const EMPTY = mount(UiTable, {
      props: { columns: COLUMNS, rows: [] },
    });

    expect(EMPTY.find('input.search').exists()).toBe(false);
  });
});
