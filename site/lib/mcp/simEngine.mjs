/**
 * simEngine.mjs — server-side Monte Carlo season simulator.
 *
 * Node port of the browser simulator's pure math. Each iteration rolls a
 * percentile per player, maps it into an outcome pool built from historical
 * seasons of players with similar Hwang ADP (weeks 1–14), then independently
 * rolls weeks 15–17 from real playoff weeks of seasons with similar 1–14
 * scoring. Scores every roster with optimal best-ball lineups and accumulates
 * finish distributions.
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

// ─── Outcome pools (Hwang ADP ±2 window, monotonic grid + synthetics) ────────

const ADP_WINDOW = 2;
const KERNEL_HALF_WIDTH = ADP_WINDOW + 1;
const BOTTOM_BUCKET_SIZE = 10;
const INTERP_SPLIT_WEEK = 9;
const PLAYOFF_NEIGHBORS = 30;

export const VARIANCE_LEVELS = {
  low: { extrapolations: [] },
  medium: { extrapolations: [0.12] },
  high: { extrapolations: [0.12, 0.25] },
};
export const DEFAULT_VARIANCE = 'low';

export function normalizeVariance(v) {
  return VARIANCE_LEVELS[v] ? v : DEFAULT_VARIANCE;
}

export const MONOTONE_MODES = {
  quantiles: true,
  medianPool: true,
};
export const DEFAULT_MONOTONE = 'quantiles';

export function normalizeMonotone(m) {
  return MONOTONE_MODES[m] ? m : DEFAULT_MONOTONE;
}

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

function seasonKey(e) {
  if (e?.synthetic) {
    if (e.scale != null) {
      const p = e.parents?.[0];
      return `x:${p?.sleeperId}|${p?.seasonYear}|${e.scale}`;
    }
    const ps = (e.parents || []).map((p) => `${p.sleeperId}|${p.seasonYear}`).join('+');
    return `s:${ps}|${e.splitWeek}|${Math.round((e.scoringPts || 0) * 100)}`;
  }
  return `${e.sleeperId}|${e.seasonYear}`;
}

function sortPoolDesc(pool) {
  pool.sort((a, b) => b.scoringPts - a.scoringPts);
  return pool;
}

function outcomeIndexAt(pool, percentile) {
  if (!pool.length) return -1;
  return percentileToOutcomeIndex(percentile, pool.length, buildPoolCumulativeWeights(pool));
}

function applyUpperQuantilePromotions(pools) {
  const EPS = 1e-6;
  const last = pools.length - 1;
  if (last < 1) return;

  // Lower percentiles can delete a duplicate smash from a worse rank and
  // punch a hole in a higher quantile. Repeat the P100→P50 sweep until the
  // whole upper half is stable.
  for (let sweep = 0; sweep < 20; sweep++) {
    let any = false;
    for (let p = 100; p >= 50; p -= 1) {
      for (let pass = 0; pass <= last; pass++) {
        let changed = false;
        for (let r = 0; r < last; r++) {
          const better = pools[r];
          const worse = pools[r + 1];
          if (!better.length || !worse.length) continue;
          sortPoolDesc(better);
          sortPoolDesc(worse);
          const ib = outcomeIndexAt(worse, p);
          const ia = outcomeIndexAt(better, p);
          const a = better[ia];
          const b = worse[ib];
          if (!a || !b || b.scoringPts <= a.scoringPts + EPS) continue;

          const kB = seasonKey(b);
          if (better.some((e) => seasonKey(e) === kB)) continue;

          worse.splice(ib, 1);
          better.push({ ...b, weight: b.weight ?? 1 });
          changed = true;
          any = true;
        }
        if (!changed) break;
      }
    }
    if (!any) break;
  }
  for (const pool of pools) sortPoolDesc(pool);
}

function poolQuality(pool) {
  if (pool.length === 0) return { median: -Infinity, mean: -Infinity };
  let wTot = 0;
  let sum = 0;
  for (const e of pool) {
    wTot += e.weight;
    sum += e.weight * e.scoringPts;
  }
  const sorted = pool.slice().sort((a, b) => b.scoringPts - a.scoringPts);
  const densified = densifyPool(sorted, DEFAULT_VARIANCE);
  const cum = buildPoolCumulativeWeights(densified);
  const idx = percentileToOutcomeIndex(50, densified.length, cum);
  return { median: densified[idx].scoringPts, mean: wTot > 0 ? sum / wTot : -Infinity };
}

const gridCache = new WeakMap();

function getPositionGrid(catalog, position, positionMaxRanks, opts = {}) {
  const max = positionMaxRanks?.[position];
  const monotone = normalizeMonotone(opts.monotone);
  const variance = normalizeVariance(opts.variance);
  const densify = opts.densify !== false;
  const cacheKey = `${position}|${max?.maxEffRank ?? ''}|${max?.maxPosRank ?? ''}|${monotone}|${
    monotone === 'quantiles' && densify ? variance : (monotone === 'quantiles' ? 'reals' : '')
  }`;
  let byKey = gridCache.get(catalog);
  if (!byKey) {
    byKey = new Map();
    gridCache.set(catalog, byKey);
  }
  const cached = byKey.get(cacheKey);
  if (cached) return cached;

  const entries = catalog.filter((e) => e.position === position);

  let maxEntryEff = 0;
  for (const e of entries) maxEntryEff = Math.max(maxEntryEff, e.effRank);
  const bottomStart = max?.maxEffRank != null
    ? max.maxEffRank - (BOTTOM_BUCKET_SIZE - 1)
    : maxEntryEff - (BOTTOM_BUCKET_SIZE - 1);
  const tailStart = bottomStart;
  const gridMax = Math.max(1, Math.ceil(tailStart) - 1);

  const rawPools = [];
  for (let r = 1; r <= gridMax; r++) {
    const lo = r - ADP_WINDOW;
    const hi = r + ADP_WINDOW;
    const truncated = lo < 1;
    const pool = [];
    for (const e of entries) {
      if (e.effRank < lo || e.effRank > hi) continue;
      const weight = truncated
        ? (KERNEL_HALF_WIDTH - Math.abs(e.effRank - r)) / KERNEL_HALF_WIDTH
        : 1;
      pool.push({ ...e, weight });
    }
    rawPools.push(pool);
  }

  const tailBucket = entries
    .filter((e) => e.effRank >= tailStart)
    .map((e) => ({ ...e, weight: 1 }));

  let pools;
  let tailPool;
  let preDensified = false;

  if (monotone === 'medianPool') {
    const ranked = [...rawPools, tailBucket]
      .map((pool) => ({ pool, q: poolQuality(pool) }))
      .sort((x, y) => (y.q.median - x.q.median) || (y.q.mean - x.q.mean))
      .map((row) => row.pool);
    pools = ranked.slice(0, gridMax);
    tailPool = ranked[gridMax] ?? tailBucket;
  } else {
    const all = [...rawPools, tailBucket];
    applyUpperQuantilePromotions(all);
    if (densify) {
      for (let i = 0; i < all.length; i++) {
        all[i] = densifyPool(sortPoolDesc(all[i].slice()), variance);
      }
      applyUpperQuantilePromotions(all);
      preDensified = true;
    }
    pools = all.slice(0, gridMax);
    tailPool = all[gridMax] ?? tailBucket;
  }

  const grid = {
    pools,
    gridMax,
    tailStart,
    tailPool,
    maxPosRank: max?.maxPosRank ?? null,
    preDensified,
  };
  byKey.set(cacheKey, grid);
  return grid;
}

function blendAdjacentPools(poolA, poolB, frac) {
  const merged = new Map();
  const add = (e, scale) => {
    if (scale <= 0) return;
    const key = seasonKey(e);
    const prev = merged.get(key);
    if (prev) prev.weight += e.weight * scale;
    else merged.set(key, { ...e, weight: e.weight * scale });
  };
  for (const e of poolA) add(e, 1 - frac);
  for (const e of poolB) add(e, frac);
  return [...merged.values()];
}

function parentRef(e) {
  return { sleeperId: e.sleeperId, seasonYear: e.seasonYear, scoringPts: e.scoringPts };
}

function densifyPool(sortedReal, variance) {
  if (sortedReal.length < 2) return sortedReal;

  const out = [];
  for (let i = 0; i < sortedReal.length; i++) {
    out.push(sortedReal[i]);
    if (i + 1 >= sortedReal.length) break;
    const hi = sortedReal[i];
    const lo = sortedReal[i + 1];
    const parents = i % 2 === 0 ? [hi, lo] : [lo, hi];
    out.push({
      synthetic: true,
      position: hi.position,
      parents: parents.map(parentRef),
      splitWeek: INTERP_SPLIT_WEEK,
      scoringPts: (hi.scoringPts + lo.scoringPts) / 2,
      weight: ((hi.weight ?? 1) + (lo.weight ?? 1)) / 2,
      outcomeRank: null,
    });
  }

  const { extrapolations } = VARIANCE_LEVELS[variance] || VARIANCE_LEVELS[DEFAULT_VARIANCE];
  if (extrapolations.length > 0) {
    const best = sortedReal[0];
    const worst = sortedReal[sortedReal.length - 1];
    for (const d of extrapolations) {
      out.push({
        synthetic: true,
        extrapolation: 'ceiling',
        position: best.position,
        parents: [parentRef(best)],
        scale: 1 + d,
        scoringPts: best.scoringPts * (1 + d),
        weight: (best.weight ?? 1) * 0.5,
        outcomeRank: null,
      });
      out.push({
        synthetic: true,
        extrapolation: 'floor',
        position: worst.position,
        parents: [parentRef(worst)],
        scale: Math.max(0, 1 - d),
        scoringPts: worst.scoringPts * Math.max(0, 1 - d),
        weight: (worst.weight ?? 1) * 0.5,
        outcomeRank: null,
      });
    }
  }

  return out.sort((a, b) => b.scoringPts - a.scoringPts);
}

export function buildOutcomePool(adpInfo, catalog, positionMaxRanks, options = {}) {
  if (!adpInfo || !catalog) return [];
  const { position, posRank, effRank: rawEffRank } = adpInfo;
  const effRank = rawEffRank ?? posRank;
  if (!position || effRank == null) return [];

  const monotone = normalizeMonotone(options.monotone);
  const variance = normalizeVariance(options.variance);
  const densify = options.densify !== false;
  const grid = getPositionGrid(catalog, position, positionMaxRanks, { monotone, variance, densify });

  const inTail = effRank >= grid.tailStart
    || (posRank != null && grid.maxPosRank != null
      && posRank >= grid.maxPosRank - (BOTTOM_BUCKET_SIZE - 1));

  let pool;
  if (inTail || grid.pools.length === 0) {
    pool = grid.tailPool;
  } else {
    const r0 = Math.min(Math.max(1, Math.floor(effRank)), grid.gridMax);
    const r1 = Math.min(Math.ceil(effRank), grid.gridMax);
    pool = r0 === r1
      ? grid.pools[r0 - 1]
      : blendAdjacentPools(grid.pools[r0 - 1], grid.pools[r1 - 1], effRank - r0);
    if (pool.length === 0) pool = grid.tailPool;
  }

  const sorted = pool.slice().sort((a, b) => b.scoringPts - a.scoringPts);
  if (grid.preDensified || !densify) return sorted;
  return densifyPool(sorted, variance);
}

function realWeekArray(ref, basePointsByYear, numWeeks) {
  const arr = new Array(numWeeks).fill(0);
  const yearWeeks = basePointsByYear[String(ref.seasonYear)];
  if (!yearWeeks) return arr;
  for (let wi = 0; wi < numWeeks; wi++) {
    arr[wi] = yearWeeks[wi]?.[ref.sleeperId] ?? 0;
  }
  return arr;
}

export function materializeOutcomeWeeks(outcome, basePointsByYear, numWeeks = NUM_WEEKS) {
  if (!outcome) return new Array(numWeeks).fill(0);
  if (!outcome.synthetic) return realWeekArray(outcome, basePointsByYear, numWeeks);

  const parents = outcome.parents || [];
  if (outcome.scale != null && parents.length === 1) {
    return realWeekArray(parents[0], basePointsByYear, numWeeks).map((p) => p * outcome.scale);
  }
  if (parents.length === 2) {
    const a = realWeekArray(parents[0], basePointsByYear, numWeeks);
    const b = realWeekArray(parents[1], basePointsByYear, numWeeks);
    const split = outcome.splitWeek ?? INTERP_SPLIT_WEEK;
    const spliced = a.map((v, wi) => (wi < split ? v : b[wi]));
    const sum = (arr) => arr.reduce((x, y) => x + y, 0);
    const target = (sum(a) + sum(b)) / 2;
    const spliceTotal = sum(spliced);
    const f = spliceTotal > 0 ? target / spliceTotal : 0;
    return spliced.map((v) => v * f);
  }
  return new Array(numWeeks).fill(0);
}

function closestRegIndex(regs, query) {
  const n = regs.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (regs[mid] < query) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(regs[lo - 1] - query) <= Math.abs(regs[lo] - query)) return lo - 1;
  return lo;
}

function neighborBounds(n, center, k) {
  let lo = center;
  let hi = center;
  const want = Math.min(k, n);
  while (hi - lo + 1 < want && (lo > 0 || hi < n - 1)) {
    if (lo === 0) { hi += 1; continue; }
    if (hi === n - 1) { lo -= 1; continue; }
    const left = Math.abs(center - (lo - 1));
    const right = Math.abs((hi + 1) - center);
    if (left <= right) lo -= 1;
    else hi += 1;
  }
  return { lo, hi };
}

function playoffPoolAtIndex(seasons, center) {
  const n = seasons.length;
  const { lo, hi } = neighborBounds(n, center, PLAYOFF_NEIGHBORS);
  const query = seasons[center].regPts;
  const bandwidth = Math.max(
    Math.abs(seasons[lo].regPts - query),
    Math.abs(seasons[hi].regPts - query),
    1,
  );
  const pool = [];
  for (let i = lo; i <= hi; i++) {
    const e = seasons[i];
    const weight = Math.max(0.05, 1 - Math.abs(e.regPts - query) / (bandwidth + 1e-6));
    pool.push({ ...e, weight });
  }
  pool.sort((a, b) => b.poTotal - a.poTotal);
  return pool;
}

export function buildPlayoffIndex(catalog, basePointsByYear, numWeeks = NUM_WEEKS) {
  const byPos = {};
  for (const e of catalog || []) {
    const pos = e.position;
    if (!pos) continue;
    if (!byPos[pos]) byPos[pos] = [];
    const weeks = realWeekArray(e, basePointsByYear, numWeeks);
    let regPts = 0;
    for (let wi = 0; wi < REG_SEASON_WEEKS; wi++) regPts += weeks[wi] || 0;
    const po = [
      weeks[REG_SEASON_WEEKS] || 0,
      weeks[REG_SEASON_WEEKS + 1] || 0,
      weeks[REG_SEASON_WEEKS + 2] || 0,
    ];
    byPos[pos].push({
      sleeperId: e.sleeperId,
      seasonYear: e.seasonYear,
      position: pos,
      regPts,
      po,
      poTotal: po[0] + po[1] + po[2],
    });
  }

  const index = {};
  for (const pos of Object.keys(byPos)) {
    const seasons = byPos[pos].sort((a, b) => a.regPts - b.regPts);
    const regs = seasons.map((s) => s.regPts);
    const pools = seasons.map((_, i) => playoffPoolAtIndex(seasons, i));
    const cumWeights = pools.map((pool) => buildPoolCumulativeWeights(pool));
    index[pos] = { seasons, regs, pools, cumWeights };
  }
  return index;
}

export function selectPlayoffOutcome(playoffIndex, position, regPts, percentile) {
  const posIndex = playoffIndex && playoffIndex[position];
  if (!posIndex || !posIndex.pools.length) {
    return { outcome: null, index: -1, pool: [] };
  }
  const center = closestRegIndex(posIndex.regs, Number(regPts) || 0);
  const pool = posIndex.pools[center] || [];
  if (!pool.length) return { outcome: null, index: -1, pool };
  const idx = percentileToOutcomeIndex(percentile, pool.length, posIndex.cumWeights[center]);
  return { outcome: pool[idx], index: idx, pool };
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
  variance,
  monotone,
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
    pools[pid] = adpInfo
      ? buildOutcomePool(adpInfo, catalog, positionMaxRanks, { variance, monotone })
      : [];
    poolCumWeights[pid] = buildPoolCumulativeWeights(pools[pid]);
  }

  const outcomeWeekPts = {};
  for (const pid of playerIdList) {
    const pool = pools[pid] || [];
    outcomeWeekPts[pid] = pool.map(
      (outcome) => Float32Array.from(materializeOutcomeWeeks(outcome, basePointsByYear, NUM_WEEKS)),
    );
  }

  const playoffIndex = buildPlayoffIndex(catalog, basePointsByYear, NUM_WEEKS);

  return {
    scenarioRosters,
    baselineRosters: trackBaseline ? baselineRosters : null,
    allPlayerIds: playerIdList,
    pools,
    poolCumWeights,
    outcomeWeekPts,
    playoffIndex,
    playerPositions: buildPlayerPositionsMap(playerIdList, playersData),
    rosterIds: Object.keys(scenarioRosters).map(Number),
    weekBuffers: Array.from({ length: NUM_WEEKS }, () => ({})),
    seasonTotals: {},
    rolls: {},
    playoffRolls: {},
  };
}

function fillWeeklyFromRolls(ctx) {
  const {
    allPlayerIds, pools, poolCumWeights, outcomeWeekPts, playoffIndex,
    playerPositions, weekBuffers, seasonTotals, rolls, playoffRolls,
  } = ctx;
  for (const pid of allPlayerIds) {
    const poolLen = pools[pid]?.length ?? 0;
    if (poolLen === 0) {
      for (let wi = 0; wi < NUM_WEEKS; wi++) weekBuffers[wi][pid] = 0;
      seasonTotals[pid] = 0;
      continue;
    }
    const pct = rolls[pid] ?? 50;
    const idx = percentileToOutcomeIndex(pct, poolLen, poolCumWeights[pid]);
    const ptsArr = outcomeWeekPts[pid][idx] || ZERO_WEEKS;
    let total = 0;
    let reg = 0;
    for (let wi = 0; wi < REG_SEASON_WEEKS; wi++) {
      const p = ptsArr[wi];
      weekBuffers[wi][pid] = p;
      total += p;
      reg += p;
    }
    const pos = playerPositions[pid];
    const poSel = playoffIndex
      ? selectPlayoffOutcome(playoffIndex, pos, reg, (playoffRolls || {})[pid] ?? 50)
      : { outcome: null };
    const po = poSel.outcome?.po;
    for (let k = 0; k < 3; k++) {
      const p = po ? po[k] : (ptsArr[REG_SEASON_WEEKS + k] || 0);
      weekBuffers[REG_SEASON_WEEKS + k][pid] = p;
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
  if (!ctx.playoffRolls) ctx.playoffRolls = {};

  for (let i = 0; i < n; i++) {
    for (const pid of ctx.allPlayerIds) {
      ctx.rolls[pid] = (Math.random() * 101) | 0;
      ctx.playoffRolls[pid] = (Math.random() * 101) | 0;
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
