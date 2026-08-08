import type { KeyObject } from 'node:crypto';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { getModuleLogger } from '@/services/logger.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';
import type { FetchLike } from '@/web/auth/oauth.js';

/**
 * F13: origin-side Cloudflare Access JWT validation. When
 * `web.access_team_domain` and `web.access_aud` are BOTH set, every
 * request entering the funnel must carry a valid
 * `Cf-Access-Jwt-Assertion` signed by the team's current keys. The
 * compose-network peer address is re-allocated by any `compose down`,
 * so the signed origin JWT is the ONLY trust anchor once the tunnel
 * fronts this host. Verification fails CLOSED: an unreachable JWKS
 * endpoint denies requests rather than waving them through.
 */

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

const JWKS_TTL_MS = 3600000;
const JWKS_RETRY_MIN_MS = 60000;
const JWT_PARTS = 3;
const MS_PER_S = 1000;

export interface AccessValidatorOptions {
  team_domain: string;
  aud: string;
  /** Injectable for tests; defaults to global fetch. */
  fetch_impl?: FetchLike;
}

interface AccessJwk {
  kid?: string;
  kty?: string;
}

interface AccessClaims {
  aud?: string | string[];
  iss?: string;
  exp?: number;
}

export class AccessValidator {
  readonly enabled: boolean;
  private team_domain: string;
  private aud: string;
  private fetch_impl: FetchLike;
  private keys: Map<string, KeyObject> = new Map();
  private fetched_at: number = 0;
  private last_attempt: number = 0;

  constructor(options: AccessValidatorOptions) {
    this.team_domain = options.team_domain;
    this.aud = options.aud;
    this.fetch_impl = options.fetch_impl ?? fetch;
    this.enabled = options.team_domain !== '' && options.aud !== '';
  }

  /** Validate the Access JWT on a request. Only called when enabled. */
  async check(req: IncomingMessage): Promise<NanoResult<null>> {
    const RAW = req.headers[ACCESS_JWT_HEADER];
    const TOKEN = typeof RAW === 'string' ? RAW : '';

    if (TOKEN === '') {
      return this.deny('missing Access JWT header');
    }

    const PARTS = TOKEN.split('.');

    if (PARTS.length !== JWT_PARTS) {
      return this.deny('malformed Access JWT');
    }

    const [HEAD_PART, CLAIMS_PART, SIG_PART] = PARTS;
    let kid = '';
    let claims: AccessClaims;

    try {
      const HEADER = JSON.parse(
        Buffer.from(HEAD_PART, 'base64url').toString('utf8')
      ) as { alg?: string; kid?: string };

      if (HEADER.alg !== 'RS256' || !HEADER.kid) {
        return this.deny('unsupported Access JWT header');
      }

      kid = HEADER.kid;
      claims = JSON.parse(
        Buffer.from(CLAIMS_PART, 'base64url').toString('utf8')
      ) as AccessClaims;
    } catch {
      return this.deny('undecodable Access JWT');
    }

    const KEY = await this.keyFor(kid);

    if (!KEY) {
      return this.deny(`unknown Access signing key '${kid}'`);
    }

    const SIGNED = Buffer.from(`${HEAD_PART}.${CLAIMS_PART}`);
    const SIGNATURE = Buffer.from(SIG_PART, 'base64url');
    let valid = false;

    try {
      valid = cryptoVerify('RSA-SHA256', SIGNED, KEY, SIGNATURE);
    } catch {
      valid = false;
    }

    if (!valid) {
      return this.deny('Access JWT signature invalid');
    }

    const NOW_S = Date.now() / MS_PER_S;

    if (typeof claims.exp !== 'number' || claims.exp <= NOW_S) {
      return this.deny('Access JWT expired');
    }

    const AUDIENCES = Array.isArray(claims.aud)
      ? claims.aud
      : [claims.aud ?? ''];

    if (!AUDIENCES.includes(this.aud)) {
      return this.deny('Access JWT audience mismatch');
    }

    if (claims.iss !== `https://${this.team_domain}`) {
      return this.deny('Access JWT issuer mismatch');
    }
    return ok(null);
  }

  private deny(reason: string): NanoResult<null> {
    /* Security-event visibility (F21): every denial leaves a line. */
    getModuleLogger('web').warn({ reason }, 'Access JWT denied');
    return err('Access denied.');
  }

  private async keyFor(kid: string): Promise<KeyObject | null> {
    const NOW = Date.now();
    const STALE = NOW - this.fetched_at > JWKS_TTL_MS;
    const CAN_RETRY = NOW - this.last_attempt > JWKS_RETRY_MIN_MS;

    if ((STALE || !this.keys.has(kid)) && CAN_RETRY) {
      await this.loadKeys(NOW);
    }
    return this.keys.get(kid) ?? null;
  }

  private async loadKeys(now: number): Promise<void> {
    this.last_attempt = now;

    try {
      const URL_CERTS =
        `https://${this.team_domain}/cdn-cgi/access/certs`;
      const RESPONSE = await this.fetch_impl(URL_CERTS);

      if (!RESPONSE.ok) {
        throw new Error(`JWKS fetch returned ${RESPONSE.status}`);
      }

      const BODY = await RESPONSE.json() as { keys?: AccessJwk[] };
      const LOADED = new Map<string, KeyObject>();

      for (const _jwk of BODY.keys ?? []) {
        if (_jwk.kid && _jwk.kty === 'RSA') {
          LOADED.set(
            _jwk.kid,
            createPublicKey({
              key: _jwk as unknown as JsonWebKey,
              format: 'jwk',
            })
          );
        }
      }

      this.keys = LOADED;
      this.fetched_at = now;
    } catch (error: unknown) {
      /* Fail closed: keys stay stale/empty and the caller denies. */
      getModuleLogger('web').error(
        `Access JWKS load failed: ${String(error)}`
      );
    }
  }
}
