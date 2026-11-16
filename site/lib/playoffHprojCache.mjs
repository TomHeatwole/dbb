/**
 * Neon snapshot for HProj playoff field odds (standings + playoff predictions).
 * cache_valid = true means the row is fresh since the last live NFL week window.
 */

import { getSql } from './db.mjs';

export const PLAYOFF_HPROJ_CACHE_VERSION = 7;

let tableReady = null;

function ensureTable() {
  if (!tableReady) {
    const sql = getSql();
    tableReady = sql`
      CREATE TABLE IF NOT EXISTS playoff_hproj_cache (
        season         INTEGER PRIMARY KEY,
        cache_key      TEXT NOT NULL,
        cache_valid    BOOLEAN NOT NULL DEFAULT false,
        banked_through INTEGER,
        current_week   INTEGER,
        payload        JSONB NOT NULL,
        computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

export function buildPlayoffHprojCacheKey(season, bankedThrough, currentWeek) {
  return `${PLAYOFF_HPROJ_CACHE_VERSION}:${season}:${bankedThrough}:${currentWeek}`;
}

/**
 * @returns {Promise<{ cacheValid: boolean, cacheKey: string, view: object, computedAt: string | null } | null>}
 */
export async function readPlayoffHprojCache(season) {
  try {
    await ensureTable();
    const sql = getSql();
    const rows = await sql`
      SELECT cache_key, cache_valid, payload, computed_at
      FROM playoff_hproj_cache
      WHERE season = ${Number(season)}
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      cacheValid: Boolean(row.cache_valid),
      cacheKey: String(row.cache_key || ''),
      view: row.payload || null,
      computedAt: row.computed_at ? new Date(row.computed_at).toISOString() : null,
    };
  } catch (err) {
    console.error('[playoff-hproj-cache] read', err?.message || err);
    return null;
  }
}

export async function writePlayoffHprojCache({
  season,
  cacheKey,
  bankedThrough,
  currentWeek,
  view,
  cacheValid = true,
}) {
  try {
    await ensureTable();
    const sql = getSql();
    await sql`
      INSERT INTO playoff_hproj_cache (
        season, cache_key, cache_valid, banked_through, current_week, payload, computed_at
      ) VALUES (
        ${Number(season)},
        ${String(cacheKey)},
        ${Boolean(cacheValid)},
        ${bankedThrough == null ? null : Number(bankedThrough)},
        ${currentWeek == null ? null : Number(currentWeek)},
        ${JSON.stringify(view)}::jsonb,
        now()
      )
      ON CONFLICT (season) DO UPDATE SET
        cache_key = EXCLUDED.cache_key,
        cache_valid = EXCLUDED.cache_valid,
        banked_through = EXCLUDED.banked_through,
        current_week = EXCLUDED.current_week,
        payload = EXCLUDED.payload,
        computed_at = EXCLUDED.computed_at
    `;
  } catch (err) {
    console.error('[playoff-hproj-cache] write', err?.message || err);
    throw err;
  }
}

export async function invalidatePlayoffHprojCache(season) {
  try {
    await ensureTable();
    const sql = getSql();
    await sql`
      UPDATE playoff_hproj_cache
      SET cache_valid = false, computed_at = now()
      WHERE season = ${Number(season)}
    `;
  } catch (err) {
    console.error('[playoff-hproj-cache] invalidate', err?.message || err);
  }
}

/** Placeholder row while NFL games are live (cache_valid = false). */
export function dummyPlayoffHprojView(season) {
  const rows = [];
  for (let i = 1; i <= 12; i += 1) {
    rows.push({
      id: i,
      rosterId: i,
      playoffPct: 50,
      winPctIfMade: 8.3,
      p50: 100,
      label: `Team ${i} (cached placeholder)`,
    });
  }
  return {
    season: Number(season),
    teamMap: {},
    field: {
      season: Number(season),
      rows,
      iterations: 0,
      spots: 4,
      _placeholder: true,
    },
  };
}