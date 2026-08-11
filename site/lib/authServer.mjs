// Server-side session verification for Neon Managed Better Auth.
//
// The client SDK's getSession() exposes a short-lived JWT (EdDSA-signed,
// ~15 min, auto-refreshed by the SDK) as `session.token`. The frontend sends
// it as `Authorization: Bearer <jwt>`, and we verify the signature against
// the auth service's public keys (JWKS). Claims carry the user identity.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getSql } from './db.mjs';

// Public Auth base URL (not a secret) — fallback for environments where the
// env var was never configured (e.g. the Vercel project).
const DEFAULT_NEON_AUTH_URL =
  'https://ep-summer-cell-ay0cfaq6.neonauth.c-5.us-east-2.aws.neon.tech/neondb/auth';

function getAuthBaseUrl() {
  const url =
    process.env.NEON_AUTH_URL || process.env.REACT_APP_NEON_AUTH_URL || DEFAULT_NEON_AUTH_URL;
  return url.replace(/\/$/, '');
}

// Module-level cache: jose caches JWKS fetches and handles key rotation.
let _jwks = null;
function getJwks() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(`${getAuthBaseUrl()}/.well-known/jwks.json`));
  }
  return _jwks;
}

/**
 * Verifies the request's bearer JWT.
 * Returns { userId, email, name, image } or null if missing/invalid/expired.
 */
export async function getSessionUser(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks());
    if (!payload.sub) return null;
    return {
      userId: payload.sub,
      email: payload.email || null,
      name: payload.name || null,
      image: payload.image || null,
    };
  } catch {
    return null; // bad signature, expired, malformed
  }
}

/**
 * Returns the app_users profile row for an auth user id, or null if the user
 * hasn't completed Sleeper onboarding.
 */
export async function getAppProfile(authUserId) {
  const sql = getSql();
  const rows = await sql`
    SELECT auth_user_id, sleeper_username, sleeper_user_id,
           sleeper_display_name, sleeper_avatar, created_at
    FROM app_users WHERE auth_user_id = ${authUserId}
  `;
  return rows[0] || null;
}
