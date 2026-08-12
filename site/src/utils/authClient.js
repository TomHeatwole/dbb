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
    // Prefer localStorage so login survives tab close / browser restart.
    // Migrate any leftover sessionStorage value from older builds.
    const fromLocal = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (fromLocal) return fromLocal;
    const fromSession = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (fromSession) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, fromSession);
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      return fromSession;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredToken(token) {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // private mode / disabled storage
  }
}

function extractToken(result) {
  const session = result?.data?.session;
  return session?.token || session?.access_token || result?.data?.token || null;
}

/** True if JWT is missing/malformed or past exp (with a small skew buffer). */
function isJwtExpired(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return true;
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json);
    if (!payload?.exp) return false;
    return Date.now() >= (Number(payload.exp) * 1000) - 30_000;
  } catch {
    return true;
  }
}

/** Current session JWT, for Authorization headers on API calls. Null if signed out.
 *  Short-lived (~15 min) and auto-refreshed by the SDK via getSession(), so we
 *  always try a live session first and only fall back to a persisted JWT when
 *  the SDK can't refresh (common on localhost when third-party auth cookies
 *  are blocked).
 *
 *  The OAuth return URL carries a single-use `neon_auth_session_verifier`. Two
 *  getSession() calls would both send it — the second loses. We:
 *   1. start the exchange as soon as this module loads, before React mounts
 *   2. coalesce concurrent callers onto one in-flight promise
 *   3. persist a successful JWT in localStorage so later loads still work */
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
  if (_cachedToken && !isJwtExpired(_cachedToken)) return _cachedToken;
  if (_cachedToken && isJwtExpired(_cachedToken)) {
    _cachedToken = null;
  }

  // Always attempt a live getSession() so the SDK can refresh the JWT.
  // Critical on page reload — skipping this left us stuck on a stale token.
  let liveToken = null;
  try {
    liveToken = await startSessionFetch();
  } catch {
    liveToken = null;
  }
  if (liveToken && !isJwtExpired(liveToken)) return liveToken;

  // Fallback: persisted JWT (covers verifier-race aftermath and localhost
  // cases where Neon session cookies aren't sent cross-site).
  const stored = readStoredToken();
  if (stored && !isJwtExpired(stored)) {
    _cachedToken = stored;
    return stored;
  }
  if (stored) writeStoredToken(null);
  return null;
}
