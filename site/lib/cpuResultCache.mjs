/**
 * Cross-instance snapshot store. Reads and writes are I/O; a hit skips the
 * scrape or the Monte Carlo that produced the payload.
 * Fails open: a missing table or DATABASE_URL just means the caller recomputes.
 */

import { createHash } from 'crypto';
import { getSql } from './db.mjs';

const MAX_PAYLOAD_CHARS = 2_000_000;
let tableReady = null;

export function hashCacheKey(prefix, material) {
  const hash = createHash('sha256').update(String(material)).digest('hex');
  return `${prefix}:${hash}`;
}

function ensureTable() {
  if (!tableReady) {
    const sql = getSql();
    tableReady = sql`
      CREATE TABLE IF NOT EXISTS cpu_result_cache (
        cache_key  text PRIMARY KEY,
        payload    text NOT NULL,
        started_at timestamptz NOT NULL,
        ttl_ms     integer NOT NULL
      )
    `.catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

export async function readFreshCache(key) {
  try {
    await ensureTable();
    const sql = getSql();
    const rows = await sql`
      SELECT payload, started_at, ttl_ms
      FROM cpu_result_cache
      WHERE cache_key = ${key}
    `;
    const row = rows[0];
    if (!row) return null;
    const started = new Date(row.started_at).getTime();
    const ttl = Number(row.ttl_ms);
    if (!Number.isFinite(started) || !Number.isFinite(ttl)) return null;
    if (Date.now() - started >= ttl) return null;
    return { payload: row.payload, startedAt: started, ttlMs: ttl };
  } catch (err) {
    console.error('[cpu-result-cache] read', err?.message || err);
    return null;
  }
}

export async function writeFreshCache(key, payload, ttlMs, startedAt = Date.now()) {
  const ttl = Math.round(Number(ttlMs));
  if (!ttl || ttl <= 0) return;
  if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD_CHARS) return;
  try {
    await ensureTable();
    const sql = getSql();
    await sql`
      INSERT INTO cpu_result_cache (cache_key, payload, started_at, ttl_ms)
      VALUES (${key}, ${payload}, ${new Date(startedAt)}, ${ttl})
      ON CONFLICT (cache_key) DO UPDATE SET
        payload = EXCLUDED.payload,
        started_at = EXCLUDED.started_at,
        ttl_ms = EXCLUDED.ttl_ms
    `;
  } catch (err) {
    console.error('[cpu-result-cache] write', err?.message || err);
  }
}
