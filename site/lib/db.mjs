// Neon Postgres access for serverless functions and local scripts.
// Uses the HTTP driver (@neondatabase/serverless), which needs no connection
// pooling and works in Vercel functions and plain Node alike.

import { neon } from '@neondatabase/serverless';

let _sql = null;

/**
 * Returns the shared query function. Usage:
 *   const sql = getSql();
 *   const rows = await sql`SELECT * FROM exchange_orders WHERE asset = ${asset}`;
 * Tagged-template parameters are sent as bound values, never interpolated,
 * so this is safe for user input.
 */
export function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set (add it to site/.env.local locally, or Vercel env vars in production)');
    }
    _sql = neon(url);
  }
  return _sql;
}
