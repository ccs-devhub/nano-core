import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Client } from 'discord.js';

import type { NanoConfig } from '@/registry/nano-config.js';
import { getModuleLogger } from '@/services/logger.js';
import { parseCookies, serializeCookie } from '@/web/auth/cookies.js';
import type { FetchLike } from '@/web/auth/oauth.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchMe,
  fetchMyGuilds,
  OAUTH_ERROR_RATE_LIMITED,
  OAUTH_ERROR_UNAUTHORIZED,
  revokeToken
} from '@/web/auth/oauth.js';
import { adminBitsFor, classifyGuilds } from '@/web/auth/permissions.js';
import type {
  NonceStore,
  RateLimiter,
  SessionStore,
  WebSession
} from '@/web/auth/sessions.js';
import type { WebConfig } from '@/web/hot-config.js';
import { resolveWebConfig } from '@/web/hot-config.js';
import type { WebContext, WebRouter } from '@/web/router.js';

/**
 * The auth surface: /auth/login -> Discord authorize (identify
 * guilds, single-use state) -> /auth/callback exchanges the code and
 * builds the session (fresh id, B9) -> /api/me and /api/guilds ride
 * the session cookie. The access token NEVER reaches the browser;
 * logout revokes it (B8). CSRF on non-GET: SameSite=Lax + the
 * X-Nano-Csrf header compared with timingSafeEqual (B9) + a
 * Sec-Fetch-Site same-origin check. No CORS headers, ever.
 */
export interface AuthDeps {
  bot: Client;
  frozen: NanoConfig;
  root: string;
  env: Record<string, string | undefined>;
  fetch_impl: FetchLike;
  sessions: SessionStore;
  nonces: NonceStore;
  login_limiter: RateLimiter;
  /** Base URL fallback when web.public_url is empty. */
  localBase: () => string;
}

/* F29: the __Host- prefix binds each cookie to this exact origin —
   the browser refuses it without Secure, Path=/ and no Domain, so a
   subdomain or an insecure transport can never plant or read one. */
export const COOKIE_SESSION = '__Host-nano_session';
export const COOKIE_OAUTH = '__Host-nano_oauth';

/**
 * THE HOST OWNER (owner ruling 2026-08-06): host-tier visibility and
 * writes belong ONLY to the user id configured in the BOT_OWNER_ID
 * environment variable. Unset means NOBODY holds the host bar — the
 * application-owner fallback was removed on purpose so the bar never
 * silently widens (Teams, transferred apps).
 */
export function isHostOwner(deps: AuthDeps, user_id: string): boolean {
  const OWNER = deps.env.BOT_OWNER_ID;
  return typeof OWNER === 'string' && OWNER.length > 0 &&
    OWNER === user_id;
}

const HTTP_OK = 200;
const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY = 429;
const HTTP_BAD_GATEWAY = 502;
const OAUTH_COOKIE_TTL_S = 600;
const DEFAULT_DESTINATION = '/app/';
const S_PER_HOUR = 3600;
const MS_PER_S = 1000;
const DEFAULT_RETRY_S = 60;

function webConfigOf(deps: AuthDeps): WebConfig {
  return resolveWebConfig(deps.root, deps.frozen);
}

function baseUrl(deps: AuthDeps, web: WebConfig): string {
  const PUBLIC = web.public_url.replace(/\/+$/, '');
  return PUBLIC.length > 0 ? PUBLIC : deps.localBase();
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>
): void {
  if (
    status === HTTP_UNAUTHORIZED ||
    status === HTTP_FORBIDDEN ||
    status === HTTP_TOO_MANY
  ) {
    /* F21: every denial leaves a structured line — before this,
       the 401/403/429 branches were log-silent. */
    getModuleLogger('web').warn(
      {
        evt: 'web_denial',
        status,
        request_id: res.getHeader('x-request-id'),
        error: (body as { error?: string }).error,
      },
      'Web denial'
    );
  }

  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...(headers ?? {}),
  });
  res.end(JSON.stringify(body));
}

/** F7/F28: the true client address — the socket peer unless the
    operator explicitly trusts the fronting proxy's header. */
export function clientIp(
  req: IncomingMessage,
  trust_proxy: boolean
): string {
  if (trust_proxy) {
    const HEADER = req.headers['cf-connecting-ip'];

    if (typeof HEADER === 'string' && HEADER !== '') {
      return HEADER;
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function redirect(
  res: ServerResponse,
  location: string,
  cookies: string[] = []
): void {
  const HEADERS: Record<string, string | string[]> = {
    Location: location,
  };

  if (cookies.length > 0) {
    HEADERS['Set-Cookie'] = cookies;
  }

  res.writeHead(HTTP_FOUND, HEADERS);
  res.end();
}

function safeEqual(a: string, b: string): boolean {
  const BUFFER_A = Buffer.from(a);
  const BUFFER_B = Buffer.from(b);

  if (BUFFER_A.length !== BUFFER_B.length) {
    return false;
  }
  return timingSafeEqual(BUFFER_A, BUFFER_B);
}

/** The session on this request, or null. */
export function sessionFrom(
  deps: AuthDeps,
  context: WebContext
): WebSession | null {
  const COOKIES = parseCookies(context.req.headers.cookie);
  const ID = COOKIES[COOKIE_SESSION];
  return ID ? deps.sessions.get(ID) : null;
}

/** Guard: 401s when no live session rides the request. */
export function requireSession(
  deps: AuthDeps,
  context: WebContext
): WebSession | null {
  const SESSION = sessionFrom(deps, context);

  if (!SESSION) {
    sendJson(context.res, HTTP_UNAUTHORIZED, {
      ok: false,
      error: 'Not authenticated.',
    });
    return null;
  }
  return SESSION;
}

/** Guard: CSRF for every non-GET route (B9). */
export function requireCsrf(
  context: WebContext,
  session: WebSession
): boolean {
  const SITE = context.req.headers['sec-fetch-site'];

  if (typeof SITE === 'string' && SITE !== 'same-origin' &&
      SITE !== 'none') {
    sendJson(context.res, HTTP_FORBIDDEN, {
      ok: false,
      error: 'Cross-site request refused.',
    });
    return false;
  }

  const HEADER = context.req.headers['x-nano-csrf'];

  if (typeof HEADER !== 'string' || !safeEqual(HEADER, session.csrf)) {
    sendJson(context.res, HTTP_FORBIDDEN, {
      ok: false,
      error: 'Missing or invalid CSRF token.',
    });
    return false;
  }
  return true;
}

function sanitizeDestination(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') ||
      raw.includes('\\')) {
    return DEFAULT_DESTINATION;
  }
  return raw;
}

const REFRESHING = new Map<string, Promise<'ok' | 'destroyed' | 'kept'>>();

/**
 * Single-flight guild refresh (B4): one Discord call per session no
 * matter how many requests race; 429 stamps next_guild_refresh_at
 * (retry_after honored); 401 destroys the session (B3); transient
 * failures keep serving the stale snapshot.
 */
async function refreshGuildsIfStale(
  deps: AuthDeps,
  session: WebSession,
  refresh_s: number
): Promise<'ok' | 'destroyed' | 'kept'> {
  const NOW = Date.now();

  if (NOW - session.fetched_at < refresh_s * MS_PER_S) {
    return 'kept';
  }

  if (NOW < session.next_guild_refresh_at) {
    return 'kept';
  }

  const IN_FLIGHT = REFRESHING.get(session.id);

  if (IN_FLIGHT) {
    return IN_FLIGHT;
  }

  const TASK = (async (): Promise<'ok' | 'destroyed' | 'kept'> => {
    const RESULT = await fetchMyGuilds(
      session.access_token,
      deps.fetch_impl
    );

    if (RESULT.ok) {
      session.guilds = RESULT.data;
      session.fetched_at = Date.now();
      return 'ok';
    }

    if (RESULT.error === OAUTH_ERROR_UNAUTHORIZED) {
      deps.sessions.destroy(session.id);
      return 'destroyed';
    }

    if (String(RESULT.error).startsWith(OAUTH_ERROR_RATE_LIMITED)) {
      const RETRY_S = Number(
        String(RESULT.error).split(':')[1] ?? DEFAULT_RETRY_S
      );
      session.next_guild_refresh_at = Date.now() + RETRY_S * MS_PER_S;
      return 'kept';
    }
    return 'kept';
  })().finally((): void => {
    REFRESHING.delete(session.id);
  });
  REFRESHING.set(session.id, TASK);
  return TASK;
}

function clientKey(context: WebContext): string {
  return context.req.socket.remoteAddress ?? 'unknown';
}

export function registerAuthRoutes(
  router: WebRouter,
  deps: AuthDeps
): void {
  const LOGGER = getModuleLogger('web');

  router.add('GET', '/auth/login', (context: WebContext): void => {
    if (!deps.login_limiter.allow(clientKey(context))) {
      sendJson(context.res, HTTP_TOO_MANY, {
        ok: false,
        error: 'Rate limited.',
      });
      return;
    }

    const WEB = webConfigOf(deps);
    const CLIENT_ID = deps.env.CLIENT_ID ?? '';
    const NEXT = sanitizeDestination(
      context.url.searchParams.get('next')
    );
    const STATE = deps.nonces.mint(NEXT);
    const AUTHORIZE = buildAuthorizeUrl({
      client_id: CLIENT_ID,
      redirect_uri: `${baseUrl(deps, WEB)}/auth/callback`,
      state: STATE,
    });
    redirect(context.res, AUTHORIZE, [
      serializeCookie(COOKIE_OAUTH, STATE, {
        max_age_s: OAUTH_COOKIE_TTL_S,
      }),
    ]);
  });

  router.add(
    'GET',
    '/auth/callback',
    async (context: WebContext): Promise<void> => {
      if (!deps.login_limiter.allow(clientKey(context))) {
        sendJson(context.res, HTTP_TOO_MANY, {
          ok: false,
          error: 'Rate limited.',
        });
        return;
      }

      const WEB = webConfigOf(deps);
      const CODE = context.url.searchParams.get('code');
      const STATE = context.url.searchParams.get('state');

      if (!CODE || !STATE) {
        sendJson(context.res, HTTP_BAD_REQUEST, {
          ok: false,
          error: 'Missing code or state.',
        });
        return;
      }

      const RECORD = deps.nonces.consume(STATE);

      if (!RECORD) {
        sendJson(context.res, HTTP_BAD_REQUEST, {
          ok: false,
          error: 'Unknown, expired, or reused state.',
        });
        return;
      }

      /* Double-submit (B10): the pre-auth cookie must carry the same
         state the authorize round-trip returned. */
      const COOKIES = parseCookies(context.req.headers.cookie);
      const PRE_AUTH = COOKIES[COOKIE_OAUTH];

      if (!PRE_AUTH || !safeEqual(PRE_AUTH, STATE)) {
        sendJson(context.res, HTTP_BAD_REQUEST, {
          ok: false,
          error: 'State cookie mismatch.',
        });
        return;
      }

      const EXCHANGED = await exchangeCode({
        client_id: deps.env.CLIENT_ID ?? '',
        client_secret: deps.env.DISCORD_CLIENT_SECRET ?? '',
        code: CODE,
        redirect_uri: `${baseUrl(deps, WEB)}/auth/callback`,
        fetch_impl: deps.fetch_impl,
      });

      if (!EXCHANGED.ok) {
        sendJson(context.res, HTTP_BAD_GATEWAY, {
          ok: false,
          error: `Token exchange failed: ${EXCHANGED.error}`,
        });
        return;
      }

      const ME = await fetchMe(
        EXCHANGED.data.access_token,
        deps.fetch_impl
      );
      const GUILDS = await fetchMyGuilds(
        EXCHANGED.data.access_token,
        deps.fetch_impl
      );

      if (!ME.ok || !GUILDS.ok) {
        sendJson(context.res, HTTP_BAD_GATEWAY, {
          ok: false,
          error: 'Discord identity fetch failed.',
        });
        return;
      }

      const SESSION = deps.sessions.create(
        ME.data,
        EXCHANGED.data.access_token,
        GUILDS.data
      );
      LOGGER.info(
        { user_id: SESSION.user.id },
        'Web login'
      );
      redirect(context.res, RECORD.destination, [
        serializeCookie(COOKIE_SESSION, SESSION.id, {
          max_age_s: WEB.session_ttl_h * S_PER_HOUR,
        }),
        serializeCookie(COOKIE_OAUTH, '', { clear: true }),
      ]);
    }
  );

  router.add(
    'POST',
    '/auth/logout',
    async (context: WebContext): Promise<void> => {
      const SESSION = requireSession(deps, context);

      if (!SESSION || !requireCsrf(context, SESSION)) {
        return;
      }

      const REVOKED = await revokeToken({
        client_id: deps.env.CLIENT_ID ?? '',
        client_secret: deps.env.DISCORD_CLIENT_SECRET ?? '',
        access_token: SESSION.access_token,
        fetch_impl: deps.fetch_impl,
      });

      if (!REVOKED.ok) {
        LOGGER.warn(
          { user_id: SESSION.user.id },
          `Token revocation failed: ${REVOKED.error}`
        );
      }

      deps.sessions.destroy(SESSION.id);
      LOGGER.info({ user_id: SESSION.user.id }, 'Web logout');
      context.res.writeHead(HTTP_OK, {
        'Content-Type': 'application/json',
        'Set-Cookie': serializeCookie(COOKIE_SESSION, '', {
          clear: true,
        }),
      });
      context.res.end(JSON.stringify({ ok: true, data: null }));
    }
  );

  router.add('GET', '/api/me', (context: WebContext): void => {
    const SESSION = requireSession(deps, context);

    if (!SESSION) {
      return;
    }

    /* host_owner drives the client's HOST-tier rendering (C6): host
       fields and host actions render only for the env-configured
       bot owner. The server enforces the same rule on every write
       regardless. */
    sendJson(context.res, HTTP_OK, {
      ok: true,
      data: {
        user: SESSION.user,
        csrf: SESSION.csrf,
        host_owner: isHostOwner(deps, SESSION.user.id),
      },
    });
  });

  router.add(
    'GET',
    '/api/guilds',
    async (context: WebContext): Promise<void> => {
      const SESSION = requireSession(deps, context);

      if (!SESSION) {
        return;
      }

      const WEB = webConfigOf(deps);
      const OUTCOME = await refreshGuildsIfStale(
        deps,
        SESSION,
        WEB.guild_refresh_s
      );

      if (OUTCOME === 'destroyed') {
        /* F21: the one denial that bypasses sendJson (it must clear
           the cookie) still leaves the structured line. */
        LOGGER.warn(
          { evt: 'web_denial', status: HTTP_UNAUTHORIZED },
          'Web denial'
        );
        context.res.writeHead(HTTP_UNAUTHORIZED, {
          'Content-Type': 'application/json',
          'Set-Cookie': serializeCookie(COOKIE_SESSION, '', {
            clear: true,
          }),
        });
        context.res.end(JSON.stringify({
          ok: false,
          error: 'Discord session expired - log in again.',
        }));
        return;
      }

      sendJson(context.res, HTTP_OK, {
        ok: true,
        data: {
          guilds: classifyGuilds(SESSION.guilds, deps.bot, {
            admin_bits: adminBitsFor(WEB.admin_permissions),
            client_id: deps.env.CLIENT_ID ?? '',
            invite_permissions: WEB.invite_permissions,
          }),
        },
      });
    }
  );
}
