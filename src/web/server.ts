import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';

import type { Client } from 'discord.js';

import type { NanoConfig } from '@/registry/nano-config.js';
import { getModuleLogger } from '@/services/logger.js';
import { AccessValidator } from '@/web/access.js';
import type { FetchLike } from '@/web/auth/oauth.js';
import type { AuthDeps } from '@/web/auth/routes.js';
import { clientIp, registerAuthRoutes } from '@/web/auth/routes.js';
import {
  NonceStore,
  RateLimiter,
  SessionStore
} from '@/web/auth/sessions.js';
import { registerModuleRoutes } from '@/web/module-routes.js';
import type { WebContext } from '@/web/router.js';
import { WebRouter } from '@/web/router.js';
import { defaultStaticRoots, serveStatic } from '@/web/static-files.js';
import { setWebStatus } from '@/web/status.js';

export type { WebConfig } from '@/web/hot-config.js';
export { resolveWebConfig } from '@/web/hot-config.js';

/**
 * The web dashboard host: a raw node:http server inside the bot
 * process (the mcp module is the proven precedent — promise-wrapped
 * listen, EADDRINUSE degrades health and never throws, a missing env
 * secret means the server never listens). Started from the boot path
 * ONLY when `web.enabled` (default false), after services attach,
 * before login. DISCORD_CLIENT_SECRET lives in env ONLY.
 *
 * THE BIND LAW (A7): the 127.0.0.1 default serves workstations; a
 * docker port publish cannot reach loopback inside the container, so
 * in-container instances set `web.bind` to 0.0.0.0 and keep the HOST
 * publish loopback-only.
 */
export interface WebServerOptions {
  config: NanoConfig;
  /** Env override for tests; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Root for static lookup + hot config re-reads; default cwd. */
  root?: string;
  /** Static lookup roots override (tests). */
  static_roots?: string[];
  /** Discord-side fetch override (tests stub the OAuth calls). */
  fetch_impl?: FetchLike;
  /** Pre-auth rate limit overrides (tests). */
  auth?: {
    login_max_per_window?: number;
    login_window_ms?: number;
  };
}

const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const DEFAULT_LOGIN_MAX_PER_WINDOW = 10;
const DEFAULT_LOGIN_WINDOW_MS = 60000;
const S_PER_HOUR = 3600;
const MS_PER_S = 1000;
const REQUEST_ID_CHARS = 8;

/* F3: explicit server limits — a public origin never waits forever
   on a slow client and never accepts unbounded sockets. */
const SERVER_HEADERS_TIMEOUT_MS = 10000;
const SERVER_REQUEST_TIMEOUT_MS = 30000;
const SERVER_KEEPALIVE_TIMEOUT_MS = 5000;
const SERVER_MAX_CONNECTIONS = 100;

/* F4: active requests get this long on shutdown, then the sockets
   are torn down so stop can never hang on a lingering client. */
const SHUTDOWN_GRACE_MS = 3000;

/* F18: over this many in-flight requests the funnel sheds with 503
   before any parsing — the gateway loop stays responsive. */
const MAX_IN_FLIGHT = 64;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_TOO_MANY = 429;

/* F7: per-client-IP request windows, one bucket per surface. The
   auth bucket is tighter than the login limiter's own window; the
   static bucket only backstops asset loops. */
const RATE_WINDOW_MS = 60000;
const AUTH_RATE_MAX = 30;
const API_RATE_MAX = 120;
const STATIC_RATE_MAX = 300;

let in_flight = 0;

function bucketFor(path: string): 'auth' | 'api' | 'static' {
  if (path.startsWith('/auth')) {
    return 'auth';
  }

  if (path.startsWith('/api')) {
    return 'api';
  }
  return 'static';
}


let http_server: Server | null = null;
let active_port = 0;
let frozen_config: NanoConfig | null = null;
let active_sessions: SessionStore | null = null;

function jsonError(
  res: ServerResponse,
  status: number,
  message: string
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: message }));
}

async function handleRequest(
  access: AccessValidator,
  router: WebRouter,
  static_roots: string[],
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  /* F13: the origin Access-JWT gate sits AHEAD of routing so it
     covers API routes, static files and the 404 path alike. */
  if (access.enabled) {
    const VERDICT = await access.check(req);

    if (!VERDICT.ok) {
      jsonError(res, HTTP_UNAUTHORIZED, 'Access denied.');
      return;
    }
  }

  const URL_PARSED = new URL(req.url ?? '/', 'http://web.invalid');
  const METHOD = req.method ?? 'GET';
  const MATCH = router.match(METHOD, URL_PARSED.pathname);

  if (MATCH) {
    const CONTEXT: WebContext = {
      req,
      res,
      url: URL_PARSED,
      params: MATCH.params,
    };
    await MATCH.handler(CONTEXT);
    return;
  }

  if (METHOD === 'GET' || METHOD === 'HEAD') {
    if (serveStatic(res, URL_PARSED.pathname, { roots: static_roots })) {
      return;
    }
  }

  jsonError(res, HTTP_NOT_FOUND, 'Not found.');
}

/** The active listen port (port 0 resolves here in tests). */
export function webServerPort(): number {
  return active_port;
}

/** Start the web host. Never throws; failures land in web health. */
export async function startWebServer(
  bot: Client,
  options: WebServerOptions
): Promise<void> {
  const LOGGER = getModuleLogger('web');
  const WEB = options.config.web;
  const ENV = options.env ?? process.env;
  const ROOT = options.root ?? process.cwd();

  frozen_config = options.config;

  if (!WEB.enabled) {
    setWebStatus({
      enabled: false,
      listening: false,
      port: WEB.port,
      bind: WEB.bind,
      detail: 'disabled by config',
    });
    return;
  }

  const SECRET = ENV.DISCORD_CLIENT_SECRET;
  const CLIENT_ID = ENV.CLIENT_ID;

  if (!SECRET || !CLIENT_ID) {
    const MISSING = [
      SECRET ? null : 'DISCORD_CLIENT_SECRET',
      CLIENT_ID ? null : 'CLIENT_ID',
    ].filter(Boolean)
      .join(', ');
    const DETAIL =
      `${MISSING} not set - web dashboard not started. Secrets live ` +
      'in .env only, never in nano.config.json.';
    setWebStatus({
      enabled: true,
      listening: false,
      port: WEB.port,
      bind: WEB.bind,
      detail: DETAIL,
    });
    LOGGER.warn(DETAIL);
    return;
  }

  const ROUTER = new WebRouter();
  const SESSIONS = new SessionStore({
    ttl_ms: WEB.session_ttl_h * S_PER_HOUR * MS_PER_S,
  });
  active_sessions = SESSIONS;

  const DEPS: AuthDeps = {
    bot,
    frozen: options.config,
    root: ROOT,
    env: ENV,
    fetch_impl: options.fetch_impl ?? fetch,
    sessions: SESSIONS,
    nonces: new NonceStore(),
    login_limiter: new RateLimiter({
      max_per_window: options.auth?.login_max_per_window ??
        DEFAULT_LOGIN_MAX_PER_WINDOW,
      window_ms: options.auth?.login_window_ms ??
        DEFAULT_LOGIN_WINDOW_MS,
    }),
    localBase: (): string => {
      return `http://127.0.0.1:${active_port}`;
    },
  };
  registerAuthRoutes(ROUTER, DEPS);
  registerModuleRoutes(ROUTER, DEPS);

  const STATIC_ROOTS = options.static_roots ?? defaultStaticRoots(ROOT);
  const ACCESS = new AccessValidator({
    team_domain: WEB.access_team_domain,
    aud: WEB.access_aud,
    fetch_impl: options.fetch_impl ?? fetch,
  });

  if (ACCESS.enabled) {
    LOGGER.info(
      `Origin Access-JWT validation armed for ${WEB.access_team_domain}`
    );
  }

  const LIMITERS = {
    auth: new RateLimiter({
      max_per_window: AUTH_RATE_MAX,
      window_ms: RATE_WINDOW_MS,
    }),
    api: new RateLimiter({
      max_per_window: API_RATE_MAX,
      window_ms: RATE_WINDOW_MS,
    }),
    static: new RateLimiter({
      max_per_window: STATIC_RATE_MAX,
      window_ms: RATE_WINDOW_MS,
    }),
  };

  const HANDLER = (req: IncomingMessage, res: ServerResponse): void => {
    /* F22: every request carries an id — the log line that explains
       a restart can finally be tied to the request that caused it. */
    const REQUEST_ID = randomUUID().slice(0, REQUEST_ID_CHARS);

    res.setHeader('x-request-id', REQUEST_ID);

    if (in_flight >= MAX_IN_FLIGHT) {
      LOGGER.warn(
        { request_id: REQUEST_ID, in_flight },
        'Concurrency shed'
      );
      jsonError(res, HTTP_SERVICE_UNAVAILABLE,
        'Server busy - retry shortly.');
      return;
    }

    const IP = clientIp(req, WEB.trust_proxy_header);
    const BUCKET = bucketFor(req.url ?? '/');

    if (!LIMITERS[BUCKET].allow(`${BUCKET}:${IP}`)) {
      /* F21: a denial always leaves a line. */
      LOGGER.warn(
        { request_id: REQUEST_ID, ip: IP, bucket: BUCKET },
        'Rate limit denial'
      );
      jsonError(res, HTTP_TOO_MANY, 'Too many requests.');
      return;
    }

    in_flight += 1;
    handleRequest(ACCESS, ROUTER, STATIC_ROOTS, req, res)
      .catch((error: unknown): void => {
        LOGGER.error(
          { request_id: REQUEST_ID },
          `Web request failed: ${String(error)}`
        );

        if (!res.headersSent) {
          jsonError(res, HTTP_SERVER_ERROR, 'Internal error.');
        } else {
          /* F27: headers already left — the body can never complete,
             so tear the socket down instead of leaking it. */
          res.destroy();
        }
      })
      .finally((): void => {
        in_flight -= 1;
      });
  };

  await new Promise<void>((resolve: () => void): void => {
    const SERVER = createServer(HANDLER);
    const STARTUP_ERROR = (error: NodeJS.ErrnoException): void => {
      const DETAIL = error.code === 'EADDRINUSE'
        ? `Port ${WEB.port} is already in use - set a different ` +
          'web.port in nano.config.json.'
        : `Web server failed to start: ${String(error)}`;
      setWebStatus({
        enabled: true,
        listening: false,
        port: WEB.port,
        bind: WEB.bind,
        detail: DETAIL,
      });
      LOGGER.error(DETAIL);
      http_server = null;
      resolve();
    };

    SERVER.headersTimeout = SERVER_HEADERS_TIMEOUT_MS;
    SERVER.requestTimeout = SERVER_REQUEST_TIMEOUT_MS;
    SERVER.keepAliveTimeout = SERVER_KEEPALIVE_TIMEOUT_MS;
    SERVER.maxConnections = SERVER_MAX_CONNECTIONS;
    SERVER.once('error', STARTUP_ERROR);
    SERVER.on('clientError',
      (client_error: Error, socket: NodeJS.WritableStream): void => {
        /* F3: malformed request lines get a plain 400 and the socket
           back — never an unhandled 'clientError' crash. */
        const RAW = socket as unknown as {
          writable: boolean;
          end(text: string): void;
          destroy(): void;
        };

        if (RAW.writable) {
          RAW.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        }
        RAW.destroy();
      });
    SERVER.listen(WEB.port, WEB.bind, (): void => {
      const ADDRESS = SERVER.address();
      active_port = ADDRESS && typeof ADDRESS === 'object'
        ? ADDRESS.port
        : WEB.port;
      http_server = SERVER;

      /* F3: the startup handler is consumed here; without a
         persistent replacement a later 'error' event would crash
         the BOT process. */
      SERVER.removeListener('error', STARTUP_ERROR);
      SERVER.on('error', (error: Error): void => {
        LOGGER.error(`Web server error: ${String(error)}`);
      });

      const DETAIL =
        `listening on http://${WEB.bind}:${active_port}/`;
      setWebStatus({
        enabled: true,
        listening: true,
        port: active_port,
        bind: WEB.bind,
        detail: DETAIL,
      });
      LOGGER.info(`Web dashboard ${DETAIL}`);
      resolve();
    });
  });

  bot.services.lifecycle.addShutdownTask(stopWebServer);
}

/** Close the web host; safe to call repeatedly. */
export async function stopWebServer(): Promise<void> {
  if (active_sessions) {
    active_sessions.stop();
    active_sessions = null;
  }

  if (!http_server) {
    return;
  }

  const SERVER = http_server;
  http_server = null;
  const FROZEN = frozen_config;
  setWebStatus({
    enabled: FROZEN ? FROZEN.web.enabled : false,
    listening: false,
    port: active_port,
    bind: FROZEN ? FROZEN.web.bind : '',
    detail: 'stopped',
  });
  await new Promise<void>((resolve: () => void): void => {
    /* F4: close stops accepting, idle keep-alives drop at once, and
       active requests get a bounded grace before teardown — stop can
       never hang on a lingering client. */
    const TIMER = setTimeout((): void => {
      SERVER.closeAllConnections();
    }, SHUTDOWN_GRACE_MS);

    SERVER.close((): void => {
      clearTimeout(TIMER);
      resolve();
    });
    SERVER.closeIdleConnections();
  });
}
