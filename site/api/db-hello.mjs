// Smoke-test endpoint: confirms the app can read from Neon Postgres.
// GET /api/db-hello → { ok, message, dbTime, postgres }

import { getSql } from '../lib/db.mjs';

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const [row] = await sql`
      SELECT message, created_at FROM hello_world ORDER BY id DESC LIMIT 1
    `;
    const [meta] = await sql`SELECT now() AS db_time, version() AS pg_version`;
    return res.status(200).json({
      ok: true,
      message: row?.message ?? '(hello_world table is empty)',
      messageWrittenAt: row?.created_at ?? null,
      dbTime: meta.db_time,
      postgres: meta.pg_version,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
