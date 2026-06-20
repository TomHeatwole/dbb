import { interpolateRedraftLookup } from './redraftRankLookupLoader';

export const REBUILD_BETA_UP = 0.54;
export const REBUILD_BETA_DOWN = 0.77;
export const REBUILD_GAP_SCALE = 11;
export const REBUILD_REDUCE_RANK_BOOST = 0.18;
export const REBUILD_DEPTH_KTC_RANK_MIN = 40;
export const REBUILD_DEPTH_GAP_MIN = 25;
export const REBUILD_DEPTH_GAP_SCALE = 60;
export const REBUILD_BETA_UP_DEPTH_BOOST = 0.10;
export const REBUILD_SEV_RVI_FLOOR = 0.55;
export const REBUILD_SEV_RVI_SCALE = 0.40;

export function rebuilderDepthBetaUpBoost(rankGap, ktcPosRank, redraftValueIndex) {
  if (ktcPosRank == null || ktcPosRank <= REBUILD_DEPTH_KTC_RANK_MIN || redraftValueIndex == null) {
    return 0;
  }
  const gapFrac = Math.min(1, Math.max(0, rankGap - REBUILD_DEPTH_GAP_MIN) / REBUILD_DEPTH_GAP_SCALE);
  const sevFrac = Math.min(
    1,
    Math.max(0, REBUILD_SEV_RVI_FLOOR - redraftValueIndex) / REBUILD_SEV_RVI_SCALE,
  );
  return REBUILD_BETA_UP_DEPTH_BOOST * gapFrac * sevFrac;
}

export function rebuilderGamma(rankGap) {
  const gap = Math.max(0, rankGap);
  return 1 / (1 + (gap / REBUILD_GAP_SCALE) ** 2);
}

export function rebuilderFlipBeta(redraftDelta, rankGap, ktcPosRank, redraftValueIndex) {
  if (redraftDelta <= 0) {
    let beta = REBUILD_BETA_UP;
    if (ktcPosRank != null) {
      beta += rebuilderDepthBetaUpBoost(rankGap, ktcPosRank, redraftValueIndex);
    }
    return beta;
  }
  let beta = REBUILD_BETA_DOWN;
  const adpBetterGap = Math.max(0, -rankGap);
  if (adpBetterGap > 0) {
    beta *= 1 + REBUILD_REDUCE_RANK_BOOST * (adpBetterGap / REBUILD_GAP_SCALE) ** 2;
  }
  return beta;
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
  const redraftValueIndex = ktcValue > 0 ? value / ktcValue : null;
  const flipBeta = rebuilderFlipBeta(redraftDelta, rankGap, ktcPosRank, redraftValueIndex);
  let rebuilderAdjustedValue = Math.max(
    0,
    Math.round(rebuildCore - flipBeta * redraftDelta),
  );
  let rebuildValueIndex = ktcValue > 0
    ? Math.round((rebuilderAdjustedValue / ktcValue) * 10000) / 10000
    : null;

  // Zero competitor adjusted → maximum rebuild (formula evaluated at adjusted = 0).
  if (value === 0) {
    const maxFlipBeta = rebuilderFlipBeta(-ktcValue, rankGap, ktcPosRank, 0);
    rebuilderAdjustedValue = Math.max(
      0,
      Math.round(rebuildCore - maxFlipBeta * (-ktcValue)),
    );
    rebuildValueIndex = ktcValue > 0
      ? Math.round((rebuilderAdjustedValue / ktcValue) * 10000) / 10000
      : null;
  }

  return {
    histAtKtcValue,
    rankGap,
    gamma,
    dynastyPremium,
    rebuildCore,
    redraftDelta,
    redraftValueIndex,
    flipBeta: value === 0 ? rebuilderFlipBeta(-ktcValue, rankGap, ktcPosRank, 0) : flipBeta,
    depthBetaBoost: rebuilderDepthBetaUpBoost(rankGap, ktcPosRank, redraftValueIndex),
    rebuilderAdjustedValue,
    rebuildValueIndex,
    dampedFlip: (value === 0
      ? rebuilderFlipBeta(-ktcValue, rankGap, ktcPosRank, 0)
      : flipBeta) * (value === 0 ? -ktcValue : redraftDelta),
  };
}
