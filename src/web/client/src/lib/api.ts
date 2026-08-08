import { t } from './i18n';
import type {
  ClassifiedGuild,
  CommandGate,
  ConfigObject,
  DashboardManifest,
  Envelope,
  GuildReference,
  InstanceInfo,
  LocalizedText,
  ModuleCommandsData,
  ModuleRow,
  WebUser
} from './types';

/**
 * The typed API client. Every response is the NanoResult envelope;
 * a 401 sends the browser through /auth/login with the current
 * location as the server-side post-login destination. Non-GET calls
 * carry the X-Nano-Csrf header from the session.
 */
const HTTP_UNAUTHORIZED = 401;

let csrf_token = '';

export function setCsrf(token: string): void {
  csrf_token = token;
}

function loginRedirect(): void {
  const NEXT = encodeURIComponent(
    window.location.pathname + window.location.search
  );
  window.location.href = `/auth/login?next=${NEXT}`;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<Envelope<T>> {
  const HEADERS: Record<string, string> = {};

  if (method !== 'GET') {
    HEADERS['X-Nano-Csrf'] = csrf_token;
  }

  if (body !== undefined) {
    HEADERS['Content-Type'] = 'application/json';
  }

  let response: Response;

  try {
    response = await fetch(path, {
      method,
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      error: `${t('network_error')} (${String(error)})`,
    };
  }

  if (response.status === HTTP_UNAUTHORIZED && path !== '/api/me') {
    loginRedirect();
    return { ok: false, error: t('not_authenticated') };
  }

  try {
    return await response.json() as Envelope<T>;
  } catch {
    return {
      ok: false,
      error: `${t('bad_response')} (HTTP ${response.status})`,
    };
  }
}

export interface MeData {
  user: WebUser;
  csrf: string;
  host_owner: boolean;
}

export async function getMe(): Promise<Envelope<MeData>> {
  const RESULT = await request<MeData>('GET', '/api/me');

  if (RESULT.ok && RESULT.data) {
    setCsrf(RESULT.data.csrf);
  }
  return RESULT;
}

export function getGuilds(): Promise<
  Envelope<{ guilds: ClassifiedGuild[] }>
  > {
  return request('GET', '/api/guilds');
}

export function getReference(
  guild_id: string
): Promise<Envelope<GuildReference>> {
  return request('GET', `/api/guilds/${guild_id}/reference`);
}

export function getModules(
  guild_id: string
): Promise<Envelope<{ modules: ModuleRow[] }>> {
  return request('GET', `/api/guilds/${guild_id}/modules`);
}

export function getInstance(
  guild_id: string
): Promise<Envelope<InstanceInfo>> {
  return request('GET', `/api/guilds/${guild_id}/instance`);
}

export interface StatTile {
  label: LocalizedText;
  value: string | number;
  hint?: LocalizedText;
}

export interface StatBar {
  label: LocalizedText;
  segments: { label: LocalizedText; value: number }[];
}

export interface StatsData {
  tiles: StatTile[];
  bars?: StatBar[];
}

export function getStats(
  guild_id: string
): Promise<Envelope<StatsData>> {
  return request('GET', `/api/guilds/${guild_id}/stats`);
}

export interface DescriptorData {
  manifest: DashboardManifest;
  available: boolean;
  reason?: string;
  registered_config_version: number | null;
}

export function getDescriptor(
  guild_id: string,
  module_id: string
): Promise<Envelope<DescriptorData>> {
  return request(
    'GET',
    `/api/guilds/${guild_id}/modules/${module_id}/descriptor`
  );
}

export interface ConfigData {
  config: ConfigObject;
  version: number | null;
  changed_keys?: string[];
}

export function getConfig(
  guild_id: string,
  module_id: string
): Promise<Envelope<ConfigData>> {
  return request(
    'GET',
    `/api/guilds/${guild_id}/modules/${module_id}/config`
  );
}

export function putConfig(
  guild_id: string,
  module_id: string,
  config: ConfigObject
): Promise<Envelope<ConfigData>> {
  return request(
    'PUT',
    `/api/guilds/${guild_id}/modules/${module_id}/config`,
    config
  );
}

export function getData(
  guild_id: string,
  module_id: string,
  view_id: string,
  params: Record<string, string> = {}
): Promise<Envelope<unknown>> {
  const QUERY = new URLSearchParams(params).toString();
  return request(
    'GET',
    `/api/guilds/${guild_id}/modules/${module_id}/data/${view_id}${ 
      QUERY ? `?${QUERY}` : ''}`
  );
}

export interface GuildMemberInfo {
  id: string;
  username: string;
  display_name: string;
}

export function getGuildMember(
  guild_id: string,
  user_id: string
): Promise<Envelope<GuildMemberInfo>> {
  return request(
    'GET',
    `/api/guilds/${guild_id}/members/${user_id}`
  );
}

export function getModuleCommands(
  guild_id: string,
  module_id: string
): Promise<Envelope<ModuleCommandsData>> {
  return request(
    'GET',
    `/api/guilds/${guild_id}/modules/${module_id}/commands`
  );
}

export function putCommandGates(
  guild_id: string,
  module_id: string,
  gates: Record<string, CommandGate>
): Promise<Envelope<{
  gates: Record<string, CommandGate>;
  changed_paths: string[];
}>> {
  return request(
    'PUT',
    `/api/guilds/${guild_id}/modules/${module_id}/commands/gates`,
    { gates }
  );
}

export function postAction(
  guild_id: string,
  module_id: string,
  action_id: string,
  params: Record<string, unknown> = {}
): Promise<Envelope<unknown>> {
  return request(
    'POST',
    `/api/guilds/${guild_id}/modules/${module_id}/actions/${action_id}`,
    { params }
  );
}

export function postLogout(): Promise<Envelope<null>> {
  return request('POST', '/auth/logout');
}
