/**
 * Neon helpers for paper-line snapshots. Dedup is "same as the last row for
 * this game/phase/side", not a forever unique fingerprint — odds can revert.
 */

import { getSql } from './db.mjs';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS paper_snapshots (
    id               BIGSERIAL PRIMARY KEY,
    sport            TEXT NOT NULL CHECK (sport IN ('sop', 'drives', 'corners')),
    event_id         TEXT NOT NULL,
    phase            TEXT NOT NULL,
    offense_side     TEXT CHECK (offense_side IS NULL OR offense_side IN ('home', 'away')),
    captured_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    kickoff_at       TIMESTAMPTZ,
    odds_fingerprint TEXT NOT NULL,
    payload          JSONB NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_paper_snapshots_lookup
     ON paper_snapshots (sport, event_id, phase, captured_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_paper_snapshots_sport_time
     ON paper_snapshots (sport, captured_at DESC)`,
  `CREATE TABLE IF NOT EXISTS paper_track_meta (
    sport            TEXT PRIMARY KEY CHECK (sport IN ('sop', 'drives', 'corners')),
    last_espn_at     TIMESTAMPTZ,
    last_books_at    TIMESTAMPTZ,
    next_kickoff_at  TIMESTAMPTZ,
    live_count       INTEGER NOT NULL DEFAULT 0,
    half_time_count  INTEGER NOT NULL DEFAULT 0,
    upcoming_count   INTEGER NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

let schemaReady = null;

export async function ensurePaperTrackSchema(sql = getSql()) {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const stmt of SCHEMA_STATEMENTS) {
        await sql.query(stmt);
      }
      for (const table of ['paper_snapshots', 'paper_track_meta']) {
        await sql.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_sport_check`);
        try {
          await sql.query(
            `ALTER TABLE ${table} ADD CONSTRAINT ${table}_sport_check CHECK (sport IN ('sop', 'drives', 'corners'))`,
          );
        } catch (err) {
          if (!/already exists/i.test(err.message || '')) throw err;
        }
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export function listingToMetaPatch(listing) {
  return {
    liveCount: listing?.liveCount ?? 0,
    halfTimeCount: listing?.halfTimeCount ?? 0,
    upcomingCount: listing?.upcomingCount ?? 0,
    nextKickoffAt: listing?.nextKickoffAt
      ? new Date(listing.nextKickoffAt).toISOString()
      : null,
  };
}

export async function readTrackMeta(sport, sql = getSql()) {
  await ensurePaperTrackSchema(sql);
  const rows = await sql`
    SELECT sport, last_espn_at, last_books_at, next_kickoff_at,
           live_count, half_time_count, upcoming_count, updated_at
    FROM paper_track_meta
    WHERE sport = ${sport}
  `;
  const row = rows[0];
  if (!row) {
    return {
      sport,
      lastEspnAt: null,
      lastBooksAt: null,
      nextKickoffAt: null,
      liveCount: 0,
      halfTimeCount: 0,
      upcomingCount: 0,
    };
  }
  return {
    sport: row.sport,
    lastEspnAt: row.last_espn_at ?? null,
    lastBooksAt: row.last_books_at ?? null,
    nextKickoffAt: row.next_kickoff_at ?? null,
    liveCount: Number(row.live_count) || 0,
    halfTimeCount: Number(row.half_time_count) || 0,
    upcomingCount: Number(row.upcoming_count) || 0,
  };
}

export async function writeTrackMeta(sport, patch, sql = getSql()) {
  await ensurePaperTrackSchema(sql);
  const liveCount = patch.liveCount ?? 0;
  const halfTimeCount = patch.halfTimeCount ?? 0;
  const upcomingCount = patch.upcomingCount ?? 0;
  const nextKickoffAt = patch.nextKickoffAt ? new Date(patch.nextKickoffAt) : null;
  const lastEspnAt = patch.lastEspnAt ? new Date(patch.lastEspnAt) : null;
  const lastBooksAt = patch.lastBooksAt ? new Date(patch.lastBooksAt) : null;
  await sql`
    INSERT INTO paper_track_meta (
      sport, last_espn_at, last_books_at, next_kickoff_at,
      live_count, half_time_count, upcoming_count, updated_at
    ) VALUES (
      ${sport}, ${lastEspnAt}, ${lastBooksAt}, ${nextKickoffAt},
      ${liveCount}, ${halfTimeCount}, ${upcomingCount}, now()
    )
    ON CONFLICT (sport) DO UPDATE SET
      last_espn_at = COALESCE(EXCLUDED.last_espn_at, paper_track_meta.last_espn_at),
      last_books_at = COALESCE(EXCLUDED.last_books_at, paper_track_meta.last_books_at),
      next_kickoff_at = EXCLUDED.next_kickoff_at,
      live_count = EXCLUDED.live_count,
      half_time_count = EXCLUDED.half_time_count,
      upcoming_count = EXCLUDED.upcoming_count,
      updated_at = now()
  `;
}

function rowKey(row) {
  return `${row.eventId}::${row.phase}::${row.offenseSide ?? ''}`;
}

export async function latestFingerprints(sport, sql = getSql()) {
  await ensurePaperTrackSchema(sql);
  const rows = await sql`
    SELECT DISTINCT ON (event_id, phase, COALESCE(offense_side, ''))
      event_id, phase, offense_side, odds_fingerprint
    FROM paper_snapshots
    WHERE sport = ${sport}
    ORDER BY event_id, phase, COALESCE(offense_side, ''), captured_at DESC
  `;
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.event_id}::${row.phase}::${row.offense_side ?? ''}`, row.odds_fingerprint);
  }
  return map;
}

export async function latestPregamePayloads(sport, sql = getSql()) {
  await ensurePaperTrackSchema(sql);
  const rows = await sql`
    SELECT DISTINCT ON (event_id)
      event_id, payload
    FROM paper_snapshots
    WHERE sport = ${sport} AND phase = 'pregame'
    ORDER BY event_id, captured_at DESC
  `;
  const map = {};
  for (const row of rows) {
    map[String(row.event_id)] = row.payload;
  }
  return map;
}

export async function insertNewSnapshots(rows, { fingerprints = null, sql = getSql() } = {}) {
  if (!rows?.length) return { inserted: 0, skipped: 0 };
  await ensurePaperTrackSchema(sql);
  const known = fingerprints ?? await latestFingerprints(rows[0].sport, sql);
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const key = rowKey(row);
    if (known.get(key) === row.oddsFingerprint) {
      skipped += 1;
      continue;
    }
    const offenseSide = row.offenseSide ?? null;
    const kickoffAt = row.kickoffAt ? new Date(row.kickoffAt) : null;
    await sql.query(
      `INSERT INTO paper_snapshots (
        sport, event_id, phase, offense_side, captured_at, kickoff_at,
        odds_fingerprint, payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        row.sport,
        row.eventId,
        row.phase,
        offenseSide,
        row.capturedAt,
        kickoffAt,
        row.oddsFingerprint,
        JSON.stringify(row.payload),
      ],
    );
    known.set(key, row.oddsFingerprint);
    inserted += 1;
  }
  return { inserted, skipped };
}

export async function fetchAllSnapshots(sport = null, sql = getSql()) {
  await ensurePaperTrackSchema(sql);
  if (sport) {
    return sql`
      SELECT id, sport, event_id, phase, offense_side, captured_at, kickoff_at,
             odds_fingerprint, payload
      FROM paper_snapshots
      WHERE sport = ${sport}
      ORDER BY captured_at ASC, id ASC
    `;
  }
  return sql`
    SELECT id, sport, event_id, phase, offense_side, captured_at, kickoff_at,
           odds_fingerprint, payload
    FROM paper_snapshots
    ORDER BY captured_at ASC, id ASC
  `;
}

export async function deleteSnapshotsByIds(ids, sql = getSql()) {
  if (!ids?.length) return 0;
  await ensurePaperTrackSchema(sql);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const deleted = await sql.query(
    `DELETE FROM paper_snapshots WHERE id IN (${placeholders}) RETURNING id`,
    ids,
  );
  return Array.isArray(deleted) ? deleted.length : ids.length;
}
