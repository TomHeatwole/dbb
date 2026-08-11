// Neon Managed Better Auth client (Google OAuth).
// Lazy singleton so a missing env var degrades to a visible error on pages
// that use auth, instead of crashing the whole app at import time.

import { createAuthClient } from '@neondatabase/neon-js/auth';

let _client = null;

export function getAuthClient() {
  if (!_client) {
    const url = process.env.REACT_APP_NEON_AUTH_URL;
    if (!url) {
      throw new Error('REACT_APP_NEON_AUTH_URL is not configured');
    }
    _client = createAuthClient(url);
  }
  return _client;
}

/** Current session JWT, for Authorization headers on API calls. Null if signed out.
 *  Short-lived (~15 min) and auto-refreshed by the SDK, so fetch it per request. */
export async function getSessionToken() {
  const result = await getAuthClient().getSession();
  return result?.data?.session?.token || null;
}
