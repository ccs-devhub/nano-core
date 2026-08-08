import { reactive } from 'vue';

import type { GuildMemberInfo } from './api';
import { getGuildMember } from './api';
import type { Envelope } from './types';

/**
 * The member-name resolver: one SINGLE-member fetch per id (the
 * opcode-8 law budgets list fetches, not singles), cached and
 * deduped for the whole session. `memberLabel` is render-safe —
 * it returns the id until the name lands, then Vue re-renders
 * through the reactive store. A failed lookup pins the id so it
 * never refetches in a loop.
 */
const NAMES = reactive<Record<string, string>>({});
const INFLIGHT = new Set<string>();

/** provide/inject key: the guild id of the enclosing window. */
export const GUILD_ID_KEY = 'nano-guild-id';

export function memberLabel(
  guild_id: string,
  user_id: string
): string {
  if (!guild_id || !user_id) {
    return user_id;
  }

  const KEY = `${guild_id}:${user_id}`;
  const KNOWN = NAMES[KEY];

  if (KNOWN !== undefined) {
    return KNOWN === '' ? user_id : KNOWN;
  }

  if (!INFLIGHT.has(KEY)) {
    INFLIGHT.add(KEY);
    void getGuildMember(guild_id, user_id)
      .then((result: Envelope<GuildMemberInfo>): void => {
        NAMES[KEY] = result.ok && result.data
          ? result.data.display_name
          : '';
      })
      .catch((): void => {
        NAMES[KEY] = '';
      })
      .finally((): void => {
        INFLIGHT.delete(KEY);
      });
  }
  return user_id;
}

/** True once the id resolved to a real member name. */
export function memberResolved(
  guild_id: string,
  user_id: string
): boolean {
  const KNOWN = NAMES[`${guild_id}:${user_id}`];
  return KNOWN !== undefined && KNOWN !== '';
}

/** Test hook. */
export function resetMemberNames(): void {
  for (const _key of Object.keys(NAMES)) {
    delete NAMES[_key];
  }
  INFLIGHT.clear();
}
