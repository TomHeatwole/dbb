/**
 * outcomeDistribution.js
 *
 * Builds Gaussian-ish outcome pools from historical ADP ±5 windows,
 * handles bottom-10 bucket sharing and top-ADP normalization, and
 * maps percentile rolls (0–100) to selected outcomes.
 */

const ADP_WINDOW = 5;
const BOTTOM_BUCKET_SIZE = 10;
const TOP_NORMALIZATION_MAX_RANK = 5;

/**
 * Map percentile (0=worst, 100=best) to an outcome index in a descending-sorted pool.
 */
export function percentileToOutcomeIndex(percentile, outcomeCount) {
  if (outcomeCount <= 0) return -1;
  const p = Math.max(0, Math.min(100, Number(percentile) || 0));
  return Math.min(outcomeCount - 1, Math.floor(((100 - p) / 100) * outcomeCount));
}

/**
 * Select an outcome from a sorted pool given a percentile.
 */
export function selectOutcomeFromPool(outcomes, percentile) {
  if (!outcomes || outcomes.length === 0) return null;
  const idx = percentileToOutcomeIndex(percentile, outcomes.length);
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
 * Find elite outcome seasons (by finish rank) for top-ADP normalization.
 */
function findEliteOutcomeSeasons(catalog, position, maxOutcomeRank) {
  return catalog.filter(
    (e) => e.position === position
      && e.outcomeRank != null
      && e.outcomeRank <= maxOutcomeRank,
  );
}

/**
 * Inject synthetic duplicates proportional to missing upward ADP range.
 * Preserves P50 ≈ median of base pool by duplicating top-half elite seasons.
 */
function injectTopAdpSyntheticOutcomes(baseOutcomes, catalog, position, effRank) {
  const rank = Math.ceil(effRank);
  if (rank > TOP_NORMALIZATION_MAX_RANK || baseOutcomes.length === 0) {
    return baseOutcomes;
  }

  const missingUp = Math.max(0, ADP_WINDOW - (rank - 1));
  if (missingUp === 0) return baseOutcomes;

  const fullWindowSize = ADP_WINDOW * 2 + 1;
  const syntheticTarget = Math.round(baseOutcomes.length * (missingUp / fullWindowSize));
  if (syntheticTarget <= 0) return baseOutcomes;

  const elitePool = findEliteOutcomeSeasons(catalog, position, rank);
  if (elitePool.length === 0) return baseOutcomes;

  const sorted = baseOutcomes.slice().sort((a, b) => b.scoringPts - a.scoringPts);
  const medianPts = sorted[Math.floor(sorted.length / 2)]?.scoringPts ?? 0;

  const goodElite = elitePool
    .filter((e) => e.scoringPts >= medianPts)
    .sort((a, b) => b.scoringPts - a.scoringPts);

  const source = goodElite.length > 0 ? goodElite : elitePool.sort((a, b) => b.scoringPts - a.scoringPts);
  const augmented = [...baseOutcomes];

  for (let i = 0; i < syntheticTarget; i++) {
    augmented.push({ ...source[i % source.length], synthetic: true });
  }

  return augmented;
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
    if (effRank <= TOP_NORMALIZATION_MAX_RANK) {
      pool = injectTopAdpSyntheticOutcomes(pool, catalog, position, effRank);
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
