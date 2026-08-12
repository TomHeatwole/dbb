/**
 * outcomeDistribution.js
 *
 * Builds Gaussian-ish outcome pools from historical ADP ±5 windows,
 * handles bottom-10 bucket sharing and top-of-position kernel weighting,
 * and maps percentile rolls (0–100) to selected outcomes.
 */

const ADP_WINDOW = 5;
const BOTTOM_BUCKET_SIZE = 10;
const KERNEL_HALF_WIDTH = ADP_WINDOW + 1;

/**
 * Map percentile (0=worst, 100=best) to an outcome index in a descending-sorted pool.
 * When cumWeights is provided (kernel-weighted pool), the percentile maps through
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
  return catalog.filter(
    (e) => e.position === position && e.effRank >= lo && e.effRank <= hi,
  );
}

function filterBottomBucket(catalog, position, positionMaxRanks) {
  const max = positionMaxRanks[position];
  if (!max) return [];
  const minEff = max.maxEffRank - (BOTTOM_BUCKET_SIZE - 1);
  return catalog.filter(
    (e) => e.position === position && e.effRank >= minEff,
  );
}

/**
 * True when the ±window around effRank is cut off at the top of the position
 * (no ranks above #1 exist), leaving the pool asymmetric.
 */
function isTopTruncatedWindow(effRank) {
  return effRank - ADP_WINDOW < 1;
}

/**
 * Weight window entries by a triangular kernel on ADP distance. Applied only
 * at the top of a position, where the window is truncated: seasons drafted
 * closest to the player's rank count most, so the few same-rank seasons
 * aren't drowned out by lower-ranked neighbors. Nothing is fabricated or
 * duplicated to fill the missing side of the window.
 */
function applyKernelWeights(outcomes, centerEffRank) {
  return outcomes.map((e) => ({
    ...e,
    weight: (KERNEL_HALF_WIDTH - Math.abs(e.effRank - centerEffRank)) / KERNEL_HALF_WIDTH,
  }));
}

/**
 * Build the sorted outcome pool for a player.
 *
 * @param {Object} adpInfo  { position, posRank, effRank }
 * @param {Array} catalog   Full historical outcome catalog
 * @param {Object} positionMaxRanks  From current-year Hwang ADP
 * @returns {Array} Outcomes sorted by scoringPts descending
 */
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

  return pool
    .slice()
    .sort((a, b) => b.scoringPts - a.scoringPts);
}

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

    const outcomes = buildOutcomePool(adpInfo, catalog, positionMaxRanks);
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
 * Collect unique season years from selected outcomes.
 */
export function collectRequiredSeasonYears(projections) {
  const years = new Set();
  for (const proj of Object.values(projections || {})) {
    const y = proj?.selectedOutcome?.seasonYear;
    if (y != null) years.add(y);
  }
  return [...years].sort((a, b) => a - b);
}
