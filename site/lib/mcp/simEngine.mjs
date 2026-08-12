/**
 * simEngine.mjs — server-side Monte Carlo season simulator.
 *
 * Node port of the browser simulator's pure math. Each iteration rolls a
 * percentile per player, maps it into an outcome pool built from historical
 * seasons of players with similar Hwang ADP, scores every roster with optimal
 * best-ball lineups for 17 weeks, and accumulates finish distributions.
 *
 * KEEP IN SYNC with the frontend sources of truth:
 *   site/src/scenarios/outcomeDistribution.js   (outcome pools)
 *   site/src/scenarios/simulatorLineup.js       (optimal lineup scoring)
 *   site/src/scenarios/computeScenarioEval.js   (buildFinalStandings)
 *   site/src/scenarios/sleeperScoring.js        (Sleeper stats → points)
 *   site/src/data_parse/fantasyCalculator.js    (scoring config math)
 *   site/src/scenarios/historicalRankingsBuilder.js (outcome ranks)
 */

import { STARTER_POSITION_NAMES } from './config.mjs';

const NUM_WEEKS = 17;
const REG_SEASON_WEEKS = 14;
const ZERO_WEEKS = new Float32Array(NUM_WEEKS);

export const DEFAULT_ITERATIONS = 1000;
export const MAX_ITERATIONS = 5000;

// ─── Outcome pools (Hwang ADP ±5 window) ─────────────────────────────────────

const ADP_WINDOW = 5;
const BOTTOM_BUCKET_SIZE = 10;
const KERNEL_HALF_WIDTH = ADP_WINDOW + 1;

export function percentileToOutcomeIndex(percentile, outcomeCount, cumWeights = null) {
  if (outcomeCount <= 0) return -1;
  const p = Math.max(0, Math.min(100, Number(percentile) || 0));
  if (!cumWeights) {
    return Math.min(outcomeCount - 1, Math.floor(((100 - p) / 100) * outcomeCount));
  }
  const target = ((100 - p) / 100) * cumWeights[outcomeCount - 1];
  let lo = 0;
  let hi = outcomeCount - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumWeights[mid] > target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function buildPoolCumulativeWeights(outcomes) {
  if (!outcomes || outcomes.length === 0 || outcomes[0]?.weight == null) {
    return null;
  }
  const cum = new Float64Array(outcomes.length);
  let total = 0;
  for (let i = 0; i < outcomes.length; i++) {
    total += outcomes[i].weight ?? 1;
    cum[i] = total;
  }
  return cum;
}

function isBottomBucket(effRank, posRank, position, positionMaxRanks) {
  const max = positionMaxRanks && positionMaxRanks[position];
  if (!max) return false;
  const eff = effRank ?? posRank;
  if (eff == null) return false;
  return eff >= max.maxEffRank - (BOTTOM_BUCKET_SIZE - 1)
    || (posRank != null && posRank >= max.maxPosRank - (BOTTOM_BUCKET_SIZE - 1));
}

function filterByEffRankWindow(catalog, position, centerEffRank, windowSize = ADP_WINDOW) {
  const lo = centerEffRank - windowSize;
  const hi = centerEffRank + windowSize;
  return catalog.filter((e) => e.position === position && e.effRank >= lo && e.effRank <= hi);
}

function filterBottomBucket(catalog, position, positionMaxRanks) {
  const max = positionMaxRanks[position];
  if (!max) return [];
  const minEff = max.maxEffRank - (BOTTOM_BUCKET_SIZE - 1);
  return catalog.filter((e) => e.position === position && e.effRank >= minEff);
}

function isTopTruncatedWindow(effRank) {
  return effRank - ADP_WINDOW < 1;
}

function applyKernelWeights(outcomes, centerEffRank) {
  return outcomes.map((e) => ({
    ...e,
    weight: (KERNEL_HALF_WIDTH - Math.abs(e.effRank - centerEffRank)) / KERNEL_HALF_WIDTH,
  }));
}

export function buildOutcomePool(adpInfo, catalog, positionMaxRanks) {
  if (!adpInfo || !catalog) return [];
  const { position, posRank, effRank: rawEffRank } = adpInfo;
  const effRank = rawEffRank ?? posRank;
  if (!position || effRank == null) return [];

  let pool;
  if (isBottomBucket(effRank, posRank, position, positionMaxRanks)) {
    pool = filterBottomBucket(catalog, position, positionMaxRanks);
  } else {
    pool = filterByEffRankWindow(catalog, position, effRank, ADP_WINDOW);
    if (isTopTruncatedWindow(effRank)) {
      pool = applyKernelWeights(pool, effRank);
    }
  }
  return pool.slice().sort((a, b) => b.scoringPts - a.scoringPts);
}

// ─── Scoring config math (fantasyCalculator.js) ───────────────────────────────

function calculateBonuses(playerStats, bonuses) {
  let bonusPoints = 0;
  if (bonuses.passing_300_bonus && playerStats.passing_yards >= 300) bonusPoints += bonuses.passing_300_bonus;
  if (bonuses.passing_400_bonus && playerStats.passing_yards >= 400) bonusPoints += bonuses.passing_400_bonus;
  if (bonuses.rushing_100_bonus && playerStats.rushing_yards >= 100) bonusPoints += bonuses.rushing_100_bonus;
  if (bonuses.receiving_100_bonus && playerStats.receiving_yards >= 100) bonusPoints += bonuses.receiving_100_bonus;
  return bonusPoints;
}

export function calculateFantasyPoints(playerStats, config) {
  if (!playerStats || !config) return 0;
  let points = 0;
  const playerPosition = playerStats.position;

  if (config.scoring) {
    for (const [statKey, pointsPerUnit] of Object.entries(config.scoring)) {
      const statValue = parseFloat(playerStats[statKey] || 0);
      let finalPointsPerUnit = pointsPerUnit;
      if (config.position_specific_scoring
          && config.position_specific_scoring[statKey]
          && playerPosition) {
        const positionOverride = config.position_specific_scoring[statKey][playerPosition];
        if (positionOverride !== undefined) finalPointsPerUnit = positionOverride;
      }
      points += statValue * finalPointsPerUnit;
    }
  }
  if (config.bonuses) points += calculateBonuses(playerStats, config.bonuses);
  return Math.round(points * 100) / 100;
}

// ─── Sleeper raw stats → fantasy points (sleeperScoring.js) ───────────────────

export const SLEEPER_FIELD_MAP = {
  pass_yd: 'passing_yards',
  pass_td: 'passing_tds',
  pass_int: 'passing_interceptions',
  pass_2pt: 'passing_2pt_conversions',
  rush_yd: 'rushing_yards',
  rush_td: 'rushing_tds',
  rush_2pt: 'rushing_2pt_conversions',
  rush_fum_lost: 'rushing_fumbles_lost',
  rec: 'receptions',
  rec_yd: 'receiving_yards',
  rec_td: 'receiving_tds',
  rec_2pt: 'receiving_2pt_conversions',
  rec_fum_lost: 'receiving_fumbles_lost',
  fum_rec_td: 'receiving_tds',
  sack_fum_lost: 'sack_fumbles_lost',
  fgm: 'fg_made',
  fgmiss: 'fg_missed',
  fgm_50_59: 'fg_made_50_59',
  fgm_60_: 'fg_made_60_',
  xpm: 'pat_made',
  xpmiss: 'pat_missed',
  def_sack: 'def_sacks',
  def_int: 'def_interceptions',
  def_fr: 'def_fumbles',
  def_td: 'def_tds',
  def_safe: 'def_safeties',
  def_st_td: 'special_teams_tds',
  st_td: 'special_teams_tds',
};

export function mapSleeperStats(sleeperStats, position) {
  if (!sleeperStats) return { position: position || '' };
  const mapped = { position: position || '' };
  for (const [sleeperKey, scoreKey] of Object.entries(SLEEPER_FIELD_MAP)) {
    const val = sleeperStats[sleeperKey];
    if (val != null && val !== 0) {
      mapped[scoreKey] = (mapped[scoreKey] || 0) + val;
    }
  }
  if (sleeperStats.fum_lost != null && sleeperStats.fum_lost !== 0) {
    if (!mapped.rushing_fumbles_lost && !mapped.receiving_fumbles_lost) {
      mapped.rushing_fumbles_lost = sleeperStats.fum_lost;
    }
  }
  return mapped;
}

export function computePointsFromSleeperStats(sleeperStats, position, scoringConfig) {
  if (!sleeperStats || !scoringConfig) return 0;
  return calculateFantasyPoints(mapSleeperStats(sleeperStats, position), scoringConfig);
}

/**
 * Build result[weekIndex][playerId] = points from 17 weeks of raw Sleeper stats.
 * Pass `neededIds` (a Set) to restrict computation to relevant players.
 */
export function buildSleeperBasePoints(sleeperWeeklyStats, scoringConfig, playersData, neededIds = null) {
  return Array.from({ length: NUM_WEEKS }, (_, weekIdx) => {
    const weekStats = sleeperWeeklyStats && sleeperWeeklyStats[weekIdx];
    if (!weekStats || typeof weekStats !== 'object') return {};
    const weekPts = {};
    for (const [pid, stats] of Object.entries(weekStats)) {
      if (neededIds && !neededIds.has(pid)) continue;
      if (!stats || typeof stats !== 'object') continue;
      const position = playersData?.[pid]?.position || '';
      weekPts[pid] = computePointsFromSleeperStats(stats, position, scoringConfig);
    }
    return weekPts;
  });
}

// ─── Historical outcome ranks from a season stats CSV ─────────────────────────

function parseCsvLine(line) {
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

function normalizeName(name) {
  if (!name) return '';
  let n = name.toLowerCase().trim();
  const suffixes = [' jr.', ' jr', ' sr.', ' sr', ' ii', ' iii', ' iv', ' v'];
  for (const s of suffixes) {
    if (n.endsWith(s)) { n = n.slice(0, n.length - s.length).trim(); break; }
  }
  return n;
}

/**
 * Parse stats_player_reg_{year}.csv into positional rank arrays sorted by
 * league-scoring fantasy points (TE gets +0.5/reception).
 */
export function buildHistoricalPositionRanks(csvText, playersData) {
  const empty = { QB: [], RB: [], WR: [], TE: [] };
  if (!csvText || !playersData) return empty;

  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return empty;

  const gsisToSleeper = {};
  const nameToSleeper = {};
  const normNameToSleeper = {};
  for (const sid in playersData) {
    const p = playersData[sid];
    if (!p) continue;
    const gsis = p.gsis_id && p.gsis_id.trim();
    if (gsis) gsisToSleeper[gsis] = sid;
    const name = p.full_name && p.full_name.trim();
    if (name) {
      nameToSleeper[name.toLowerCase()] = sid;
      normNameToSleeper[normalizeName(name)] = sid;
    }
  }

  const headers = lines[0].split(',');
  const idIdx = headers.indexOf('player_id');
  const nameIdx = headers.indexOf('player_display_name');
  const posIdx = headers.indexOf('position');
  const ptsIdx = headers.indexOf('fantasy_points');
  const recIdx = headers.indexOf('receptions');
  if (idIdx === -1 || posIdx === -1 || ptsIdx === -1) return empty;

  const byPosition = { QB: [], RB: [], WR: [], TE: [] };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = parseCsvLine(line);
    const gsisId = vals[idIdx]?.trim();
    const position = vals[posIdx]?.trim();
    if (!gsisId || !byPosition[position]) continue;

    const stdPts = parseFloat(vals[ptsIdx]) || 0;
    const receptions = recIdx !== -1 ? (parseFloat(vals[recIdx]) || 0) : 0;
    const scoringPts = position === 'TE' ? stdPts + receptions * 0.5 : stdPts;
    if (scoringPts <= 0) continue;

    const csvName = nameIdx !== -1 ? (vals[nameIdx]?.trim() || '') : '';
    const sleeperId =
      gsisToSleeper[gsisId] ||
      (csvName && nameToSleeper[csvName.toLowerCase()]) ||
      (csvName && normNameToSleeper[normalizeName(csvName)]);
    if (!sleeperId) continue;

    byPosition[position].push({ sleeperId, scoringPts });
  }

  const result = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    byPosition[pos].sort((a, b) => b.scoringPts - a.scoringPts);
    result[pos] = byPosition[pos];
  }
  return result;
}

// ─── Optimal best-ball lineup scoring (simulatorLineup.js) ────────────────────

let positionCountsCache = null;

function getPositionCounts() {
  if (positionCountsCache) return positionCountsCache;
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPER: 0 };
  (STARTER_POSITION_NAMES || []).forEach((name) => {
    if (!name) return;
    if (/^QB\d+$/i.test(name) || name === 'QB1') { counts.QB += 1; return; }
    if (/^RB\d+$/i.test(name)) { counts.RB += 1; return; }
    if (/^WR\d+$/i.test(name)) { counts.WR += 1; return; }
    if (/^TE\d+$/i.test(name) || name === 'TE1') { counts.TE += 1; return; }
    if (/^FLEX\d+$/i.test(name)) { counts.FLEX += 1; return; }
    if (/^SUPER$/i.test(name) || /^SUPER\d+$/i.test(name)) { counts.SUPER += 1; }
  });
  positionCountsCache = counts;
  return counts;
}

const isEligibleForSuper = (pos) => pos === 'QB' || pos === 'RB' || pos === 'WR' || pos === 'TE';
const isEligibleForFlex = (pos) => pos === 'RB' || pos === 'WR' || pos === 'TE';

function sortByPointsDesc(players, seasonTotals) {
  return players.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (seasonTotals) {
      const aTot = seasonTotals[a.id] || 0;
      const bTot = seasonTotals[b.id] || 0;
      if (bTot !== aTot) return bTot - aTot;
    }
    const aId = String(a.id);
    const bId = String(b.id);
    if (aId < bId) return -1;
    if (aId > bId) return 1;
    return 0;
  });
}

export function computeOptimalWeekStarterTotal(playerList, weekPts, playerPositions, seasonTotals) {
  const combined = [];
  for (let i = 0; i < playerList.length; i++) {
    const id = playerList[i];
    if (!id || id === '0') continue;
    combined.push({ id, pts: weekPts[id] ?? 0, position: playerPositions[id] || null });
  }
  if (combined.length === 0) return 0;

  const counts = getPositionCounts();
  const usedIds = new Set();
  let total = 0;

  const qbs = []; const rbs = []; const wrs = []; const tes = [];
  for (const p of combined) {
    if (p.position === 'QB') qbs.push(p);
    else if (p.position === 'RB') rbs.push(p);
    else if (p.position === 'WR') wrs.push(p);
    else if (p.position === 'TE') tes.push(p);
  }
  sortByPointsDesc(qbs, seasonTotals);
  sortByPointsDesc(rbs, seasonTotals);
  sortByPointsDesc(wrs, seasonTotals);
  sortByPointsDesc(tes, seasonTotals);

  function takeTop(list, n) {
    let taken = 0;
    for (let i = 0; i < list.length && taken < n; i++) {
      const p = list[i];
      if (usedIds.has(p.id)) continue;
      usedIds.add(p.id);
      total += p.pts;
      taken += 1;
    }
  }
  takeTop(qbs, counts.QB);
  takeTop(rbs, counts.RB);
  takeTop(wrs, counts.WR);
  takeTop(tes, counts.TE);

  const remaining = [];
  for (const p of combined) if (!usedIds.has(p.id)) remaining.push(p);
  sortByPointsDesc(remaining, seasonTotals);

  if (counts.FLEX > 0) {
    let flexLeft = counts.FLEX;
    for (let i = 0; i < remaining.length && flexLeft > 0; i++) {
      const p = remaining[i];
      if (usedIds.has(p.id) || !isEligibleForFlex(p.position)) continue;
      usedIds.add(p.id);
      total += p.pts;
      flexLeft -= 1;
    }
  }

  if (counts.SUPER > 0) {
    let superLeft = counts.SUPER;
    for (let i = 0; i < combined.length && superLeft > 0; i++) {
      const p = combined[i];
      if (usedIds.has(p.id) || !isEligibleForSuper(p.position)) continue;
      usedIds.add(p.id);
      total += p.pts;
      superLeft -= 1;
    }
  }

  return total;
}

export function buildPlayerPositionsMap(playerIds, playersData) {
  const map = {};
  for (const pid of playerIds) map[pid] = playersData?.[pid]?.position || null;
  return map;
}

// ─── Standings (computeScenarioEval.js buildFinalStandings) ───────────────────

export function buildFinalStandings(regSeasonTotals, playoffTotals) {
  const all = Object.keys(regSeasonTotals).map((rid) => ({
    rosterId: Number(rid),
    regSeasonTotal: regSeasonTotals[rid] || 0,
    playoffTotal: playoffTotals[rid] || 0,
  }));
  const byRegSeason = all.slice().sort((a, b) => b.regSeasonTotal - a.regSeasonTotal);
  const top4 = byRegSeason.slice(0, 4)
    .sort((a, b) => b.playoffTotal - a.playoffTotal)
    .map((row, i) => ({ ...row, place: i + 1, isPlayoff: true }));
  const bottom6 = byRegSeason.slice(4)
    .map((row, i) => ({ ...row, place: 5 + i, isPlayoff: false }));
  return [...top4, ...bottom6];
}

// ─── Monte Carlo loop ─────────────────────────────────────────────────────────

/**
 * Prepare a reusable simulation context.
 *
 * @param {Object} args
 * @param {Object} args.scenarioRosters   { [rosterId]: string[] }
 * @param {Object|null} args.baselineRosters  Optional baseline for delta tracking
 * @param {Object} args.hwangAdpRankMap   { [sleeperId]: { position, posRank, effRank } }
 * @param {Array}  args.catalog           Historical outcome catalog
 * @param {Object} args.positionMaxRanks  { QB: { maxPosRank, maxEffRank }, ... }
 * @param {Object} args.basePointsByYear  { [year]: [wk0..wk16 { pid: pts }] }
 * @param {Object} args.playersData       Sleeper players metadata
 */
export function prepareSimContext({
  scenarioRosters,
  baselineRosters = null,
  hwangAdpRankMap,
  catalog,
  positionMaxRanks,
  basePointsByYear,
  playersData,
}) {
  const allPlayerIds = new Set();
  for (const rid in scenarioRosters) {
    for (const pid of (scenarioRosters[rid] || [])) allPlayerIds.add(pid);
  }

  const rostersEqual = (() => {
    if (!baselineRosters) return true;
    const keys = new Set([...Object.keys(baselineRosters), ...Object.keys(scenarioRosters)]);
    for (const key of keys) {
      const left = [...(baselineRosters[key] || [])].sort().join(',');
      const right = [...(scenarioRosters[key] || [])].sort().join(',');
      if (left !== right) return false;
    }
    return true;
  })();

  const trackBaseline = baselineRosters && !rostersEqual;
  if (trackBaseline) {
    for (const rid in baselineRosters) {
      for (const pid of (baselineRosters[rid] || [])) allPlayerIds.add(pid);
    }
  }

  const playerIdList = [...allPlayerIds];

  const pools = {};
  const poolCumWeights = {};
  for (const pid of playerIdList) {
    const adpInfo = hwangAdpRankMap && hwangAdpRankMap[pid];
    pools[pid] = adpInfo ? buildOutcomePool(adpInfo, catalog, positionMaxRanks) : [];
    poolCumWeights[pid] = buildPoolCumulativeWeights(pools[pid]);
  }

  const outcomeWeekPts = {};
  for (const pid of playerIdList) {
    const pool = pools[pid] || [];
    outcomeWeekPts[pid] = pool.map((outcome) => {
      const yearWeeks = basePointsByYear[String(outcome.seasonYear)];
      const arr = new Float32Array(NUM_WEEKS);
      for (let wi = 0; wi < NUM_WEEKS; wi++) {
        arr[wi] = yearWeeks?.[wi]?.[outcome.sleeperId] ?? 0;
      }
      return arr;
    });
  }

  return {
    scenarioRosters,
    baselineRosters: trackBaseline ? baselineRosters : null,
    allPlayerIds: playerIdList,
    pools,
    poolCumWeights,
    outcomeWeekPts,
    playerPositions: buildPlayerPositionsMap(playerIdList, playersData),
    rosterIds: Object.keys(scenarioRosters).map(Number),
    weekBuffers: Array.from({ length: NUM_WEEKS }, () => ({})),
    seasonTotals: {},
    rolls: {},
  };
}

function fillWeeklyFromRolls(ctx) {
  const { allPlayerIds, pools, poolCumWeights, outcomeWeekPts, weekBuffers, seasonTotals, rolls } = ctx;
  for (const pid of allPlayerIds) {
    const poolLen = pools[pid]?.length ?? 0;
    let ptsArr = ZERO_WEEKS;
    if (poolLen > 0) {
      const pct = rolls[pid] ?? 50;
      const idx = percentileToOutcomeIndex(pct, poolLen, poolCumWeights[pid]);
      ptsArr = outcomeWeekPts[pid][idx] || ZERO_WEEKS;
    }
    let total = 0;
    for (let wi = 0; wi < NUM_WEEKS; wi++) {
      const p = ptsArr[wi];
      weekBuffers[wi][pid] = p;
      total += p;
    }
    seasonTotals[pid] = total;
  }
}

function scoreRosters(ctx, rosters) {
  const { weekBuffers, seasonTotals, playerPositions } = ctx;
  const regTotals = {};
  const ploffTotals = {};

  for (const rid in rosters) {
    const playerList = rosters[rid] || [];
    let reg = 0;
    let ploff = 0;
    for (let wi = 0; wi < NUM_WEEKS; wi++) {
      const weekTotal = computeOptimalWeekStarterTotal(
        playerList, weekBuffers[wi], playerPositions, seasonTotals,
      );
      if (wi < REG_SEASON_WEEKS) reg += weekTotal;
      else ploff += weekTotal;
    }
    regTotals[rid] = Math.round(reg * 10) / 10;
    ploffTotals[rid] = Math.round(ploff * 10) / 10;
  }

  const standings = buildFinalStandings(regTotals, ploffTotals);
  return { standings, regTotals, ploffTotals };
}

function emptyStats(rosterIds) {
  const stats = {};
  for (const rid of rosterIds) {
    stats[rid] = {
      rosterId: rid, wins: 0, playoffCount: 0, top3Count: 0,
      placeSum: 0, regSeasonSum: 0, playoffSum: 0,
    };
  }
  return stats;
}

function accumulate(stats, outcome, rosterIds) {
  for (const row of outcome.standings) {
    const s = stats[row.rosterId];
    if (!s) continue;
    if (row.place === 1) s.wins += 1;
    if (row.isPlayoff) s.playoffCount += 1;
    if (row.place <= 3) s.top3Count += 1;
    s.placeSum += row.place;
  }
  for (const rid of rosterIds) {
    stats[rid].regSeasonSum += outcome.regTotals[rid] || 0;
    stats[rid].playoffSum += outcome.ploffTotals[rid] || 0;
  }
}

function buildResults(stats, iterations, rosterIds) {
  return rosterIds.map((rid) => {
    const row = stats[rid];
    const avgRegSeason = row.regSeasonSum / iterations;
    const avgPlayoff = row.playoffSum / iterations;
    return {
      rosterId: rid,
      winPct: (row.wins / iterations) * 100,
      playoffPct: (row.playoffCount / iterations) * 100,
      top3Pct: (row.top3Count / iterations) * 100,
      avgFinish: row.placeSum / iterations,
      avgRegSeason,
      avgPlayoff,
      avgTotalScore: avgRegSeason + avgPlayoff,
    };
  }).sort((a, b) => {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    return b.avgTotalScore - a.avgTotalScore;
  });
}

/**
 * Run the Monte Carlo loop. When a baseline is tracked, both roster sets are
 * scored with the SAME percentile rolls each iteration, so deltas isolate the
 * roster change itself.
 *
 * @returns {{ results, baselineResults|null }}
 */
export function runSeasonSim(ctx, iterations = DEFAULT_ITERATIONS) {
  const n = Math.max(1, Math.min(MAX_ITERATIONS, Math.round(Number(iterations) || DEFAULT_ITERATIONS)));
  const stats = emptyStats(ctx.rosterIds);
  const baselineStats = ctx.baselineRosters ? emptyStats(ctx.rosterIds) : null;

  for (let i = 0; i < n; i++) {
    for (const pid of ctx.allPlayerIds) {
      ctx.rolls[pid] = (Math.random() * 101) | 0;
    }
    fillWeeklyFromRolls(ctx);

    accumulate(stats, scoreRosters(ctx, ctx.scenarioRosters), ctx.rosterIds);
    if (baselineStats) {
      accumulate(baselineStats, scoreRosters(ctx, ctx.baselineRosters), ctx.rosterIds);
    }
  }

  return {
    iterations: n,
    results: buildResults(stats, n, ctx.rosterIds),
    baselineResults: baselineStats ? buildResults(baselineStats, n, ctx.rosterIds) : null,
  };
}
