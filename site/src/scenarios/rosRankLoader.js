/**
 * Rest-of-season positional ranks from FantasyPros CSVs.
 *
 * QB / RB / WR are standard scoring. TE is half-PPR.
 * Shape matches loadCurrentHwangAdpRankMap so the season simulator can
 * center historical outcome pools on these ranks.
 */

import { fetchWeeklyStats } from '../data_parse/weeklyStatsLoader';
import { getCompletedWeeksCount } from '../utils/DateHelper';
import { LEAGUE_ID } from '../utils/global_constants';
import { buildSleeperBasePoints } from './sleeperScoring';

const REG_SEASON_WEEKS = 14;

const ROS_CSVS = [
  { path: '/data/fantasypros_ros_qb.csv', position: 'QB' },
  { path: '/data/fantasypros_ros_rb_std.csv', position: 'RB' },
  { path: '/data/fantasypros_ros_wr_std.csv', position: 'WR' },
  { path: '/data/fantasypros_ros_te_half.csv', position: 'TE' },
];

let rosRowsCache = null;

function parseCsvLine(line) {
  return line.split(',').map((cell) => cell.trim());
}

async function loadRosRows() {
  if (rosRowsCache) return rosRowsCache;

  const texts = await Promise.all(ROS_CSVS.map(async (cfg) => {
    const res = await fetch(cfg.path);
    if (!res.ok) throw new Error(`Failed to fetch ${cfg.path}`);
    return res.text();
  }));

  const rows = [];
  texts.forEach((text, fileIdx) => {
    const fallbackPos = ROS_CSVS[fileIdx].position;
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return;
    const headers = parseCsvLine(lines[0]);
    const rankIdx = headers.indexOf('rank');
    const nameIdx = headers.indexOf('name');
    const posIdx = headers.indexOf('position');
    const sleeperIdx = headers.indexOf('sleeper_id');
    if (rankIdx === -1 || sleeperIdx === -1) return;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const sleeperId = (cols[sleeperIdx] || '').trim();
      const posRank = parseInt(cols[rankIdx], 10);
      if (!sleeperId || !Number.isFinite(posRank) || posRank < 1) continue;
      const position = ((cols[posIdx] || fallbackPos) || '').trim().toUpperCase();
      rows.push({
        sleeperId,
        name: (cols[nameIdx] || '').trim(),
        position,
        posRank,
        effRank: posRank,
        adp: posRank,
      });
    }
  });

  rosRowsCache = rows;
  return rows;
}

/**
 * @returns {Promise<Object>} { [sleeperId]: { rank, position, posRank, effRank, adp, name } }
 */
export async function loadRosRankMap() {
  const rows = await loadRosRows();
  const rankMap = {};
  for (const row of rows) {
    rankMap[row.sleeperId] = {
      rank: row.posRank,
      position: row.position,
      posRank: row.posRank,
      effRank: row.effRank,
      adp: row.adp,
      name: row.name,
    };
  }
  return rankMap;
}

/**
 * @returns {Promise<Object>} { QB: { maxPosRank, maxEffRank }, ... }
 */
export async function loadRosPositionMaxRanks() {
  const rows = await loadRosRows();
  const maxByPos = {};
  for (const row of rows) {
    const pos = row.position;
    if (!maxByPos[pos]) maxByPos[pos] = { maxPosRank: 0, maxEffRank: 0 };
    maxByPos[pos].maxPosRank = Math.max(maxByPos[pos].maxPosRank, row.posRank);
    maxByPos[pos].maxEffRank = Math.max(maxByPos[pos].maxEffRank, row.effRank);
  }
  return maxByPos;
}

/** Rows for the roster-editor search pool, ordered RB/WR/QB/TE by ROS rank. */
export async function loadRosRankRows() {
  const rows = await loadRosRows();
  const byPos = { RB: [], WR: [], QB: [], TE: [] };
  for (const row of rows) {
    if (byPos[row.position]) byPos[row.position].push({ ...row });
  }
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => a.posRank - b.posRank);
  }
  const ordered = [];
  const maxLen = Math.max(0, ...Object.values(byPos).map((list) => list.length));
  for (let i = 0; i < maxLen; i++) {
    for (const pos of ['RB', 'WR', 'QB', 'TE']) {
      if (byPos[pos][i]) ordered.push(byPos[pos][i]);
    }
  }
  ordered.forEach((row, i) => { row.adp = i + 1; });
  return ordered;
}

/**
 * How many regular-season weeks are already finished (capped at 14).
 */
export function getLockedRegularSeasonWeeks(season) {
  return Math.max(0, Math.min(REG_SEASON_WEEKS, getCompletedWeeksCount(season)));
}

/**
 * Official matchup points overwrite stat-derived points for anyone who
 * appeared in a completed week. Free agents keep the score_format calculation
 * so a scenario add-on still has real weeks behind them.
 */
async function fetchMatchupWeek(week) {
  const res = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${week}`);
  if (!res.ok) return null;
  const entries = await res.json();
  return Array.isArray(entries) ? entries : null;
}

async function overlayMatchupPoints(lockedWeekPoints, matchupsByWeek) {
  matchupsByWeek.forEach((entries, i) => {
    const weekMap = lockedWeekPoints[i];
    if (!weekMap || !entries) return;
    for (const entry of entries) {
      const pts = entry && entry.players_points;
      if (!pts || typeof pts !== 'object') continue;
      for (const [pid, val] of Object.entries(pts)) {
        const n = Number(val);
        if (Number.isFinite(n)) weekMap[String(pid)] = n;
      }
    }
  });
}

function teamPointsFromMatchups(matchupsByWeek) {
  return matchupsByWeek.map((entries) => {
    const map = {};
    if (!entries) return map;
    for (const entry of entries) {
      if (!entry || entry.roster_id == null) continue;
      const n = Number(entry.points);
      if (Number.isFinite(n)) map[String(entry.roster_id)] = n;
    }
    return map;
  });
}

/**
 * Actual league points for completed regular-season weeks.
 * Index 0 is week 1. Future weeks are omitted.
 *
 * @returns {Promise<{ lockedWeekCount: number, lockedWeekPoints: Array<Object>|null, lockedTeamWeekPoints: Array<Object>|null }>}
 */
export async function loadLockedRegularSeasonPoints(season, scoringConfig, playersData) {
  const lockedWeekCount = getLockedRegularSeasonWeeks(season);
  if (lockedWeekCount <= 0 || !scoringConfig) {
    return { lockedWeekCount: 0, lockedWeekPoints: null, lockedTeamWeekPoints: null };
  }

  const weeks = Array.from({ length: lockedWeekCount }, (_, i) => i + 1);
  const [rawByWeek, matchupsByWeek] = await Promise.all([
    Promise.all(weeks.map((week) => fetchWeeklyStats(season, week))),
    Promise.all(weeks.map((week) => fetchMatchupWeek(week).catch(() => null))),
  ]);
  const weeklyStats = Array.from({ length: 17 }, (_, i) => rawByWeek[i] || null);
  const pointsByWeek = buildSleeperBasePoints(weeklyStats, scoringConfig, playersData);
  const lockedWeekPoints = pointsByWeek.slice(0, lockedWeekCount);
  overlayMatchupPoints(lockedWeekPoints, matchupsByWeek);

  return {
    lockedWeekCount,
    lockedWeekPoints,
    lockedTeamWeekPoints: teamPointsFromMatchups(matchupsByWeek),
  };
}
