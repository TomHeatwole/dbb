// FanDuel NCAAF drive-result odds stored in Neon (fd_drive_odds).
// A scraper upserts rows; /api/ncaaf-drives reads them as the FD book.

import { getSql } from './db.mjs';

export async function readFdDriveOdds() {
  const sql = getSql();
  return sql`
    SELECT
      id,
      event_id,
      home_team,
      away_team,
      kickoff_at,
      offense_side,
      offense_name,
      drive_n,
      market_name,
      market_status,
      td_american,
      fg_american,
      punt_american,
      other_american,
      period,
      clock_seconds,
      clock_text,
      down,
      distance,
      yards_to_endzone,
      possession_text,
      home_score,
      away_score,
      situation_text,
      fetched_at
    FROM fd_drive_odds
    WHERE kickoff_at IS NULL
       OR kickoff_at > now() - interval '18 hours'
    ORDER BY fetched_at DESC
  `;
}

function normalizeName(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’`]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\bst\b/g, 'state')
    .replace(/\s+/g, ' ')
    .trim();
}

/** FanDuel posts ±100000 on locked / settled drive legs. Not a real American price. */
export function realFdAmerican(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) >= 100000) return null;
  return n;
}

export function inferOffenseSide(offenseName, home, away) {
  const n = normalizeName(offenseName);
  const h = normalizeName(home);
  const a = normalizeName(away);
  if (!n) return null;
  const score = (team) => {
    if (!team) return 0;
    if (n === team) return 1000 + n.length;
    if (n.startsWith(team) || team.startsWith(n)) return 100 + Math.min(n.length, team.length);
    const nw = n.split(' ');
    const tw = team.split(' ');
    if (!nw.length || !tw.length) return 0;
    if (nw.every((w, i) => tw[i] === w) || tw.every((w, i) => nw[i] === w)) {
      return 80 + Math.min(nw.length, tw.length);
    }
    return 0;
  };
  const hs = score(h);
  const as = score(a);
  if (hs > as && hs > 0) return 'home';
  if (as > hs && as > 0) return 'away';
  return null;
}

export async function upsertFdDriveOdds(row) {
  const sql = getSql();
  const offenseSide = row.offense_side === 'home' || row.offense_side === 'away'
    ? row.offense_side
    : inferOffenseSide(row.offense_name, row.home_team, row.away_team);
  if (!offenseSide) {
    throw new Error(`cannot infer offense_side for ${row.offense_name} in ${row.away_team} @ ${row.home_team}`);
  }
  const driveN = Number(row.drive_n);
  if (!Number.isFinite(driveN) || driveN < 1) {
    throw new Error(`invalid drive_n ${row.drive_n}`);
  }
  const td = realFdAmerican(row.td_american);
  const fg = realFdAmerican(row.fg_american);
  const punt = realFdAmerican(row.punt_american);
  const other = realFdAmerican(row.other_american);
  const intCol = (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const period = intCol(row.period);
  const clockSeconds = intCol(row.clock_seconds);
  const down = intCol(row.down);
  const distance = intCol(row.distance);
  const yardsToEndzone = intCol(row.yards_to_endzone);
  const homeScore = intCol(row.home_score);
  const awayScore = intCol(row.away_score);
  const clockText = row.clock_text ?? null;
  const possessionText = row.possession_text ?? null;
  const situationText = row.situation_text ?? null;
  const hasSit = period != null || clockSeconds != null || down != null;
  if (td == null && fg == null && punt == null && other == null) {
    if (!hasSit) throw new Error('no American prices to write');
    const updated = await sql`
      UPDATE fd_drive_odds SET
        period = ${period},
        clock_seconds = ${clockSeconds},
        clock_text = ${clockText},
        down = ${down},
        distance = ${distance},
        yards_to_endzone = ${yardsToEndzone},
        possession_text = ${possessionText},
        home_score = ${homeScore},
        away_score = ${awayScore},
        situation_text = ${situationText},
        fetched_at = now()
      WHERE home_team = ${row.home_team}
        AND away_team = ${row.away_team}
        AND offense_side = ${offenseSide}
        AND drive_n = ${driveN}
      RETURNING id
    `;
    if (!updated.length) throw new Error('no American prices to write');
    return { ...row, offense_side: offenseSide, drive_n: driveN };
  }
  await sql`
    INSERT INTO fd_drive_odds (
      event_id, home_team, away_team, kickoff_at,
      offense_side, offense_name, drive_n, market_name, market_status,
      td_american, fg_american, punt_american, other_american,
      period, clock_seconds, clock_text, down, distance, yards_to_endzone,
      possession_text, home_score, away_score, situation_text
    ) VALUES (
      ${row.event_id ?? null},
      ${row.home_team},
      ${row.away_team},
      ${row.kickoff_at ?? null},
      ${offenseSide},
      ${row.offense_name ?? null},
      ${driveN},
      ${row.market_name ?? null},
      ${row.market_status ?? 'OPEN'},
      ${td},
      ${fg},
      ${punt},
      ${other},
      ${period},
      ${clockSeconds},
      ${clockText},
      ${down},
      ${distance},
      ${yardsToEndzone},
      ${possessionText},
      ${homeScore},
      ${awayScore},
      ${situationText}
    )
    ON CONFLICT (home_team, away_team, offense_side, drive_n) DO UPDATE SET
      event_id = EXCLUDED.event_id,
      offense_name = EXCLUDED.offense_name,
      market_name = EXCLUDED.market_name,
      market_status = EXCLUDED.market_status,
      td_american = COALESCE(EXCLUDED.td_american, fd_drive_odds.td_american),
      fg_american = COALESCE(EXCLUDED.fg_american, fd_drive_odds.fg_american),
      punt_american = COALESCE(EXCLUDED.punt_american, fd_drive_odds.punt_american),
      other_american = COALESCE(EXCLUDED.other_american, fd_drive_odds.other_american),
      kickoff_at = COALESCE(EXCLUDED.kickoff_at, fd_drive_odds.kickoff_at),
      period = CASE
        WHEN EXCLUDED.period IS NOT NULL
          OR EXCLUDED.clock_seconds IS NOT NULL
          OR EXCLUDED.down IS NOT NULL
        THEN EXCLUDED.period ELSE fd_drive_odds.period END,
      clock_seconds = CASE
        WHEN EXCLUDED.period IS NOT NULL
          OR EXCLUDED.clock_seconds IS NOT NULL
          OR EXCLUDED.down IS NOT NULL
        THEN EXCLUDED.clock_seconds ELSE fd_drive_odds.clock_seconds END,
      clock_text = CASE
        WHEN EXCLUDED.period IS NOT NULL
          OR EXCLUDED.clock_seconds IS NOT NULL
          OR EXCLUDED.down IS NOT NULL
        THEN EXCLUDED.clock_text ELSE fd_drive_odds.clock_text END,
      down = CASE
        WHEN EXCLUDED.period IS NOT NULL
          OR EXCLUDED.clock_seconds IS NOT NULL
          OR EXCLUDED.down IS NOT NULL
        THEN EXCLUDED.down ELSE fd_drive_odds.down END,
      distance = CASE
        WHEN EXCLUDED.period IS NOT NULL
          OR EXCLUDED.clock_seconds IS NOT NULL
          OR EXCLUDED.down IS NOT NULL
        THEN EXCLUDED.distance ELSE fd_drive_odds.distance END,
      yards_to_endzone = CASE
        WHEN EXCLUDED.period IS NOT NULL
          OR EXCLUDED.clock_seconds IS NOT NULL
          OR EXCLUDED.down IS NOT NULL
        THEN EXCLUDED.yards_to_endzone ELSE fd_drive_odds.yards_to_endzone END,
      possession_text = CASE
        WHEN EXCLUDED.period IS NOT NULL
          OR EXCLUDED.clock_seconds IS NOT NULL
          OR EXCLUDED.down IS NOT NULL
        THEN EXCLUDED.possession_text ELSE fd_drive_odds.possession_text END,
      home_score = CASE
        WHEN EXCLUDED.period IS NOT NULL
          OR EXCLUDED.clock_seconds IS NOT NULL
          OR EXCLUDED.down IS NOT NULL
        THEN EXCLUDED.home_score ELSE fd_drive_odds.home_score END,
      away_score = CASE
        WHEN EXCLUDED.period IS NOT NULL
          OR EXCLUDED.clock_seconds IS NOT NULL
          OR EXCLUDED.down IS NOT NULL
        THEN EXCLUDED.away_score ELSE fd_drive_odds.away_score END,
      situation_text = CASE
        WHEN EXCLUDED.period IS NOT NULL
          OR EXCLUDED.clock_seconds IS NOT NULL
          OR EXCLUDED.down IS NOT NULL
        THEN EXCLUDED.situation_text ELSE fd_drive_odds.situation_text END,
      fetched_at = now()
  `;
  return { ...row, offense_side: offenseSide, drive_n: driveN };
}

export async function deleteFdDriveOdds({ eventId, homeTeam, awayTeam }) {
  const sql = getSql();
  if (eventId) {
    return sql`
      DELETE FROM fd_drive_odds
      WHERE event_id = ${String(eventId)}
      RETURNING id, event_id, home_team, away_team, drive_n
    `;
  }
  if (homeTeam && awayTeam) {
    return sql`
      DELETE FROM fd_drive_odds
      WHERE home_team = ${homeTeam} AND away_team = ${awayTeam}
      RETURNING id, event_id, home_team, away_team, drive_n
    `;
  }
  return [];
}

export async function listFdDriveGameKeys() {
  const sql = getSql();
  return sql`
    SELECT DISTINCT event_id, home_team, away_team, kickoff_at
    FROM fd_drive_odds
  `;
}
