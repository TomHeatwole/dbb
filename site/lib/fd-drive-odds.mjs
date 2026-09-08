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
  const price = (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n !== 0 ? n : null;
  };
  const td = price(row.td_american);
  const fg = price(row.fg_american);
  const punt = price(row.punt_american);
  const other = price(row.other_american);
  if (td == null && fg == null && punt == null && other == null) {
    throw new Error('no American prices to write');
  }
  await sql`
    INSERT INTO fd_drive_odds (
      event_id, home_team, away_team, kickoff_at,
      offense_side, offense_name, drive_n, market_name, market_status,
      td_american, fg_american, punt_american, other_american
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
      ${other}
    )
    ON CONFLICT (home_team, away_team, offense_side, drive_n) DO UPDATE SET
      event_id = EXCLUDED.event_id,
      offense_name = EXCLUDED.offense_name,
      market_name = EXCLUDED.market_name,
      market_status = EXCLUDED.market_status,
      td_american = EXCLUDED.td_american,
      fg_american = EXCLUDED.fg_american,
      punt_american = EXCLUDED.punt_american,
      other_american = EXCLUDED.other_american,
      kickoff_at = COALESCE(EXCLUDED.kickoff_at, fd_drive_odds.kickoff_at),
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
