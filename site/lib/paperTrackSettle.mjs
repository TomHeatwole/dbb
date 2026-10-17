/**
 * Score paper_snapshots against ESPN results. Runs inside the SOP / drives
 * minute cron — not a separate function.
 */

import { uniqueScoreboardDates } from '../src/drives/espnScoreboardDates.js';
import {
  classifyEspnDriveBucket,
  espnDriveResultName,
  isCountableTeamDrive,
  isInProgressDrive,
} from '../src/drives/espnDriveChart.js';
import { nameMatchScore } from '../src/drives/driveModel.js';
import { driveSettlementPatches } from '../src/paperTrack/settleDrives.js';
import {
  classifySopGoalType,
  parseGoalScoreAfter,
  sopSettlementPatches,
} from '../src/paperTrack/settleSop.js';
import { extractScoringPlays, fetchEspnMatchSummary } from './espn-soccer-goals.mjs';
import { fetchEspnSoccerScoreboards, findEspnMatch, namesMatch } from './espn-pl-scoreboard.mjs';
import { espnLeagueKeys } from '../src/sop/soccerLeagues.js';
import { getSql } from './db.mjs';
import { ensurePaperTrackSchema } from './paperTrackCore.mjs';

const ESPN_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};
const CFB_SCOREBOARD = [
  'https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
];
const CFB_SUMMARY = [
  'https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/summary',
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary',
];
const MAX_EVENTS_PER_TICK = 16;

function resolveSql(sql) {
  return sql || getSql();
}

async function mapPool(items, limit, fn) {
  const list = [...items];
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) || 0 }, async () => {
    while (i < list.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(list[idx], idx);
    }
  }));
  return out;
}

async function espnJson(url, referer) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        ...ESPN_HEADERS,
        Referer: referer || 'https://www.espn.com/',
        'Cache-Control': 'no-cache',
      },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function payloadEspnId(payload) {
  const id = payload?.espn_id ?? payload?.espnId;
  return id != null && String(id).trim() ? String(id) : null;
}

function pairScore(a, b) {
  return Math.max(nameMatchScore(a, b), nameMatchScore(b, a));
}

function cfbTeamsMatch(paperHome, paperAway, espnHome, espnAway) {
  const aligned = pairScore(paperHome, espnHome) + pairScore(paperAway, espnAway);
  const flipped = pairScore(paperHome, espnAway) + pairScore(paperAway, espnHome);
  return aligned > flipped
    && pairScore(paperHome, espnHome) > 0
    && pairScore(paperAway, espnAway) > 0;
}

function driveSide(drive, home, away, homeAbbr, awayAbbr) {
  const team = drive?.team ?? {};
  const abbr = String(team.abbreviation ?? '').toUpperCase();
  if (abbr && homeAbbr && abbr === String(homeAbbr).toUpperCase()) return 'home';
  if (abbr && awayAbbr && abbr === String(awayAbbr).toUpperCase()) return 'away';
  const name = team.displayName || team.shortDisplayName || team.name || '';
  const hs = pairScore(name, home);
  const as = pairScore(name, away);
  if (hs > as && hs > 0) return 'home';
  if (as > hs && as > 0) return 'away';
  return null;
}

function listedDrives(summary) {
  const prev = Array.isArray(summary?.drives?.previous) ? summary.drives.previous : [];
  const cur = summary?.drives?.current;
  return cur ? [...prev, cur] : prev;
}

function periodOf(drive) {
  const n = Number(drive?.start?.period?.number ?? drive?.start?.period);
  return Number.isFinite(n) ? n : null;
}

export async function countReadyUnsettled(sport, sql = resolveSql()) {
  await ensurePaperTrackSchema(sql);
  const rows = await sql`
    SELECT count(*)::int AS n
    FROM paper_snapshots
    WHERE sport = ${sport}
      AND settled_at IS NULL
      AND (
        phase IN ('live', 'halftime_next', 'live_lines')
        OR kickoff_at IS NULL
        OR kickoff_at <= now()
      )
  `;
  return Number(rows[0]?.n) || 0;
}

async function loadReadyUnsettled(sport, sql) {
  await ensurePaperTrackSchema(sql);
  return sql`
    SELECT id, event_id, phase, offense_side, settled_at, payload, kickoff_at
    FROM paper_snapshots
    WHERE sport = ${sport}
      AND settled_at IS NULL
      AND (
        phase IN ('live', 'halftime_next', 'live_lines')
        OR kickoff_at IS NULL
        OR kickoff_at <= now()
      )
    ORDER BY kickoff_at ASC NULLS LAST, id ASC
  `;
}

async function applyPatches(patches, sql) {
  if (!patches.length) return 0;
  const now = new Date().toISOString();
  let n = 0;
  for (const { id, patch } of patches) {
    const body = { ...patch, settled_at: now };
    const updated = await sql.query(
      `UPDATE paper_snapshots
       SET payload = payload || $1::jsonb,
           settled_at = $2::timestamptz
       WHERE id = $3 AND settled_at IS NULL
       RETURNING id`,
      [JSON.stringify(body), now, id],
    );
    const count = Array.isArray(updated) ? updated.length : (updated?.rowCount ?? 0);
    if (count) n += 1;
  }
  return n;
}

function groupByEvent(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.event_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({
      id: row.id,
      eventId: key,
      phase: row.phase,
      offenseSide: row.offense_side,
      settledAt: row.settled_at,
      payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
      kickoffAt: row.kickoff_at,
    });
  }
  return map;
}

function prioritizeEvents(groups) {
  const ranked = [...groups.entries()].map(([eventId, rows]) => {
    const live = rows.some((r) => r.phase === 'live' || r.phase === 'live_lines' || r.phase === 'halftime_next');
    const kick = rows.find((r) => r.kickoffAt)?.kickoffAt;
    return { eventId, rows, live, kick: kick ? new Date(kick).getTime() : 0 };
  });
  ranked.sort((a, b) => Number(b.live) - Number(a.live) || a.kick - b.kick);
  return ranked.slice(0, MAX_EVENTS_PER_TICK);
}

export async function settleSopSnapshots({ sql = resolveSql(), games = [] } = {}) {
  await ensurePaperTrackSchema(sql);
  const rows = await loadReadyUnsettled('sop', sql);
  if (!rows.length) return { scored: 0, events: 0 };
  const groups = groupByEvent(rows);
  const bookByEvent = new Map((games ?? []).map((g) => [String(g.eventId), g]));
  const kickoffs = [...groups.values()].flatMap((list) => list.map((r) => r.payload.kickoff_at || r.kickoffAt).filter(Boolean));
  let matches = [];
  try {
    const board = await fetchEspnSoccerScoreboards(kickoffs, espnLeagueKeys('all'));
    matches = board.matches ?? [];
  } catch (_) {
    matches = [];
  }

  const batch = prioritizeEvents(groups);
  let scored = 0;
  await mapPool(batch, 4, async ({ eventId, rows: eventRows }) => {
    const sample = eventRows[0]?.payload || {};
    const book = bookByEvent.get(eventId);
    let espnId = payloadEspnId(sample) || (book?.espnId != null ? String(book.espnId) : null);
    let league = sample.espn_league || sample.competition || book?.espnLeague || book?.competition || 'pl';
    let home = sample.home || book?.teams?.home;
    let away = sample.away || book?.teams?.away;
    if (!espnId) {
      const hit = findEspnMatch({ teams: { home, away } }, matches)
        || matches.find((m) => namesMatch(home, m.teams?.home) && namesMatch(away, m.teams?.away));
      if (hit) {
        espnId = String(hit.id);
        league = hit.leagueKey || league;
        home = hit.teams?.home || home;
        away = hit.teams?.away || away;
      }
    }
    const boardHit = matches.find((m) => String(m.id) === String(espnId));
    const finished = Boolean(boardHit?.clock?.finished || book?.espn?.finished);
    if (!espnId) return;

    let plays = [];
    try {
      const summary = await fetchEspnMatchSummary(espnId, league);
      plays = summary.plays ?? [];
    } catch (_) {
      plays = (book?.goalsSoFar ?? []).map((g) => ({
        description: g.description,
        goalType: g.goalType,
        clock: g.clock,
        teamName: g.teamName,
      }));
    }
    if (!plays.length && !finished) return;

    const goals = [];
    for (const play of plays) {
      const type = classifySopGoalType({
        description: play.description,
        goalType: play.goalType,
      });
      if (!type) continue;
      const scoreAfter = parseGoalScoreAfter(play.description, home, away);
      if (!scoreAfter) continue;
      goals.push({ type, scoreAfter, label: type.toUpperCase() });
    }
    const patches = sopSettlementPatches(eventRows, {
      goals,
      finished,
      scoringPlayCount: plays.length,
    });
    scored += await applyPatches(patches, sql);
  });

  return { scored, events: batch.length };
}

function finalScoreFromSummary(summary) {
  const comp = summary?.header?.competitions?.[0];
  const competitors = comp?.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  const hs = Number(home?.score);
  const as = Number(away?.score);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  return { home: hs, away: as };
}

function gameFinished(summary, boardState) {
  if (boardState === 'post') return true;
  const state = String(summary?.header?.competitions?.[0]?.status?.type?.state ?? '').toLowerCase();
  return state === 'post';
}

export async function settleDrivesSnapshots({ sql = resolveSql(), games = [] } = {}) {
  await ensurePaperTrackSchema(sql);
  const rows = await loadReadyUnsettled('drives', sql);
  if (!rows.length) return { scored: 0, events: 0 };
  const groups = groupByEvent(rows);
  const bookByEvent = new Map((games ?? []).map((g) => [String(g.eventId), g]));

  const board = [];
  const dates = uniqueScoreboardDates(
    [...groups.values()].flatMap((list) => list.map((r) => r.payload.kickoff_at || r.kickoffAt).filter(Boolean)),
  );
  for (const date of dates) {
    for (const base of CFB_SCOREBOARD) {
      try {
        const payload = await espnJson(`${base}?dates=${date}&limit=300`, 'https://www.espn.com/college-football/scoreboard');
        for (const ev of payload.events ?? []) {
          const comp = ev.competitions?.[0] ?? {};
          const home = (comp.competitors ?? []).find((c) => c.homeAway === 'home');
          const away = (comp.competitors ?? []).find((c) => c.homeAway === 'away');
          board.push({
            id: String(ev.id),
            home: home?.team?.displayName,
            away: away?.team?.displayName,
            homeAbbr: home?.team?.abbreviation,
            awayAbbr: away?.team?.abbreviation,
            state: String(ev.status?.type?.state ?? '').toLowerCase(),
            homeScore: Number(home?.score),
            awayScore: Number(away?.score),
          });
        }
        break;
      } catch (_) { /* try next host */ }
    }
  }

  const batch = prioritizeEvents(groups);
  let scored = 0;
  await mapPool(batch, 4, async ({ eventId, rows: eventRows }) => {
    const sample = eventRows[0]?.payload || {};
    const book = bookByEvent.get(eventId);
    let espnId = payloadEspnId(sample) || (book?.espnId != null ? String(book.espnId) : null);
    let home = sample.home || book?.teams?.home || book?.espnHome;
    let away = sample.away || book?.teams?.away || book?.espnAway;
    let homeAbbr = book?.espnHomeAbbr;
    let awayAbbr = book?.espnAwayAbbr;
    let boardHit = espnId ? board.find((g) => g.id === espnId) : null;
    if (!boardHit) {
      boardHit = board.find((g) => cfbTeamsMatch(home, away, g.home, g.away));
    }
    if (boardHit) {
      espnId = boardHit.id;
      home = boardHit.home || home;
      away = boardHit.away || away;
      homeAbbr = boardHit.homeAbbr;
      awayAbbr = boardHit.awayAbbr;
    }
    if (!espnId) return;

    let summary = null;
    for (const base of CFB_SUMMARY) {
      try {
        summary = await espnJson(`${base}?event=${espnId}`, 'https://www.espn.com/college-football/');
        break;
      } catch (_) { /* next */ }
    }
    if (!summary) return;

    const completed = listedDrives(summary)
      .filter((d) => isCountableTeamDrive(d) && !isInProgressDrive(d))
      .map((d) => ({
        side: driveSide(d, home, away, homeAbbr, awayAbbr),
        bucket: classifyEspnDriveBucket(d),
        period: periodOf(d),
        result: espnDriveResultName(d),
      }))
      .filter((d) => d.side && d.bucket);

    const finished = gameFinished(summary, boardHit?.state);
    const finalScore = finalScoreFromSummary(summary)
      || (Number.isFinite(boardHit?.homeScore) && Number.isFinite(boardHit?.awayScore)
        ? { home: boardHit.homeScore, away: boardHit.awayScore }
        : null);

    const patches = driveSettlementPatches(eventRows, {
      drives: completed,
      finalScore,
      finished,
    });
    scored += await applyPatches(patches, sql);
  });

  return { scored, events: batch.length };
}
