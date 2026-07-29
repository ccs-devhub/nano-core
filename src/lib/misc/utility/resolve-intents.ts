import { ApplicationFlags, GatewayIntentBits } from 'discord.js';

import type { NanoModule } from '@/types/nano-module.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/** Intents that need a portal toggle; missing them fails silently. */
const PRIVILEGED_INTENTS = [
  'GuildMembers',
  'GuildPresences',
  'MessageContent',
];

const DISCORD_API_APPLICATION = 'https://discord.com/api/v10/applications/@me';

/*
 * Application flags that mark a privileged intent as toggled on in the
 * developer portal (full bit | the 100-guild "limited" bit).
 */
const PORTAL_FLAG_BITS = new Map<string, number>([
  ['GuildPresences', ApplicationFlags.GatewayPresence |
    ApplicationFlags.GatewayPresenceLimited],
  ['GuildMembers', ApplicationFlags.GatewayGuildMembers |
    ApplicationFlags.GatewayGuildMembersLimited],
  ['MessageContent', ApplicationFlags.GatewayMessageContent |
    ApplicationFlags.GatewayMessageContentLimited],
]);

export interface DerivedIntents {
  names: string[];
  privileged: string[];
}

/**
 * Union of the configured intents and every intent declared by the
 * loaded modules' events. Privileged ones are surfaced so boot can
 * warn loudly (they also need the developer-portal toggle).
 */
export function deriveIntents(
  config_intents: string[],
  modules: NanoModule[]
): DerivedIntents {
  const NAMES = new Set(config_intents);

  for (const _module of modules) {
    for (const _event of _module.events ?? []) {
      for (const _intent of _event.intents ?? []) {
        NAMES.add(_intent);
      }
    }
  }

  const ALL = Array.from(NAMES);
  return {
    names: ALL,
    privileged: ALL.filter((name: string): boolean => {
      return PRIVILEGED_INTENTS.includes(name);
    }),
  };
}

/**
 * Ask Discord which privileged intents are actually toggled on for
 * this application (GET /applications/@me flags) and return the
 * subset of `privileged` that is NOT enabled in the developer portal.
 * An empty list means every requested privileged intent is live.
 */
export async function listPortalDisabledIntents(
  privileged: string[],
  token: string,
  fetch_fn: typeof fetch = fetch
): Promise<NanoResult<string[]>> {
  if (privileged.length === 0) {
    return ok([]);
  }

  try {
    const RESPONSE = await fetch_fn(DISCORD_API_APPLICATION, {
      headers: { Authorization: `Bot ${token}` },
    });

    if (!RESPONSE.ok) {
      return err(`HTTP ${RESPONSE.status} fetching application flags.`);
    }

    const BODY = await RESPONSE.json() as { flags?: number };
    const FLAGS = BODY.flags ?? 0;
    return ok(privileged.filter((name: string): boolean => {
      const BITS = PORTAL_FLAG_BITS.get(name) ?? 0;
      return BITS !== 0 && (FLAGS & BITS) === 0;
    }));
  } catch (error: unknown) {
    return err(error);
  }
}

/**
 * Map intent names (e.g. 'Guilds', 'GuildMessages') to
 * GatewayIntentBits. Unknown names are logged and skipped; Guilds is
 * always included as the required baseline.
 */
export function resolveIntents(intent_names: string[]): GatewayIntentBits[] {
  const RESOLVED: GatewayIntentBits[] = [];

  for (const _name of intent_names) {
    const BIT = GatewayIntentBits[_name as keyof typeof GatewayIntentBits];

    if (typeof BIT === 'number') {
      RESOLVED.push(BIT);
    } else {
      process.stdout.write(`[WARN] Unknown gateway intent '${_name}'.\n`);
    }
  }

  if (!RESOLVED.includes(GatewayIntentBits.Guilds)) {
    RESOLVED.push(GatewayIntentBits.Guilds);
  }
  return RESOLVED;
}
