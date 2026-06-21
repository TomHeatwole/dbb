/**
 * luckMetrics.js
 *
 * Converts average percentile rolls into "luck percentiles" using a Gaussian
 * null model: each player roll ~ Uniform(0, 100), so roster averages have
 * mean 50 and shrink toward 50 as roster size grows.
 */

import { getPlayerInfo } from '../lookups/PlayerLookup';
import { getRedraftValueEntryByName } from '../lookups/RedraftValueLookup';

const ROLL_MEAN = 50;
/** Std dev of Uniform(0, 100). */
const ROLL_STD = 100 / Math.sqrt(12);

/** Abramowitz & Stegun 7.1.26 */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Percentile rank of a simple mean of n independent uniform(0,100) rolls.
 */
export function meanRollLuckPercentile(sampleMean, n) {
  if (n <= 0 || sampleMean == null) return null;
  const se = ROLL_STD / Math.sqrt(n);
  if (se <= 0) return 50;
  const z = (sampleMean - ROLL_MEAN) / se;
  return normalCdf(z) * 100;
}

/**
 * Percentile rank of a weighted mean with weights w_i (competitor adjusted values).
 * Var = σ² Σ(w_i²) / (Σ w_i)² under independence.
 */
export function weightedMeanRollLuckPercentile(weightedMean, weights) {
  if (weightedMean == null || !weights?.length) return null;
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) return null;
  const sumSq = weights.reduce((sum, w) => sum + w * w, 0);
  const se = ROLL_STD * Math.sqrt(sumSq) / totalWeight;
  if (se <= 0) return 50;
  const z = (weightedMean - ROLL_MEAN) / se;
  return normalCdf(z) * 100;
}

/**
 * Gaussian luck percentile from raw percentile rolls on a roster (simulator links).
 * Only counts players with Hwang ADP (same as Future Scenarios v2 luck).
 */
export function computeLuckFromRolls(rosterPlayerIds, rolls, hwangAdpRankMap, pools) {
  if (!rolls || !rosterPlayerIds?.length) return null;

  let sumPct = 0;
  let countPct = 0;

  for (const pid of rosterPlayerIds) {
    const key = String(pid);
    const roll = rolls[key] ?? rolls[pid];
    if (roll == null) continue;

    const hasAdp = hwangAdpRankMap?.[key] || hwangAdpRankMap?.[pid];
    const pool = pools?.[key] || pools?.[pid];
    const hasPool = Array.isArray(pool) && pool.length > 0;
    if (!hasAdp && !hasPool) continue;

    sumPct += Number(roll);
    countPct += 1;
  }

  if (countPct === 0) return null;

  const rawTotalLuck = sumPct / countPct;
  return {
    rollCount: countPct,
    rawTotalLuck,
    totalLuckPercentile: meanRollLuckPercentile(rawTotalLuck, countPct),
  };
}

/**
 * Raw averages plus Gaussian-adjusted luck percentiles for a roster.
 */
export function computeTeamLuckMetrics(
  rosterPlayerIds,
  playerProjections,
  playersData,
  playerIdMap,
  redraftByName,
) {
  if (!playerProjections || !rosterPlayerIds?.length) return null;

  let sumPct = 0;
  let countPct = 0;
  let weightedNum = 0;
  let weightedDen = 0;
  const compWeights = [];

  for (const pid of rosterPlayerIds) {
    const proj = playerProjections[pid];
    if (!proj || proj.percentile == null) continue;

    const pct = proj.percentile;
    sumPct += pct;
    countPct += 1;

    if (redraftByName) {
      const info = getPlayerInfo(pid, playersData, playerIdMap);
      const name = info?.full_name
        || [info?.first_name, info?.last_name].filter(Boolean).join(' ');
      const entry = getRedraftValueEntryByName(name, redraftByName, {
        position: info?.position,
        team: info?.team,
      });
      const value = entry?.competitorAdjustedValue;
      if (value != null && value > 0) {
        weightedNum += pct * value;
        weightedDen += value;
        compWeights.push(value);
      }
    }
  }

  if (countPct === 0) return null;

  const rawTotalLuck = sumPct / countPct;
  const rawWeightedLuck = weightedDen > 0 ? weightedNum / weightedDen : null;

  return {
    rollCount: countPct,
    rawTotalLuck,
    rawWeightedLuck,
    totalLuckPercentile: meanRollLuckPercentile(rawTotalLuck, countPct),
    weightedLuckPercentile: rawWeightedLuck != null
      ? weightedMeanRollLuckPercentile(rawWeightedLuck, compWeights)
      : null,
  };
}

/** Luck / roll percentile color: red → orange → yellow → green. */
const LUCK_COLOR_STOPS = [
  { at: 0, h: 0, s: 100, l: 50 },     // red
  { at: 25, h: 30, s: 100, l: 50 },   // orange
  { at: 50, h: 52, s: 100, l: 50 },   // yellow
  { at: 75, h: 88, s: 90, l: 42 },    // yellow-green
  { at: 100, h: 120, s: 100, l: 45 }, // bright green
];

export function percentileColor(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  let i = 0;
  while (i < LUCK_COLOR_STOPS.length - 1 && p > LUCK_COLOR_STOPS[i + 1].at) i += 1;
  const lo = LUCK_COLOR_STOPS[i];
  const hi = LUCK_COLOR_STOPS[Math.min(i + 1, LUCK_COLOR_STOPS.length - 1)];
  const span = hi.at - lo.at || 1;
  const t = (p - lo.at) / span;
  const h = lo.h + (hi.h - lo.h) * t;
  const s = lo.s + (hi.s - lo.s) * t;
  const l = lo.l + (hi.l - lo.l) * t;
  return `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}
