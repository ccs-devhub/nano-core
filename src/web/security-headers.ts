import { cspImgSrcDirective } from '@/types/nano-dashboard.js';

/**
 * F5: the security-header set for every web response. The CSP is
 * strict because the built client earns it — no inline script or
 * style, no eval, no v-html. img-src rides the one dashboard image
 * host list (cspImgSrcDirective — never a second copy); frame-src
 * admits only the click-to-load embed hosts. HSTS is gated on the
 * same public_url-is-https predicate that controls the Secure
 * cookie, so a loopback dev origin is never pinned to TLS.
 */
const HSTS_MAX_AGE_S = 15552000;

const EMBED_FRAME_HOSTS =
  'https://www.youtube-nocookie.com https://platform.twitter.com';

export function buildSecurityHeaders(
  public_url: string
): Record<string, string> {
  const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    cspImgSrcDirective(),
    `frame-src ${EMBED_FRAME_HOSTS}`,
    "font-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');

  const HEADERS: Record<string, string> = {
    'content-security-policy': CSP,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };

  if (public_url.startsWith('https://')) {
    HEADERS['strict-transport-security'] = `max-age=${HSTS_MAX_AGE_S}`;
  }
  return HEADERS;
}
