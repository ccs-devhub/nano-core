import { getModuleLogger } from '@/services/logger.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * Discord OAuth2 calls with an injectable fetch (tests stub the
 * Discord side and drive the real local HTTP server). Laws: the
 * refresh_token is DISCARDED at exchange (B3) — a session lives at
 * most session_ttl_h and then re-authenticates; logout REVOKES the
 * access token (B8); errors are compact machine-readable strings
 * (`unauthorized`, `rate_limited:<seconds>`) so callers can branch.
 */
export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface WebUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface OauthGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

const DISCORD_AUTHORIZE = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN = 'https://discord.com/api/v10/oauth2/token';
const DISCORD_REVOKE = 'https://discord.com/api/v10/oauth2/token/revoke';
const DISCORD_ME = 'https://discord.com/api/v10/users/@me';
const DISCORD_MY_GUILDS = 'https://discord.com/api/v10/users/@me/guilds';
const HTTP_UNAUTHORIZED = 401;
const HTTP_RATE_LIMITED = 429;
const DEFAULT_RETRY_AFTER_S = 60;
const BODY_LOG_MAX_CHARS = 512;

export const OAUTH_ERROR_UNAUTHORIZED = 'unauthorized';
export const OAUTH_ERROR_RATE_LIMITED = 'rate_limited';

export interface AuthorizeUrlOptions {
  client_id: string;
  redirect_uri: string;
  state: string;
}

export function buildAuthorizeUrl(options: AuthorizeUrlOptions): string {
  const PARAMS = new URLSearchParams({
    client_id: options.client_id,
    redirect_uri: options.redirect_uri,
    response_type: 'code',
    scope: 'identify guilds',
    state: options.state,
    prompt: 'none',
  });
  return `${DISCORD_AUTHORIZE}?${PARAMS.toString()}`;
}

function statusError(status: number, body: string): string {
  if (status === HTTP_UNAUTHORIZED) {
    return OAUTH_ERROR_UNAUTHORIZED;
  }

  if (status === HTTP_RATE_LIMITED) {
    let retry_after = DEFAULT_RETRY_AFTER_S;

    try {
      const PARSED = JSON.parse(body) as { retry_after?: number };
      retry_after = Math.ceil(PARSED.retry_after ?? DEFAULT_RETRY_AFTER_S);
    } catch {
      /* keep the default */
    }
    return `${OAUTH_ERROR_RATE_LIMITED}:${retry_after}`;
  }

  /* F1: the raw upstream body never rides a caller-facing error —
     it lands in the log where only an operator reads it. */
  getModuleLogger('web').warn(
    { status, body: body.slice(0, BODY_LOG_MAX_CHARS) },
    'Discord OAuth error response'
  );
  return `HTTP ${status}`;
}

export interface ExchangeOptions {
  client_id: string;
  client_secret: string;
  code: string;
  redirect_uri: string;
  fetch_impl: FetchLike;
}

/**
 * Exchange the authorization code. The refresh_token in the response
 * is deliberately NOT returned (B3): sessions never refresh — they
 * expire and the user logs in again.
 */
export async function exchangeCode(
  options: ExchangeOptions
): Promise<NanoResult<{ access_token: string; expires_in: number }>> {
  try {
    const RESPONSE = await options.fetch_impl(DISCORD_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: options.client_id,
        client_secret: options.client_secret,
        grant_type: 'authorization_code',
        code: options.code,
        redirect_uri: options.redirect_uri,
      }).toString(),
    });

    if (!RESPONSE.ok) {
      return err(statusError(RESPONSE.status, await RESPONSE.text()));
    }

    const BODY = await RESPONSE.json() as {
      access_token?: string;
      expires_in?: number;
    };

    if (!BODY.access_token) {
      return err('Token exchange returned no access_token.');
    }
    return ok({
      access_token: BODY.access_token,
      expires_in: BODY.expires_in ?? 0,
    });
  } catch (error: unknown) {
    return err(error);
  }
}

export interface RevokeOptions {
  client_id: string;
  client_secret: string;
  access_token: string;
  fetch_impl: FetchLike;
}

/** Revoke the Discord token at logout (B8). Best effort. */
export async function revokeToken(
  options: RevokeOptions
): Promise<NanoResult<null>> {
  try {
    const RESPONSE = await options.fetch_impl(DISCORD_REVOKE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: options.client_id,
        client_secret: options.client_secret,
        token: options.access_token,
        token_type_hint: 'access_token',
      }).toString(),
    });

    if (!RESPONSE.ok) {
      return err(statusError(RESPONSE.status, await RESPONSE.text()));
    }
    return ok(null);
  } catch (error: unknown) {
    return err(error);
  }
}

export async function fetchMe(
  access_token: string,
  fetch_impl: FetchLike
): Promise<NanoResult<WebUser>> {
  try {
    const RESPONSE = await fetch_impl(DISCORD_ME, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!RESPONSE.ok) {
      return err(statusError(RESPONSE.status, await RESPONSE.text()));
    }

    const BODY = await RESPONSE.json() as {
      id: string;
      username: string;
      global_name?: string | null;
      avatar?: string | null;
    };
    return ok({
      id: BODY.id,
      username: BODY.username,
      global_name: BODY.global_name ?? null,
      avatar: BODY.avatar ?? null,
    });
  } catch (error: unknown) {
    return err(error);
  }
}

export async function fetchMyGuilds(
  access_token: string,
  fetch_impl: FetchLike
): Promise<NanoResult<OauthGuild[]>> {
  try {
    const RESPONSE = await fetch_impl(DISCORD_MY_GUILDS, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!RESPONSE.ok) {
      return err(statusError(RESPONSE.status, await RESPONSE.text()));
    }

    interface RawGuild {
      id: string;
      name: string;
      icon?: string | null;
      owner?: boolean;
      permissions?: string;
    }

    const BODY = await RESPONSE.json() as RawGuild[];
    return ok(BODY.map((guild: RawGuild): OauthGuild => {
      return {
        id: guild.id,
        name: guild.name,
        icon: guild.icon ?? null,
        owner: guild.owner === true,
        permissions: guild.permissions ?? '0',
      };
    }));
  } catch (error: unknown) {
    return err(error);
  }
}
