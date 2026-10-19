/**
 * simData.mjs — data loading for the server-side season simulator.
 *
 * Assembles everything simEngine.mjs needs:
 *   - Hwang Adjusted Positional ADP (hwang_adjusted_positional_adp.csv)
 *   - Historical outcome catalog (stats_player_reg_{year}.csv × 5 years)
 *   - League scoring config (score_format.json)
 *   - Historical weekly points (Sleeper stats API, cached per process)
 *
 * Mirrors the browser loaders in site/src/scenarios/hwangAdpLoader.js and
 * site/src/scenarios/historicalOutcomeData.js.
 *
 * HwangAI / MCP must stay on Hwang ADP positional tags. The admin UI can
 * optionally map current-season players through Redraft Dash ranks — that
 * path is browser-only (simulatorRankSource.js) and must never be imported
 * or parameterized here.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { DATA_DIR, CURRENT_YEAR } from './config.mjs';
import { loadPlayersData } from './dataLoader.mjs';
import { getCompletedWeeksCount } from './helpers.mjs';
import { fetchMatchups } from './sleeperApi.mjs';
import { buildHistoricalPositionRanks, buildSleeperBasePoints } from './simEngine.mjs';

const OUTCOME_HISTORY_YEARS = 5;
const NUM_WEEKS = 17;
const REG_SEASON_WEEKS = 14;

const ROS_CSVS = [
  { file: 'fantasypros_ros_qb.csv', position: 'QB' },
  { file: 'fantasypros_ros_rb_std.csv', position: 'RB' },
  { file: 'fantasypros_ros_wr_std.csv', position: 'WR' },
  { file: 'fantasypros_ros_te_half.csv', position: 'TE' },
];

export function getOutcomeHistoryYears(currentYear) {
  const end = Number(currentYear) - 1;
  const start = end - OUTCOME_HISTORY_YEARS + 1;
  const years = [];
  for (let y = start; y <= end; y++) years.push(y);
  return years;
}

// ─── Hwang ADP ────────────────────────────────────────────────────────────────

let hwangAdpByYearCache = null;

function parseCsvRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += c; }
  }
  result.push(current);
  return result;
}

function loadHwangAdpByYear() {
  if (hwangAdpByYearCache) return hwangAdpByYearCache;

  const text = readFileSync(join(DATA_DIR, 'hwang_adjusted_positional_adp.csv'), 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const byYear = new Map();

  if (lines.length >= 2) {
    const headers = parseCsvRow(lines[0]);
    const idx = (name) => headers.indexOf(name);

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvRow(lines[i]);
      const rowYear = parseInt((cols[idx('year')] || '').trim(), 10);
      const name = (cols[idx('name')] || '').trim();
      const position = (cols[idx('position')] || '').trim();
      const sleeperId = (cols[idx('sleeper_id')] || '').trim();
      if (!Number.isFinite(rowYear) || !name || !position || !sleeperId) continue;

      const hwangAdp = parseFloat((cols[idx('hwang_adjusted_adp')] || '').trim());
      if (!Number.isFinite(hwangAdp)) continue;

      const optInt = (col) => {
        const raw = (cols[idx(col)] || '').trim();
        if (!raw) return null;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : null;
      };
      const optFloat = (col) => {
        const raw = (cols[idx(col)] || '').trim();
        if (!raw) return null;
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n : null;
      };

      const row = {
        year: rowYear,
        name,
        position,
        sleeperId,
        adp: hwangAdp,
        posRank: optInt('hwang_pos_rank'),
        effRank: optFloat('hwang_eff_rank'),
      };
      if (!byYear.has(rowYear)) byYear.set(rowYear, []);
      byYear.get(rowYear).push(row);
    }
  }

  hwangAdpByYearCache = byYear;
  return byYear;
}

export function loadHwangAdpRankMap(year) {
  const rows = loadHwangAdpByYear().get(Number(year)) || [];
  const rankMap = {};
  for (const row of rows) {
    if (!row.posRank && !row.effRank) continue;
    rankMap[row.sleeperId] = {
      rank: row.posRank || Math.round(row.effRank || 999),
      position: row.position,
      posRank: row.posRank,
      effRank: row.effRank ?? row.posRank,
      adp: row.adp,
      name: row.name,
    };
  }
  return rankMap;
}

export function loadHwangPositionMaxRanks(year) {
  const rows = loadHwangAdpByYear().get(Number(year)) || [];
  const maxByPos = {};
  for (const row of rows) {
    const pos = row.position;
    if (!maxByPos[pos]) maxByPos[pos] = { maxPosRank: 0, maxEffRank: 0 };
    if (row.posRank != null) {
      maxByPos[pos].maxPosRank = Math.max(maxByPos[pos].maxPosRank, row.posRank);
    }
    const eff = row.effRank ?? row.posRank;
    if (eff != null) {
      maxByPos[pos].maxEffRank = Math.max(maxByPos[pos].maxEffRank, eff);
    }
  }
  return maxByPos;
}

// ─── Historical outcome catalog ───────────────────────────────────────────────

const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
let catalogCache = null; // keyed by currentYear

export function loadOutcomeCatalog(currentYear, playersData) {
  if (catalogCache && catalogCache.currentYear === Number(currentYear)) {
    return catalogCache;
  }

  const years = getOutcomeHistoryYears(currentYear);
  const hwangByYear = loadHwangAdpByYear();

  const catalog = [];
  for (const year of years) {
    let csvText = null;
    try {
      csvText = readFileSync(join(DATA_DIR, `stats_player_reg_${year}.csv`), 'utf8');
    } catch { /* season CSV missing — skip */ }
    if (!csvText) continue;

    const posRanks = buildHistoricalPositionRanks(csvText, playersData);

    const outcomeRankLookup = {};
    const scoringPtsLookup = {};
    for (const pos of POSITIONS) {
      outcomeRankLookup[pos] = {};
      (posRanks[pos] || []).forEach((entry, idx) => {
        outcomeRankLookup[pos][entry.sleeperId] = idx + 1;
        scoringPtsLookup[entry.sleeperId] = entry.scoringPts;
      });
    }

    for (const row of (hwangByYear.get(year) || [])) {
      const { position, sleeperId } = row;
      if (!POSITIONS.includes(position) || !sleeperId) continue;
      const scoringPts = scoringPtsLookup[sleeperId];
      if (scoringPts == null || scoringPts <= 0) continue;
      const effRank = row.effRank ?? row.posRank;
      if (effRank == null) continue;
      catalog.push({
        sleeperId,
        seasonYear: year,
        position,
        adpRank: row.posRank,
        effRank,
        scoringPts,
        outcomeRank: outcomeRankLookup[position][sleeperId] || null,
      });
    }
  }

  catalogCache = { currentYear: Number(currentYear), years, catalog };
  return catalogCache;
}

// ─── Scoring config ───────────────────────────────────────────────────────────

let scoringConfigCache = null;

export function loadScoringConfig() {
  if (scoringConfigCache) return scoringConfigCache;
  scoringConfigCache = JSON.parse(readFileSync(join(DATA_DIR, 'score_format.json'), 'utf8'));
  return scoringConfigCache;
}

// ─── Historical weekly points (Sleeper stats API) ─────────────────────────────

// Per-process cache: { [year]: [wk0..wk16 { pid: pts }] }
// Points are precomputed with the league scoring config and filtered to the
// outcome-catalog players, so the cached footprint stays small.
const basePointsCache = {};

async function fetchYearWeeklyStats(year) {
  const weeks = Array.from({ length: NUM_WEEKS }, (_, i) => i + 1);
  const responses = await Promise.all(
    weeks.map(async (week) => {
      try {
        const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${year}/${week}`);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }),
  );
  return responses; // index 0 = week 1
}

/**
 * Load (and cache) per-week fantasy points for the given historical years,
 * restricted to `neededIds` (the outcome-catalog player set).
 *
 * @returns {Promise<Object>} { [year]: [wk0..wk16 { pid: pts }] }
 */
export async function loadBasePointsByYear(years, neededIds, scoringConfig, playersData) {
  const missing = years.filter((y) => !basePointsCache[String(y)]);

  await Promise.all(
    missing.map(async (year) => {
      const rawWeeks = await fetchYearWeeklyStats(year);
      basePointsCache[String(year)] = buildSleeperBasePoints(
        rawWeeks, scoringConfig, playersData, neededIds,
      );
    }),
  );

  const out = {};
  for (const y of years) out[String(y)] = basePointsCache[String(y)] || [];
  return out;
}

// ─── Rest-of-season ranks + locked weeks ─────────────────────────────────────

/** Finished regular-season weeks (capped at 14). Index 0 of locked points is week 1. */
export function getLockedRegularSeasonWeeks(season = CURRENT_YEAR) {
  return Math.max(0, Math.min(REG_SEASON_WEEKS, getCompletedWeeksCount(season)));
}

let rosRowsCache = null;

function loadRosRows() {
  if (rosRowsCache) return rosRowsCache;
  const rows = [];
  for (const cfg of ROS_CSVS) {
    const text = readFileSync(join(DATA_DIR, cfg.file), 'utf8');
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) continue;
    const headers = parseCsvRow(lines[0]);
    const rankIdx = headers.indexOf('rank');
    const nameIdx = headers.indexOf('name');
    const posIdx = headers.indexOf('position');
    const sleeperIdx = headers.indexOf('sleeper_id');
    if (rankIdx === -1 || sleeperIdx === -1) continue;
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvRow(lines[i]);
      const sleeperId = (cols[sleeperIdx] || '').trim();
      const posRank = parseInt(cols[rankIdx], 10);
      if (!sleeperId || !Number.isFinite(posRank) || posRank < 1) continue;
      const position = ((cols[posIdx] || cfg.position) || '').trim().toUpperCase();
      rows.push({
        sleeperId,
        name: nameIdx === -1 ? '' : (cols[nameIdx] || '').trim(),
        position,
        posRank,
        effRank: posRank,
        adp: posRank,
      });
    }
  }
  rosRowsCache = rows;
  return rows;
}

/** FantasyPros ROS positional tags. Same shape as loadHwangAdpRankMap. */
export function loadRosRankMap() {
  const rankMap = {};
  for (const row of loadRosRows()) {
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

export function loadRosPositionMaxRanks() {
  const maxByPos = {};
  for (const row of loadRosRows()) {
    const pos = row.position;
    if (!maxByPos[pos]) maxByPos[pos] = { maxPosRank: 0, maxEffRank: 0 };
    maxByPos[pos].maxPosRank = Math.max(maxByPos[pos].maxPosRank, row.posRank);
    maxByPos[pos].maxEffRank = Math.max(maxByPos[pos].maxEffRank, row.effRank);
  }
  return maxByPos;
}

function overlayMatchupPoints(lockedWeekPoints, matchupsByWeek) {
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

async function fetchWeekStats(year, week) {
  try {
    const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${year}/${week}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const lockedPointsCache = new Map();

/**
 * Actual league points for completed regular-season weeks.
 * Index 0 is week 1. Mirrors site/src/scenarios/rosRankLoader.js.
 */
export async function loadLockedRegularSeasonPoints(season, scoringConfig, playersData) {
  const lockedWeekCount = getLockedRegularSeasonWeeks(season);
  if (lockedWeekCount <= 0 || !scoringConfig) {
    return { lockedWeekCount: 0, lockedWeekPoints: null, lockedTeamWeekPoints: null };
  }
  const cacheKey = `${season}:${lockedWeekCount}`;
  const hit = lockedPointsCache.get(cacheKey);
  if (hit) return hit;

  const weeks = Array.from({ length: lockedWeekCount }, (_, i) => i + 1);
  const [rawByWeek, matchupsByWeek] = await Promise.all([
    Promise.all(weeks.map((week) => fetchWeekStats(season, week))),
    Promise.all(weeks.map((week) => fetchMatchups(week, season).catch(() => null))),
  ]);
  const weeklyStats = Array.from({ length: NUM_WEEKS }, (_, i) => rawByWeek[i] || null);
  const pointsByWeek = buildSleeperBasePoints(weeklyStats, scoringConfig, playersData);
  const lockedWeekPoints = pointsByWeek.slice(0, lockedWeekCount);
  overlayMatchupPoints(lockedWeekPoints, matchupsByWeek);
  const result = {
    lockedWeekCount,
    lockedWeekPoints,
    lockedTeamWeekPoints: teamPointsFromMatchups(matchupsByWeek),
  };
  lockedPointsCache.set(cacheKey, result);
  return result;
}

/**
 * Load every static + historical input the simulator needs for the current
 * season. Rosters are supplied by the caller (they come from the Sleeper
 * league API and may be modified for hypotheticals).
 *
 * Default rank tags are Hwang ADP (preseason / full-season sim). Pass
 * `{ mode: 'ros' }` once the season has kicked off: FantasyPros rest-of-season
 * positional ranks, with finished weeks locked to actual scores.
 * Do not add a Redraft Dash / custom-board rank source — HwangAI must not
 * see or run that variant.
 */
export async function loadSimulationInputs({ mode = 'preseason' } = {}) {
  const useRos = mode === 'ros';
  const playersData = loadPlayersData();
  const scoringConfig = loadScoringConfig();
  const hwangAdpRankMap = useRos ? loadRosRankMap() : loadHwangAdpRankMap(CURRENT_YEAR);
  const positionMaxRanks = useRos ? loadRosPositionMaxRanks() : loadHwangPositionMaxRanks(CURRENT_YEAR);
  const { years, catalog } = loadOutcomeCatalog(CURRENT_YEAR, playersData);

  // Weekly points are only ever read for catalog players (outcome pools map
  // rostered players onto historical player-seasons).
  const neededIds = new Set(catalog.map((e) => e.sleeperId));
  const basePointsByYear = await loadBasePointsByYear(years, neededIds, scoringConfig, playersData);

  const locked = useRos
    ? await loadLockedRegularSeasonPoints(CURRENT_YEAR, scoringConfig, playersData)
    : { lockedWeekCount: 0, lockedWeekPoints: null, lockedTeamWeekPoints: null };

  return {
    playersData,
    scoringConfig,
    hwangAdpRankMap,
    positionMaxRanks,
    catalog,
    basePointsByYear,
    mode: useRos ? 'ros' : 'preseason',
    lockedWeekCount: locked.lockedWeekCount,
    lockedWeekPoints: locked.lockedWeekPoints,
    lockedTeamWeekPoints: locked.lockedTeamWeekPoints,
  };
}
