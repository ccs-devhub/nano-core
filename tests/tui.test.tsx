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

/* THE FLAKE POSTURE: under full-suite worker contention ink-testing
   can drop, delay or reorder keystrokes (a captured failure shows a
   delayed enter opening the TEXT field's edit mode and navigation
   keys typed as literal text). No amount of in-test convergence
   survives arbitrary reordering, so the interactive tests use simple
   deterministic key sequences with marker waits and DECLARED RETRIES
   - each retry remounts a fresh component, and a clean mount passes
   deterministically. */
const POLL_MS = 5;
const WAIT_TIMEOUT_MS = 2000;
const INTERACTIVE_RETRY = 3;
const INTERACTIVE_TEST_TIMEOUT_MS = 15000;

async function waitForText(
  read: () => string | undefined,
  needle: string
): Promise<void> {
  const DEADLINE = Date.now() + WAIT_TIMEOUT_MS;

  while (Date.now() < DEADLINE) {
    if ((read() ?? '').includes(needle)) {
      return;
    }
    await sleep(POLL_MS);
  }
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

  it(
    'toggles booleans and saves values',
    { retry: INTERACTIVE_RETRY, timeout: INTERACTIVE_TEST_TIMEOUT_MS },
    async (): Promise<void> => {
      const ON_SAVE = vi.fn();
      const { stdin, lastFrame } = render(
        <UiStateProvider>
          <Form fields={FIELDS} onSave={ON_SAVE} />
        </UiStateProvider>
      );

      stdin.write('j');
      await waitForText(lastFrame, '> Pretty logs');
      stdin.write('\r');
      await waitForText(lastFrame, 'true');
      expect(lastFrame()).toContain('true');

      stdin.write('s');

      const DEADLINE = Date.now() + WAIT_TIMEOUT_MS;

      while (
        Date.now() < DEADLINE &&
        ON_SAVE.mock.calls.length === 0
      ) {
        await sleep(POLL_MS);
      }
      expect(ON_SAVE).toHaveBeenCalledWith(
        expect.objectContaining({ pretty: true, name: 'nano-bot' })
      );
    }
  );

  it(
    'cycles select options',
    { retry: INTERACTIVE_RETRY, timeout: INTERACTIVE_TEST_TIMEOUT_MS },
    async (): Promise<void> => {
      const { stdin, lastFrame } = render(
        <UiStateProvider>
          <Form fields={FIELDS} onSave={(): void => {}} />
        </UiStateProvider>
      );

      stdin.write('j');
      await waitForText(lastFrame, '> Pretty logs');
      stdin.write('j');
      await waitForText(lastFrame, '> Driver');
      stdin.write('\r');
      await waitForText(lastFrame, 'postgres');

      expect(lastFrame()).toContain('postgres');
    }
  );
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
