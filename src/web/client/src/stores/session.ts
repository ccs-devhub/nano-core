import { reactive } from 'vue';

import type { MeData } from '../lib/api';
import { getMe } from '../lib/api';

/**
 * The session store: one reactive object, no state library. `ready`
 * flips after the first /api/me; an unauthenticated visit redirects
 * through /auth/login (handled by the API layer for every other
 * call; /api/me handles it here so the shell controls the moment).
 */
interface SessionState {
  ready: boolean;
  authenticated: boolean;
  me: MeData | null;
}

export const session: SessionState = reactive({
  ready: false,
  authenticated: false,
  me: null,
});

export async function ensureSession(): Promise<boolean> {
  if (session.ready && session.authenticated) {
    return true;
  }

  const RESULT = await getMe();

  session.ready = true;

  if (RESULT.ok && RESULT.data) {
    session.authenticated = true;
    session.me = RESULT.data;
    return true;
  }

  session.authenticated = false;
  session.me = null;
  return false;
}

export function loginUrl(): string {
  const NEXT = encodeURIComponent(
    window.location.pathname + window.location.search
  );
  return `/auth/login?next=${NEXT}`;
}
