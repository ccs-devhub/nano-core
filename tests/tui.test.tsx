import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import type { FormFieldSpec } from '@/tui/components/form.js';
import { Form } from '@/tui/components/form.js';
import { ToggleList } from '@/tui/components/toggle-list.js';
import { UiStateProvider } from '@/tui/state/ui-state.js';

const FIELDS: FormFieldSpec[] = [
  { key: 'name', label: 'Bot name', type: 'text', value: 'nano-bot' },
  { key: 'pretty', label: 'Pretty logs', type: 'boolean', value: false },
  {
    key: 'driver',
    label: 'Driver',
    type: 'select',
    options: ['sqlite', 'postgres'],
    value: 'sqlite',
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
}

describe('Form', (): void => {
  it('renders fields with their values', (): void => {
    const { lastFrame } = render(
      <UiStateProvider>
        <Form fields={FIELDS} onSave={(): void => {}} />
      </UiStateProvider>
    );

    expect(lastFrame()).toContain('Bot name');
    expect(lastFrame()).toContain('nano-bot');
    expect(lastFrame()).toContain('Pretty logs');
  });

  it('toggles booleans and saves values', async (): Promise<void> => {
    const ON_SAVE = vi.fn();
    const { stdin, lastFrame } = render(
      <UiStateProvider>
        <Form fields={FIELDS} onSave={ON_SAVE} />
      </UiStateProvider>
    );

    stdin.write('j');
    await sleep(10);
    stdin.write('\r');
    await sleep(10);
    expect(lastFrame()).toContain('true');

    stdin.write('s');
    await sleep(10);
    expect(ON_SAVE).toHaveBeenCalledWith(
      expect.objectContaining({ pretty: true, name: 'nano-bot' })
    );
  });

  it('cycles select options', async (): Promise<void> => {
    const { stdin, lastFrame } = render(
      <UiStateProvider>
        <Form fields={FIELDS} onSave={(): void => {}} />
      </UiStateProvider>
    );

    stdin.write('j');
    await sleep(10);
    stdin.write('j');
    await sleep(10);
    stdin.write('\r');
    await sleep(10);

    expect(lastFrame()).toContain('postgres');
  });
});

describe('ToggleList', (): void => {
  it('renders rows and toggles with space', async (): Promise<void> => {
    const ON_TOGGLE = vi.fn();
    const { stdin, lastFrame } = render(
      <ToggleList
        rows={[
          { id: 'a', label: 'module-a', on: true },
          { id: 'b', label: 'module-b', on: false, openable: true },
        ]}
        onToggle={ON_TOGGLE}
      />
    );

    expect(lastFrame()).toContain('[x] module-a');
    expect(lastFrame()).toContain('[ ] module-b');
    expect(lastFrame()).toContain('[panel]');

    stdin.write('j');
    await sleep(10);
    stdin.write(' ');
    await sleep(10);

    expect(ON_TOGGLE).toHaveBeenCalledWith('b');
  });
});
