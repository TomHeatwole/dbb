/** Top N players by input value included in positional value compare baselines. */
export const TOP_KTC_RANK = 300;

export function filterTopKtcPlayers(players, topN = TOP_KTC_RANK) {
  return [...(players || [])]
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, topN);
}

/**
 * Symmetric % difference in total HVORP: (A − B) / midpoint × 100.
 */
export function hvorpPctDelta(hvorpA, hvorpB, delta = null) {
  const d = delta != null ? delta : hvorpA - hvorpB;
  if (!Number.isFinite(hvorpA) || !Number.isFinite(hvorpB) || !Number.isFinite(d)) return null;
  const mid = (hvorpA + hvorpB) / 2;
  if (mid === 0) return null;
  return Math.round((d / mid) * 1000) / 10;
}

/**
 * Group summary % — weighted by |Δ HVORP| so RB30 vs WR40 nudges the average
 * less than RB1 vs WR3. Falls back to mean-HVORP symmetric % when all deltas are 0.
 */
export function groupHvorpPctDelta(comparisons) {
  if (!comparisons?.length) return null;

  let sumWeight = 0;
  let sumWeightedPct = 0;
  for (const c of comparisons) {
    const pct = c.pctDelta ?? hvorpPctDelta(c.hvorpA, c.hvorpB, c.delta);
    const w = Math.abs(c.delta);
    if (pct == null || !Number.isFinite(w) || w === 0) continue;
    sumWeight += w;
    sumWeightedPct += w * pct;
  }

  if (sumWeight > 0) {
    return Math.round((sumWeightedPct / sumWeight) * 10) / 10;
  }

  const n = comparisons.length;
  const avgA = comparisons.reduce((s, c) => s + c.hvorpA, 0) / n;
  const avgB = comparisons.reduce((s, c) => s + c.hvorpB, 0) / n;
  return hvorpPctDelta(avgA, avgB);
}

/**
 * Value multipliers grounded on QB = 1.0.
 * For each other position, |Δ|-weighted mean of (pos HVORP / QB HVORP) in QB vs pos pairs.
 * Applying mult × nominal value approximates QB-equivalent scoring power.
 */
export function computeQbGroundedMultipliers(comparisons) {
  const QB = 'QB';
  const byPosition = {
    [QB]: {
      position: QB,
      multiplier: 1,
      pairCount: 0,
      avgHvorpQb: null,
      avgHvorpPos: null,
      avgDelta: 0,
    },
  };

  for (const pos of ['RB', 'WR', 'TE']) {
    const pairs = (comparisons || []).filter((c) => c.posA === QB && c.posB === pos);

    if (pairs.length === 0) {
      byPosition[pos] = {
        position: pos,
        multiplier: null,
        pairCount: 0,
        avgHvorpQb: null,
        avgHvorpPos: null,
        avgDelta: null,
      };
      continue;
    }

    let sumW = 0;
    let sumRatio = 0;
    let sumHvorpQb = 0;
    let sumHvorpPos = 0;
    let sumDelta = 0;

    for (const c of pairs) {
      const w = Math.abs(c.delta);
      if (!Number.isFinite(c.hvorpA) || c.hvorpA === 0) continue;
      const ratio = c.hvorpB / c.hvorpA;
      if (!Number.isFinite(ratio)) continue;

      if (w > 0) {
        sumW += w;
        sumRatio += w * ratio;
        sumHvorpQb += w * c.hvorpA;
        sumHvorpPos += w * c.hvorpB;
        sumDelta += w * c.delta;
      }
    }

    if (sumW > 0) {
      byPosition[pos] = {
        position: pos,
        multiplier: Math.round((sumRatio / sumW) * 1000) / 1000,
        pairCount: pairs.length,
        avgHvorpQb: Math.round((sumHvorpQb / sumW) * 10) / 10,
        avgHvorpPos: Math.round((sumHvorpPos / sumW) * 10) / 10,
        avgDelta: Math.round((sumDelta / sumW) * 10) / 10,
      };
    } else {
      const n = pairs.length;
      const avgQb = pairs.reduce((s, c) => s + c.hvorpA, 0) / n;
      const avgPos = pairs.reduce((s, c) => s + c.hvorpB, 0) / n;
      byPosition[pos] = {
        position: pos,
        multiplier: avgQb > 0 ? Math.round((avgPos / avgQb) * 1000) / 1000 : null,
        pairCount: pairs.length,
        avgHvorpQb: Math.round(avgQb * 10) / 10,
        avgHvorpPos: Math.round(avgPos * 10) / 10,
        avgDelta: Math.round(pairs.reduce((s, c) => s + c.delta, 0) / n * 10) / 10,
      };
    }
  }

  return { baseline: QB, byPosition };
}
