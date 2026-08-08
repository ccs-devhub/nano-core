import type { Client, Guild, GuildMember } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';

import { getModuleLogger } from '@/services/logger.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';
import type { OauthGuild } from '@/web/auth/oauth.js';

/**
 * Guild admin math for the web host. TWO bars exist by law:
 *
 * - READS ride the OAuth snapshot: `owner` OR the configured
 *   admin_permissions bits inside the `permissions` field Discord
 *   returned with the guild list (re-fetched every guild_refresh_s).
 * - WRITES additionally require THE LIVE CHECK (B11): the bot's own
 *   view of the member — present in the guild AND currently owner or
 *   holding the admin bits. This closes the stale-admin window (a
 *   demoted, kicked, or banned admin keeps the OAuth snapshot until
 *   the next refresh). A single member fetch is outside the opcode-8
 *   budget, which governs full member LIST fetches only.
 *
 * Three-state classification: admin + bot -> configurable; admin
 * without bot -> invitable (a pre-selected invite URL); everything
 * else -> hidden (absent from the response entirely).
 */
export type GuildState = 'configurable' | 'invitable';

export interface ClassifiedGuild {
  id: string;
  name: string;
  icon: string | null;
  state: GuildState;
  invite_url?: string;
}

const DISCORD_AUTHORIZE = 'https://discord.com/oauth2/authorize';
const NO_BITS = 0n;

/** Resolve configured permission NAMES to a combined bitfield. */
export function adminBitsFor(names: string[]): bigint {
  const FLAGS = PermissionFlagsBits as Record<string, bigint>;
  let bits = NO_BITS;

  for (const _name of names) {
    const BIT = FLAGS[_name];

    if (BIT === undefined) {
      getModuleLogger('web').warn(
        `Unknown permission name '${_name}' in web.admin_permissions ` +
        '- ignored.'
      );
      continue;
    }

    bits |= BIT;
  }
  return bits;
}

/** OAuth-snapshot admin test: owner always passes. */
export function isSnapshotAdmin(
  guild: OauthGuild,
  admin_bits: bigint
): boolean {
  if (guild.owner) {
    return true;
  }

  try {
    return (BigInt(guild.permissions) & admin_bits) !== NO_BITS;
  } catch {
    return false;
  }
}

export interface InviteUrlOptions {
  client_id: string;
  guild_id: string;
  permissions: string;
}

export function buildInviteUrl(options: InviteUrlOptions): string {
  const PARAMS = new URLSearchParams({
    client_id: options.client_id,
    scope: 'bot applications.commands',
    permissions: options.permissions,
    guild_id: options.guild_id,
    disable_guild_select: 'true',
  });
  return `${DISCORD_AUTHORIZE}?${PARAMS.toString()}`;
}

export interface ClassifyOptions {
  admin_bits: bigint;
  client_id: string;
  invite_permissions: string;
}

/**
 * The three-state flow. Sharding caveat (A13): bot.guilds.cache is
 * shard-local — under sharding, other-shard guilds would read as
 * "invitable"; the dashboard host assumes the unsharded/shard-0
 * deployment documented in rule-web.
 */
export function classifyGuilds(
  guilds: OauthGuild[],
  bot: Client,
  options: ClassifyOptions
): ClassifiedGuild[] {
  const RESULT: ClassifiedGuild[] = [];

  for (const _guild of guilds) {
    if (!isSnapshotAdmin(_guild, options.admin_bits)) {
      continue;
    }

    if (bot.guilds.cache.has(_guild.id)) {
      RESULT.push({
        id: _guild.id,
        name: _guild.name,
        icon: _guild.icon,
        state: 'configurable',
      });
    } else {
      RESULT.push({
        id: _guild.id,
        name: _guild.name,
        icon: _guild.icon,
        state: 'invitable',
        invite_url: buildInviteUrl({
          client_id: options.client_id,
          guild_id: _guild.id,
          permissions: options.invite_permissions,
        }),
      });
    }
  }
  return RESULT;
}

/**
 * THE LIVE CHECK (B11): the bot-side admin verification EVERY write
 * route must pass in addition to the OAuth snapshot. Plain ids in,
 * NanoResult out.
 */
export async function requireLiveGuildAdmin(
  bot: Client,
  guild_id: string,
  user_id: string,
  admin_permission_names: string[]
): Promise<NanoResult<{ via: 'owner' | 'permissions' }>> {
  const GUILD: Guild | undefined = bot.guilds.cache.get(guild_id);

  if (!GUILD) {
    return err(`Bot is not in guild '${guild_id}'.`);
  }

  if (GUILD.ownerId === user_id) {
    return ok({ via: 'owner' });
  }

  let member: GuildMember;

  try {
    member = await GUILD.members.fetch(user_id);
  } catch {
    return err(
      `User '${user_id}' is not a member of guild '${guild_id}'.`
    );
  }

  for (const _name of admin_permission_names) {
    const FLAGS = PermissionFlagsBits as Record<string, bigint>;
    const BIT = FLAGS[_name];

    if (BIT !== undefined && member.permissions.has(BIT)) {
      return ok({ via: 'permissions' });
    }
  }
  return err(
    `User '${user_id}' lacks the admin permissions in guild ` +
    `'${guild_id}'.`
  );
}
