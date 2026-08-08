import { randomBytes } from 'node:crypto';

import { LRUCache } from 'lru-cache';

import type { OauthGuild, WebUser } from '@/web/auth/oauth.js';

/**
 * In-memory web sessions: a 256-bit random id IS the capability —
 * there is no signing secret to rotate or leak, and a restart drops
 * every session (accepted, documented). Hardening carried here:
 * per-user session caps + periodic sweep (B7), single-use TTL state
 * nonces from a bounded LRU (B1), the post-login destination stored
 * SERVER-SIDE in the nonce record (B22), and a fixed-window rate
 * limiter for the pre-auth endpoints (B1).
 */
export interface WebSession {
  id: string;
  csrf: string;
  user: WebUser;
  access_token: string;
  guilds: OauthGuild[];
  fetched_at: number;
  next_guild_refresh_at: number;
  created_at: number;
  expires_at: number;
}

const SESSION_ID_BYTES = 32;
const CSRF_BYTES = 32;
const DEFAULT_MAX_SESSIONS_PER_USER = 5;
const DEFAULT_SWEEP_INTERVAL_MS = 60000;
const DEFAULT_NONCE_TTL_MS = 600000;
const DEFAULT_NONCE_MAX = 5000;

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export interface SessionStoreOptions {
  ttl_ms: number;
  max_per_user?: number;
  sweep_interval_ms?: number;
}

export class SessionStore {
  private sessions: Map<string, WebSession> = new Map();
  private ttl_ms: number;
  private max_per_user: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: SessionStoreOptions) {
    this.ttl_ms = options.ttl_ms;
    this.max_per_user =
      options.max_per_user ?? DEFAULT_MAX_SESSIONS_PER_USER;
    const SWEEP = options.sweep_interval_ms ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.timer = setInterval((): void => {
      this.sweep();
    }, SWEEP);
    this.timer.unref();
  }

  /** Create a session with a FRESH id (B9: no fixation). */
  create(
    user: WebUser,
    access_token: string,
    guilds: OauthGuild[]
  ): WebSession {
    /* Per-user cap (B7): evict the oldest before adding. */
    const MINE = [...this.sessions.values()]
      .filter((session: WebSession): boolean => {
        return session.user.id === user.id;
      })
      .sort((a: WebSession, b: WebSession): number => {
        return a.created_at - b.created_at;
      });

    while (MINE.length >= this.max_per_user) {
      const OLDEST = MINE.shift();

      if (OLDEST) {
        this.sessions.delete(OLDEST.id);
      }
    }

    const NOW = Date.now();
    const SESSION: WebSession = {
      id: randomToken(SESSION_ID_BYTES),
      csrf: randomToken(CSRF_BYTES),
      user,
      access_token,
      guilds,
      fetched_at: NOW,
      next_guild_refresh_at: 0,
      created_at: NOW,
      expires_at: NOW + this.ttl_ms,
    };
    this.sessions.set(SESSION.id, SESSION);
    return SESSION;
  }

  get(id: string): WebSession | null {
    const SESSION = this.sessions.get(id);

    if (!SESSION) {
      return null;
    }

    if (SESSION.expires_at <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return SESSION;
  }

  destroy(id: string): void {
    this.sessions.delete(id);
  }

  size(): number {
    return this.sessions.size;
  }

  sweep(): void {
    const NOW = Date.now();

    for (const [_id, _session] of this.sessions) {
      if (_session.expires_at <= NOW) {
        this.sessions.delete(_id);
      }
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

interface NonceRecord {
  /** Server-side post-login destination (B22): never a URL param. */
  destination: string;
}

export interface NonceStoreOptions {
  ttl_ms?: number;
  max?: number;
}

/** Single-use TTL state nonces from a bounded LRU (B1). */
export class NonceStore {
  private cache: LRUCache<string, NonceRecord>;

  constructor(options: NonceStoreOptions = {}) {
    this.cache = new LRUCache({
      max: options.max ?? DEFAULT_NONCE_MAX,
      ttl: options.ttl_ms ?? DEFAULT_NONCE_TTL_MS,
    });
  }

  mint(destination: string): string {
    const STATE = randomToken(SESSION_ID_BYTES);
    this.cache.set(STATE, { destination });
    return STATE;
  }

  /** Consume a state: returns its record ONCE, then never again. */
  consume(state: string): NonceRecord | null {
    const RECORD = this.cache.get(state);

    if (!RECORD) {
      return null;
    }

    this.cache.delete(state);
    return RECORD;
  }
}

export interface RateLimiterOptions {
  max_per_window: number;
  window_ms: number;
  max_keys?: number;
}

/** Fixed-window counter keyed by caller (B1 pre-auth memory DoS). */
export class RateLimiter {
  private cache: LRUCache<string, { count: number }>;
  private max_per_window: number;

  constructor(options: RateLimiterOptions) {
    this.max_per_window = options.max_per_window;
    this.cache = new LRUCache({
      max: options.max_keys ?? DEFAULT_NONCE_MAX,
      ttl: options.window_ms,
    });
  }

  allow(key: string): boolean {
    const ENTRY = this.cache.get(key);

    if (!ENTRY) {
      /* First hit opens the window; mutation keeps the TTL fixed. */
      this.cache.set(key, { count: 1 });
      return this.max_per_window >= 1;
    }

    ENTRY.count += 1;
    return ENTRY.count <= this.max_per_window;
  }
}
