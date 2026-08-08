import { describe, expect, it } from 'vitest';

import type { CommandGatesConfig } from
  '@/services/command-gates.js';
import {
  COMMAND_GATES_SCHEMA,
  evaluateCommandGate
} from '@/services/command-gates.js';

const ACTOR = { user_id: 'u1', role_ids: ['r1', 'r2'] };

function config(
  gates: CommandGatesConfig['gates']
): CommandGatesConfig {
  return { gates };
}

describe('command gates', (): void => {
  it('parses a complete config from nothing (defaults law)', ():
  void => {
    const PARSED = COMMAND_GATES_SCHEMA.safeParse({});

    expect(PARSED.success).toBe(true);
    expect(PARSED.data?.gates).toEqual({});
  });

  it('rejects bad paths, bad snowflakes, unknown keys', (): void => {
    expect(COMMAND_GATES_SCHEMA.safeParse({
      gates: { 'Roles Grant!': { enabled: false } },
    }).success).toBe(false);
    expect(COMMAND_GATES_SCHEMA.safeParse({
      gates: { roles: { allowed_role_ids: ['not-a-snowflake'] } },
    }).success).toBe(false);
    expect(COMMAND_GATES_SCHEMA.safeParse({
      gates: { roles: { surprise: true } },
    }).success).toBe(false);
  });

  it('allows everything when no gate is stored', (): void => {
    expect(
      evaluateCommandGate(config({}), 'roles', 'grant', ACTOR).allowed
    ).toBe(true);
  });

  it('refuses a disabled command and a disabled subcommand path',
    (): void => {
      const OFF = config({ roles: { enabled: false } });

      expect(evaluateCommandGate(OFF, 'roles', undefined, ACTOR))
        .toEqual({ allowed: false, reason: 'disabled' });
      expect(evaluateCommandGate(OFF, 'roles', 'grant', ACTOR).allowed)
        .toBe(false);

      const SUB_OFF = config({ 'roles grant': { enabled: false } });

      expect(
        evaluateCommandGate(SUB_OFF, 'roles', 'grant', ACTOR).allowed
      ).toBe(false);
      /* Sibling paths stay open. */
      expect(
        evaluateCommandGate(SUB_OFF, 'roles', 'revoke', ACTOR).allowed
      ).toBe(true);
    });

  it('limits to allowed roles or users, empty lists mean everyone',
    (): void => {
      const LIMITED = config({
        roles: { allowed_role_ids: ['r9'], allowed_user_ids: ['u9'] },
      });

      expect(
        evaluateCommandGate(LIMITED, 'roles', undefined, ACTOR)
      ).toEqual({ allowed: false, reason: 'not_allowed' });
      expect(
        evaluateCommandGate(LIMITED, 'roles', undefined, {
          user_id: 'u9',
          role_ids: [],
        }).allowed
      ).toBe(true);
      expect(
        evaluateCommandGate(LIMITED, 'roles', undefined, {
          user_id: 'u2',
          role_ids: ['r9'],
        }).allowed
      ).toBe(true);

      const EMPTY = config({
        roles: { allowed_role_ids: [], allowed_user_ids: [] },
      });

      expect(
        evaluateCommandGate(EMPTY, 'roles', undefined, ACTOR).allowed
      ).toBe(true);
    });

  it('never gates the recovery command', (): void => {
    const LOCKDOWN = config({
      module: { enabled: false, allowed_user_ids: ['nobody'] },
    });

    expect(
      evaluateCommandGate(LOCKDOWN, 'module', undefined, ACTOR).allowed
    ).toBe(true);
  });
});
