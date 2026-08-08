/**
 * Minimal cookie handling for the web host — parse the request
 * header, serialize Set-Cookie values. No dependency; attributes are
 * fixed by the session laws (HttpOnly, SameSite=Lax — the OAuth
 * callback is a cross-site top-level GET, so Strict would drop the
 * session cookie mid-login). F29: Secure is STRUCTURAL — every cookie
 * carries it unconditionally, which the __Host- name prefix requires
 * (with Path=/ and no Domain). Browsers treat 127.0.0.1 as a secure
 * context, so local smoke logins keep working over plain http.
 */
export function parseCookies(
  header: string | undefined
): Record<string, string> {
  const RESULT: Record<string, string> = {};

  if (!header) {
    return RESULT;
  }

  for (const _pair of header.split(';')) {
    const INDEX = _pair.indexOf('=');

    if (INDEX < 0) {
      continue;
    }

    const NAME = _pair.slice(0, INDEX).trim();
    const VALUE = _pair.slice(INDEX + 1).trim();

    if (NAME.length > 0) {
      RESULT[NAME] = VALUE;
    }
  }
  return RESULT;
}

export interface CookieOptions {
  max_age_s?: number;
  /** Set to true to expire the cookie immediately. */
  clear?: boolean;
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  const PARTS = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
  ];

  if (options.clear) {
    PARTS.push('Max-Age=0');
  } else if (options.max_age_s !== undefined) {
    PARTS.push(`Max-Age=${options.max_age_s}`);
  }
  return PARTS.join('; ');
}
