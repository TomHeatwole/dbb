import { interpolateRedraftLookup } from './redraftRankLookupLoader';

export const REBUILD_BETA = 0.50;
export const REBUILD_GAP_SCALE = 11;

export function rebuilderGamma(rankGap) {
  const gap = Math.max(0, rankGap);
  return 1 / (1 + (gap / REBUILD_GAP_SCALE) ** 2);
}

export function computeRebuilderAdjusted(row, lookupMap) {
  if (!row || !lookupMap) return null;

  const {
    ktcValue, ktcPosRank, adpEffRank, adpPosRank, value, position,
  } = row;
  if (
    ktcValue == null
    || ktcPosRank == null
    || !position
    || value == null
    || !Number.isFinite(ktcValue)
    || !Number.isFinite(value)
  ) {
    return null;
  }

  const effRank = adpEffRank ?? adpPosRank;
  if (effRank == null) return null;

  const histAtKtc = interpolateRedraftLookup(lookupMap, position, ktcPosRank);
  if (!histAtKtc || histAtKtc.interpolated == null) return null;

  const histAtKtcValue = histAtKtc.interpolated;
  const rankGap = effRank - ktcPosRank;
  const gamma = rebuilderGamma(rankGap);
  const dynastyPremium = ktcValue - histAtKtcValue;
  const rebuildCore = histAtKtcValue + gamma * dynastyPremium;
  const redraftDelta = value - ktcValue;
  const rebuilderAdjustedValue = Math.max(
    0,
    Math.round(rebuildCore - REBUILD_BETA * redraftDelta),
  );
  const rebuildValueIndex = ktcValue > 0
    ? Math.round((rebuilderAdjustedValue / ktcValue) * 10000) / 10000
    : null;

  return {
    histAtKtcValue,
    rankGap,
    gamma,
    dynastyPremium,
    rebuildCore,
    redraftDelta,
    rebuilderAdjustedValue,
    rebuildValueIndex,
    dampedFlip: REBUILD_BETA * redraftDelta,
  };
}
