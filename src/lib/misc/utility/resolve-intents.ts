import { GatewayIntentBits } from 'discord.js';

import type { NanoModule } from '@/types/nano-module.js';

/** Intents that need a portal toggle; missing them fails silently. */
const PRIVILEGED_INTENTS = [
  'GuildMembers',
  'GuildPresences',
  'MessageContent',
];

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
