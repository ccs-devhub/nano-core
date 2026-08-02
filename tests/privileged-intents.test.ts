import { Partials } from 'discord.js';
import { describe, expect, it } from 'vitest';

import {
  derivePartials,
  listPortalDisabledIntents,
  resolvePartials
} from '@/misc/utility/resolve-intents.js';
import type { NanoModule } from '@/types/nano-module.js';

const GUILD_MEMBERS_FLAG = 1 << 14;
const GUILD_MEMBERS_LIMITED_FLAG = 1 << 15;

function flagsFetch(flags: number, status: number = 200): typeof fetch {
  return (async (): Promise<Response> => {
    return new Response(JSON.stringify({ flags }), { status });
  }) as unknown as typeof fetch;
}

describe('listPortalDisabledIntents', (): void => {
  it('returns nothing when the portal toggle is on', async ():
  Promise<void> => {
    const RESULT = await listPortalDisabledIntents(
      ['GuildMembers'],
      't',
      flagsFetch(GUILD_MEMBERS_FLAG)
    );

    expect(RESULT.ok).toBe(true);

    if (RESULT.ok) {
      expect(RESULT.data).toEqual([]);
    }
  });

  it('accepts the limited (under-100-guilds) flag as enabled', async ():
  Promise<void> => {
    const RESULT = await listPortalDisabledIntents(
      ['GuildMembers'],
      't',
      flagsFetch(GUILD_MEMBERS_LIMITED_FLAG)
    );

    expect(RESULT.ok).toBe(true);

    if (RESULT.ok) {
      expect(RESULT.data).toEqual([]);
    }
  });

  it('lists intents whose portal toggle is off', async ():
  Promise<void> => {
    const RESULT = await listPortalDisabledIntents(
      ['GuildMembers', 'MessageContent'],
      't',
      flagsFetch(GUILD_MEMBERS_FLAG)
    );

    expect(RESULT.ok).toBe(true);

    if (RESULT.ok) {
      expect(RESULT.data).toEqual(['MessageContent']);
    }
  });

  it('skips the network entirely with no privileged intents', async ():
  Promise<void> => {
    const EXPLODING_FETCH = (async (): Promise<Response> => {
      throw new Error('must not be called');
    }) as unknown as typeof fetch;
    const RESULT = await listPortalDisabledIntents(
      [],
      't',
      EXPLODING_FETCH
    );

    expect(RESULT.ok).toBe(true);

    if (RESULT.ok) {
      expect(RESULT.data).toEqual([]);
    }
  });

  it('surfaces HTTP failures as NanoResult errors', async ():
  Promise<void> => {
    const RESULT = await listPortalDisabledIntents(
      ['GuildMembers'],
      'bad',
      flagsFetch(0, 401)
    );

    expect(RESULT.ok).toBe(false);

    if (!RESULT.ok) {
      expect(RESULT.error).toContain('401');
    }
  });
});

describe('derivePartials', (): void => {
  const REACTION_MODULE: NanoModule = {
    name: 'roles',
    version: '1.0.0',
    events: [{
      name: 'messageReactionAdd',
      partials: ['Message', 'Reaction', 'User'],
      execute: (): void => {},
    }],
  };
  const SILENT_MODULE: NanoModule = {
    name: 'leveling',
    version: '1.0.0',
    events: [{
      name: 'messageCreate',
      execute: (): void => {},
    }],
  };
  const NO_EVENTS_MODULE: NanoModule = {
    name: 'social',
    version: '1.0.0',
  };

  it('unions config and module partials, reports the blast radius',
    (): void => {
      const DERIVED = derivePartials(
        ['Channel'],
        [REACTION_MODULE, SILENT_MODULE, NO_EVENTS_MODULE]
      );

      expect(DERIVED.names.sort()).toEqual(
        ['Channel', 'Message', 'Reaction', 'User']
      );
      expect(DERIVED.declaring).toEqual(['roles']);
      expect(DERIVED.silent).toEqual(['leveling']);
    });

  it('derives nothing when nobody declares partials', (): void => {
    const DERIVED = derivePartials([], [SILENT_MODULE]);
    expect(DERIVED.names).toEqual([]);
    expect(DERIVED.declaring).toEqual([]);
  });
});

describe('resolvePartials', (): void => {
  it('maps names to the Partials enum and skips unknowns',
    (): void => {
      const RESOLVED = resolvePartials(['Message', 'Bogus', 'Reaction']);
      expect(RESOLVED).toEqual([Partials.Message, Partials.Reaction]);
    });
});
