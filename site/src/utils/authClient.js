// Neon Managed Better Auth client (Google OAuth).
// Lazy singleton so a missing env var degrades to a visible error on pages
// that use auth, instead of crashing the whole app at import time.

import { createAuthClient } from '@neondatabase/neon-js/auth';

// Public Auth base URL (not a secret). Used when CRA was built without
// REACT_APP_NEON_AUTH_URL — which is the current prod failure mode.
const DEFAULT_NEON_AUTH_URL =
  'https://ep-summer-cell-ay0cfaq6.neonauth.c-5.us-east-2.aws.neon.tech/neondb/auth';

const VERIFIER_PARAM = 'neon_auth_session_verifier';
const TOKEN_STORAGE_KEY = 'dbb_neon_session_jwt';

let _client = null;

export function getNeonAuthUrl() {
  return process.env.REACT_APP_NEON_AUTH_URL || DEFAULT_NEON_AUTH_URL;
}

export function getAuthClient() {
  if (!_client) {
    _client = createAuthClient(getNeonAuthUrl());
  }
  return _client;
}

function hasVerifierInUrl() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has(VERIFIER_PARAM);
}

function readStoredToken() {
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token) {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // private mode / disabled storage
  }
}

function extractToken(result) {
  const session = result?.data?.session;
  return session?.token || session?.access_token || result?.data?.token || null;
}

/** Current session JWT, for Authorization headers on API calls. Null if signed out.
 *  Short-lived (~15 min) and auto-refreshed by the SDK, so fetch it per request.
 *
 *  The OAuth return URL carries a single-use `neon_auth_session_verifier`. Two
 *  getSession() calls (React Strict Mode, AuthUserProvider + page loader) would
 *  both send it — the second loses and the app looks signed out. We:
 *   1. start the exchange as soon as this module loads, before React mounts
 *   2. coalesce concurrent callers onto one in-flight promise
 *   3. persist a successful JWT so a later getSession() after the verifier
 *      is stripped does not look signed-out. */
let _inflightSession = null;
let _cachedToken = null;

export function clearSessionCache() {
  _cachedToken = null;
  writeStoredToken(null);
}

async function fetchSessionToken() {
  const result = await getAuthClient().getSession();
  if (result?.error) {
    throw new Error(result.error.message || 'getSession failed');
  }
  const token = extractToken(result);
  if (token) {
    _cachedToken = token;
    writeStoredToken(token);
  }
  return token;
}

function startSessionFetch() {
  if (_inflightSession) return _inflightSession;
  _inflightSession = fetchSessionToken().finally(() => {
    _inflightSession = null;
  });
  return _inflightSession;
}

// Kick off the one-time verifier exchange before any component can race it.
if (typeof window !== 'undefined' && hasVerifierInUrl()) {
  startSessionFetch();
}

export async function getSessionToken() {
  if (_cachedToken) return _cachedToken;
  const stored = readStoredToken();
  if (stored) {
    _cachedToken = stored;
    return stored;
  }
  return startSessionFetch();
}
