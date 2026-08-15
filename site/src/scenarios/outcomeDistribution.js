/**
 * outcomeDistribution.js
 *
 * Outcome pools for the season simulator / Future Scenarios v2.
 *
 * Pipeline:
 *  1. Canonical pools on an integer ADP-rank grid, each from a ±2 window of
 *     same-position historical seasons (triangular kernel weights where the
 *     window is truncated at the top of the position).
 *  2. Upper-half monotonicity (default `quantiles`): local windows stay put,
 *     then smash seasons that invert P100→P50 vs a better ADP are promoted
 *     up the board. Busts (below median) stay in their original window.
 *     Legacy `medianPool` instead reassigns whole piles by median.
 *  3. Fractional ranks blend the two adjacent grid pools (RB3.5 gets a
 *     50/50-weighted mix of the RB3 and RB4 pools).
 *  4. Ranks past the shallowest catalog year's draft depth (and the bottom
 *     10 of the current draft) share one tail bucket per position, so thin
 *     recent-year-only samples can't invert the deep tail.
 *  5. Pools are densified with synthetic seasons interpolated between each
 *     adjacent pair of real outcomes (week-spliced from the two parents).
 *     Higher variance settings additionally extrapolate a few seasons
 *     beyond the historical ceiling and floor.
 *
 * Percentile rolls (0–100) map to outcomes through the weighted CDF.
 * That roll supplies weeks 1–14. Weeks 15–17 are a second independent
 * roll from real historical playoff weeks, kernel-weighted toward
 * seasons whose weeks 1–14 total is close to the one already drawn.
 */

const ADP_WINDOW = 2;
const KERNEL_HALF_WIDTH = ADP_WINDOW + 1;
const BOTTOM_BUCKET_SIZE = 10;
const INTERP_SPLIT_WEEK = 9;
const NUM_WEEKS_DEFAULT = 17;
const REG_SEASON_WEEKS = 14;
/** Nearest same-position regular-season totals used as a playoff donor pool. */
const PLAYOFF_NEIGHBORS = 30;

/**
 * Variance levels control how far synthetic seasons may extend beyond the
 * historical ceiling/floor of a pool. `low` interpolates only (a season can
 * never beat the best real season in the window); higher levels add a few
 * low-probability seasons scaled beyond both historical extremes.
 */
export const VARIANCE_LEVELS = {
  low: { label: 'Historical', description: 'Outcomes capped at the best/worst real season', extrapolations: [] },
  medium: { label: 'Elevated', description: 'Rare outcomes up to 12% beyond the historical range', extrapolations: [0.12] },
  high: { label: 'Chaotic', description: 'Rare outcomes up to 25% beyond the historical range', extrapolations: [0.12, 0.25] },
};
export const DEFAULT_VARIANCE = 'low';

export function normalizeVariance(v) {
  return VARIANCE_LEVELS[v] ? v : DEFAULT_VARIANCE;
}

/**
 * How ADP order is enforced on outcome piles.
 * `quantiles` (default): better ADP is at least as good from median through
 * ceiling; inverting smash seasons move up; busts stay local.
 * `medianPool`: previous whole-pile reorder by median (ceilings can invert).
 */
export const MONOTONE_MODES = {
  quantiles: {
    label: 'Ceilings',
    description: 'Better ADP wins from median through ceiling. Smash seasons that invert move up the board; busts stay local.',
  },
  medianPool: {
    label: 'Median piles',
    description: 'Previous reorder: entire outcome piles sorted by median. Typical seasons follow ADP; ceilings can invert.',
  },
};
export const DEFAULT_MONOTONE = 'quantiles';

export function normalizeMonotone(m) {
  return MONOTONE_MODES[m] ? m : DEFAULT_MONOTONE;
}

/**
 * Map percentile (0=worst, 100=best) to an outcome index in a descending-sorted pool.
 * When cumWeights is provided (weighted pool), the percentile maps through
 * the weighted CDF instead of uniformly by index.
 */
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

/**
 * Cumulative weights for a sorted pool, or null when the pool is unweighted
 * (uniform index sampling is equivalent and cheaper).
 */
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

/**
 * Select an outcome from a sorted pool given a percentile.
 */
export function selectOutcomeFromPool(outcomes, percentile) {
  if (!outcomes || outcomes.length === 0) {
    return { outcome: null, index: -1 };
  }
  const cumWeights = buildPoolCumulativeWeights(outcomes);
  const idx = percentileToOutcomeIndex(percentile, outcomes.length, cumWeights);
  return { outcome: outcomes[idx], index: idx };
}

// ─── Integer-rank grid with monotonic reordering ─────────────────────────────

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

/**
 * Promote smash seasons up the ADP board until P100→P50 is weakly decreasing.
 * Overlapping windows share seasons as copies: if the better rank already has
 * the smash, it is simply removed from the worse rank (no duplication).
 * Seasons below the median are not moved.
 */
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

/**
 * Pool quality for the legacy whole-pile reorder: densified median primary,
 * weighted mean as tiebreak.
 */
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

/** Blend two adjacent grid pools for a fractional rank (weights ∝ proximity). */
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

// ─── Synthetic densification ──────────────────────────────────────────────────

function parentRef(e) {
  return { sleeperId: e.sleeperId, seasonYear: e.seasonYear, scoringPts: e.scoringPts };
}

/**
 * Insert an interpolated synthetic season between each adjacent pair of real
 * outcomes, and (at higher variance) extrapolated seasons beyond the
 * historical ceiling/floor. Synthetic totals always sit at the midpoint of
 * their parents, so the distribution's shape is preserved — synthetics only
 * add granularity, never new mass outside the real range (except the
 * explicitly variance-gated extrapolations).
 */
function densifyPool(sortedReal, variance) {
  if (sortedReal.length < 2) return sortedReal;

  const out = [];
  for (let i = 0; i < sortedReal.length; i++) {
    out.push(sortedReal[i]);
    if (i + 1 >= sortedReal.length) break;
    const hi = sortedReal[i];
    const lo = sortedReal[i + 1];
    // Alternate which parent supplies the early weeks so synthetic season
    // shapes aren't systematically front-loaded.
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

// ─── Pool building ────────────────────────────────────────────────────────────

/**
 * Build the sorted outcome pool for a player.
 *
 * @param {Object} adpInfo  { position, posRank, effRank }
 * @param {Array} catalog   Full historical outcome catalog
 * @param {Object} positionMaxRanks  From current-year Hwang ADP
 * @param {Object} [options]  { variance, densify, monotone }
 * @returns {Array} Outcomes sorted by scoringPts descending
 */
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

// ─── Weekly materialization ───────────────────────────────────────────────────

function realWeekArray(ref, basePointsByYear, numWeeks) {
  const arr = new Array(numWeeks).fill(0);
  const yearWeeks = basePointsByYear[String(ref.seasonYear)];
  if (!yearWeeks) return arr;
  for (let wi = 0; wi < numWeeks; wi++) {
    arr[wi] = yearWeeks[wi]?.[ref.sleeperId] ?? 0;
  }
  return arr;
}

/**
 * Weekly fantasy points for an outcome (real or synthetic).
 *
 * Real outcomes read their historical season's weekly points. Interpolated
 * synthetics splice the two parent seasons at splitWeek, then scale so the
 * season total lands at the midpoint of the parents — preserving realistic
 * weekly texture (spike weeks, injury zeros) instead of averaging it away.
 * Extrapolated synthetics scale their single parent's weeks by `scale`.
 */
export function materializeOutcomeWeeks(outcome, basePointsByYear, numWeeks = NUM_WEEKS_DEFAULT) {
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

// ─── Playoff weeks (independent roll, conditioned on weeks 1–14) ─────────────

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

/**
 * Index of real weeks-15–17 vectors, keyed by position, ready for a second
 * percentile roll conditioned on a realized weeks 1–14 total.
 */
export function buildPlayoffIndex(catalog, basePointsByYear, numWeeks = NUM_WEEKS_DEFAULT) {
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

export function overlayPlayoffWeeks(weeks, playoffOutcome) {
  if (!weeks) return weeks;
  const po = playoffOutcome?.po;
  if (!po) return weeks;
  const out = weeks.slice();
  out[REG_SEASON_WEEKS] = po[0];
  out[REG_SEASON_WEEKS + 1] = po[1];
  out[REG_SEASON_WEEKS + 2] = po[2];
  return out;
}

export function regularSeasonTotal(weeks) {
  if (!weeks) return 0;
  let tot = 0;
  for (let wi = 0; wi < REG_SEASON_WEEKS; wi++) tot += weeks[wi] || 0;
  return tot;
}

// ─── Projections ──────────────────────────────────────────────────────────────

/**
 * Build projection metadata for all players in rosters.
 *
 * @returns {Object} { [playerId]: PlayerProjection }
 */
export function buildPlayerProjections(
  allPlayerIds,
  hwangAdpRankMap,
  catalog,
  positionMaxRanks,
  percentileRolls,
  options = {},
) {
  const projections = {};

  for (const playerId of allPlayerIds) {
    const adpInfo = hwangAdpRankMap && hwangAdpRankMap[playerId];
    if (!adpInfo) {
      projections[playerId] = {
        adpLabel: null,
        percentile: null,
        outcomes: [],
        selectedIndex: -1,
        selectedOutcome: null,
        unranked: true,
      };
      continue;
    }

    const outcomes = buildOutcomePool(adpInfo, catalog, positionMaxRanks, options);
    const posLabel = adpInfo.posRank != null
      ? `${adpInfo.position}${adpInfo.posRank}`
      : `${adpInfo.position}${Math.round(adpInfo.effRank)}`;

    if (!outcomes.length) {
      projections[playerId] = {
        adpLabel: posLabel,
        position: adpInfo.position,
        posRank: adpInfo.posRank,
        effRank: adpInfo.effRank,
        percentile: null,
        outcomes: [],
        selectedIndex: -1,
        selectedOutcome: null,
        unranked: true,
      };
      continue;
    }

    const percentile = percentileRolls[playerId] != null
      ? Number(percentileRolls[playerId])
      : 50;

    const { outcome, index } = selectOutcomeFromPool(outcomes, percentile);

    projections[playerId] = {
      adpLabel: posLabel,
      position: adpInfo.position,
      posRank: adpInfo.posRank,
      effRank: adpInfo.effRank,
      percentile,
      outcomes,
      selectedIndex: index,
      selectedOutcome: outcome,
      unranked: false,
      playoffPercentile: null,
      playoffOutcomes: [],
      selectedPlayoffIndex: -1,
      selectedPlayoffOutcome: null,
    };
  }

  return projections;
}

/**
 * Generate random percentile rolls for players missing from existing rolls.
 */
export function generateMissingRolls(playerIds, existingRolls = {}) {
  const rolls = { ...(existingRolls || {}) };
  for (const pid of playerIds) {
    if (rolls[pid] == null) {
      rolls[pid] = Math.floor(Math.random() * 101);
    }
  }
  return rolls;
}

/**
 * Attach the independent playoff roll (weeks 15–17) onto a projection, given
 * the already-materialized regular-season weeks.
 */
export function attachPlayoffProjection(projection, playoffIndex, weeks, playoffPercentile) {
  const percentile = playoffPercentile != null ? Number(playoffPercentile) : 50;
  const pos = projection?.position;
  const regPts = regularSeasonTotal(weeks);
  const { outcome, index, pool } = selectPlayoffOutcome(playoffIndex, pos, regPts, percentile);
  return {
    ...(projection || {}),
    playoffPercentile: percentile,
    playoffOutcomes: pool,
    selectedPlayoffIndex: index,
    selectedPlayoffOutcome: outcome,
    regularSeasonPts: regPts,
  };
}

/**
 * Collect unique season years from selected outcomes (including synthetic
 * outcomes' parent seasons, whose weekly stats are needed for splicing).
 */
export function collectRequiredSeasonYears(projections) {
  const years = new Set();
  for (const proj of Object.values(projections || {})) {
    const sel = proj?.selectedOutcome;
    if (!sel) continue;
    if (sel.seasonYear != null) years.add(sel.seasonYear);
    for (const parent of (sel.parents || [])) {
      if (parent?.seasonYear != null) years.add(parent.seasonYear);
    }
  }
  return [...years].sort((a, b) => a - b);
}
