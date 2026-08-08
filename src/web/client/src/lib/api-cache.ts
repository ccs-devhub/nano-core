import type {
  ConfigData,
  DescriptorData,
  MeData,
  StatsData
} from './api';
import {
  getConfig,
  getDescriptor,
  getGuilds,
  getInstance,
  getModuleCommands,
  getModules,
  getReference,
  getStats
} from './api';
import { guildIconUrl } from './guild-icons';
import type {
  ClassifiedGuild,
  Envelope,
  GuildReference,
  InstanceInfo,
  ModuleCommandsData,
  ModuleRow
} from './types';
import {
  invalidateWarm,
  resetWarmCache,
  retainImageUrl,
  warmFetch
} from './warm';

/**
 * The cached API layer: every GET is warmed through the shared
 * request cache (one request per key, shared between the hover-warm
 * and the click that follows; icons retained once and reused
 * everywhere). Views import THESE instead of the raw api calls;
 * writes invalidate their keys.
 */
/* 256 renders crisp on high-DPI at card widths; ONE size app-wide
   so every surface reuses the same URL and decoded bitmap. */
export const ICON_SIZE = 256;

async function warmEnvelope<T>(
  key: string,
  loader: () => Promise<Envelope<T>>
): Promise<Envelope<T>> {
  const RESULT = await warmFetch(key, loader);

  if (!RESULT.ok) {
    /* Never let a failed envelope stick for the whole TTL. */
    invalidateWarm(key);
  }
  return RESULT;
}

export async function cachedGuilds(): Promise<
  Envelope<{ guilds: ClassifiedGuild[] }>
  > {
  const RESULT = await warmEnvelope('guilds', getGuilds);

  if (RESULT.ok && RESULT.data) {
    /* ONE canonical icon size app-wide: the same URL (and decoded
       bitmap) serves the picker, the shell card, and anything else. */
    for (const _guild of RESULT.data.guilds) {
      retainImageUrl(guildIconUrl(_guild.id, _guild.icon, ICON_SIZE));
    }
  }
  return RESULT;
}

export function cachedModules(
  guild_id: string
): Promise<Envelope<{ modules: ModuleRow[] }>> {
  return warmEnvelope(`modules:${guild_id}`, (): Promise<
    Envelope<{ modules: ModuleRow[] }>
  > => {
    return getModules(guild_id);
  });
}

export function cachedInstance(
  guild_id: string
): Promise<Envelope<InstanceInfo>> {
  return warmEnvelope(`instance:${guild_id}`, (): Promise<
    Envelope<InstanceInfo>
  > => {
    return getInstance(guild_id);
  });
}

export function cachedStats(
  guild_id: string
): Promise<Envelope<StatsData>> {
  return warmEnvelope(`stats:${guild_id}`, (): Promise<
    Envelope<StatsData>
  > => {
    return getStats(guild_id);
  });
}

export function cachedReference(
  guild_id: string
): Promise<Envelope<GuildReference>> {
  return warmEnvelope(`reference:${guild_id}`, (): Promise<
    Envelope<GuildReference>
  > => {
    return getReference(guild_id);
  });
}

export function cachedDescriptor(
  guild_id: string,
  module_id: string
): Promise<Envelope<DescriptorData>> {
  return warmEnvelope(
    `descriptor:${guild_id}:${module_id}`,
    (): Promise<Envelope<DescriptorData>> => {
      return getDescriptor(guild_id, module_id);
    }
  );
}

export function cachedConfig(
  guild_id: string,
  module_id: string
): Promise<Envelope<ConfigData>> {
  return warmEnvelope(
    `config:${guild_id}:${module_id}`,
    (): Promise<Envelope<ConfigData>> => {
      return getConfig(guild_id, module_id);
    }
  );
}

export function cachedCommands(
  guild_id: string,
  module_id: string
): Promise<Envelope<ModuleCommandsData>> {
  return warmEnvelope(
    `commands:${guild_id}:${module_id}`,
    (): Promise<Envelope<ModuleCommandsData>> => {
      return getModuleCommands(guild_id, module_id);
    }
  );
}

/** After a gates PUT: the stored gates changed. */
export function invalidateModuleCommands(
  guild_id: string,
  module_id: string
): void {
  invalidateWarm(`commands:${guild_id}:${module_id}`);
}

/** After a PUT: the stored config changed. */
export function invalidateModuleConfig(
  guild_id: string,
  module_id: string
): void {
  invalidateWarm(`config:${guild_id}:${module_id}`);
}

/* ---------------------------------------------------------------
 * Hover-prediction warmers (the kyo-web-online warmProjectCard
 * pattern): warming is fire-and-forget and deduped upstream.
 * --------------------------------------------------------------- */

export function warmGuilds(): void {
  void cachedGuilds();
}

export function warmGuild(guild_id: string): void {
  void cachedModules(guild_id);
  void cachedInstance(guild_id);
  void cachedStats(guild_id);
}

export function warmModule(guild_id: string, module_id: string): void {
  void cachedDescriptor(guild_id, module_id);
  void cachedConfig(guild_id, module_id);
  void cachedCommands(guild_id, module_id);
  void cachedReference(guild_id);
}

/** Test hook. */
export function resetApiCache(): void {
  resetWarmCache();
}

export type { ConfigData, DescriptorData, MeData };
