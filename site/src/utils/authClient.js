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
 *  Short-lived (~15 min) and auto-refreshed by the SDK, so fetch it per request.
 *
 *  Concurrent calls share one in-flight getSession(). This matters right after
 *  the OAuth redirect: the URL carries a single-use session verifier, and two
 *  parallel getSession() calls would both send it — the second one loses and
 *  reports "signed out", breaking sign-in. A successful token is cached so a
 *  later getSession() after the verifier is stripped does not look signed-out. */
let _inflightSession = null;
let _cachedToken = null;

export function clearSessionCache() {
  _cachedToken = null;
}

export async function getSessionToken() {
  if (_cachedToken) return _cachedToken;
  if (!_inflightSession) {
    _inflightSession = getAuthClient()
      .getSession()
      .then((result) => {
        const token = result?.data?.session?.token || null;
        if (token) _cachedToken = token;
        return token;
      })
      .finally(() => { _inflightSession = null; });
  }
  return _inflightSession;
}
