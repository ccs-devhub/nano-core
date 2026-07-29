import { describe, expect, it } from 'vitest';

import type { NanoCommand, NanoModule } from '@/types/nano-module.js';
import { moduleKind } from '@/types/nano-module.js';

const NOOP_COMMAND: NanoCommand = {
  data: {
    name: 'noop',
    toJSON: (): unknown => {
      return {};
    },
  },
  execute: async (): Promise<void> => {
    return;
  },
};

function makeModule(overrides: Partial<NanoModule>): NanoModule {
  return { name: 'm', version: '0.0.0', ...overrides };
}

describe('moduleKind', (): void => {
  it('derives extension for a module without commands', (): void => {
    expect(moduleKind(makeModule({}))).toBe('extension');
    expect(moduleKind(makeModule({
      tasks: {
        tick: (): void => {
          return;
        },
      },
    }))).toBe('extension');
  });

  it('derives command for a commands-only module', (): void => {
    expect(moduleKind(makeModule({ commands: [NOOP_COMMAND] })))
      .toBe('command');
  });

  it('derives hybrid for commands plus events', (): void => {
    expect(moduleKind(makeModule({
      commands: [NOOP_COMMAND],
      events: [{
        name: 'guildMemberAdd',
        execute: (): void => {
          return;
        },
      }],
    }))).toBe('hybrid');
  });

  it('lets a declared kind win over derivation', (): void => {
    expect(moduleKind(makeModule({
      kind: 'extension',
      commands: [NOOP_COMMAND],
    }))).toBe('extension');
  });
});
