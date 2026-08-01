/**
 * KTC-style trade Value Adjustment (reverse-engineered ~2022 client formula).
 *
 * Hidden raw scores judge which side wins ("quarters ≠ a dollar").
 * The displayed "Value Adjustment" is derived afterward by finding a
 * hypothetical player whose raw score closes the gap, then comparing
 * ordinary totals after adding that player to the losing side.
 *
 * Treat as candidate current formula — coefficients live here so we can
 * version / recalibrate later without touching the calculator UI.
 *
 * @see https://www.javelinfantasyfootball.com/2022/09/30/how-the-ktc-adjustment/
 */

export const KTC_VALUE_ADJUSTMENT_VERSION = '2022-reverse-engineered';

/** Historical KTC top-of-board value used as `v` in the raw-score formula. */
export const KTC_HIGHEST_VALUE_OVERALL = 9999;

/**
 * Nonlinear hidden score for a single asset in a trade.
 *
 * @param {number} playerValue ordinary ranking value (p)
 * @param {number} highestValueInTrade max ordinary value in the trade (t)
 * @param {number} [highestValueOverall=9999] global board ceiling (v)
 */
export function rawTradeValue(
  playerValue,
  highestValueInTrade,
  highestValueOverall = KTC_HIGHEST_VALUE_OVERALL,
) {
  const p = Number(playerValue);
  const t = Number(highestValueInTrade);
  const v = Number(highestValueOverall);

  if (!(p > 0) || !(t > 0) || !(v > 0)) return 0;

  return (
    p * (
      0.10
      + 0.04 * (p / v) ** 8
      + 0.11 * (p / t) ** 1.3
      + 0.22 * (p / (v + 2000)) ** 1.28
    )
  );
}

/**
 * Binary-search ordinary player value whose raw score ≈ targetRaw.
 * If the hypothetical asset exceeds the current trade max, it becomes the new `t`.
 */
export function findPlayerValueForRawGap(
  targetRaw,
  currentHighestInTrade,
  highestValueOverall = KTC_HIGHEST_VALUE_OVERALL,
) {
  if (!(targetRaw > 0)) return 0;

  let low = 0;
  let high = highestValueOverall;

  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    const hypotheticalTradeMax = Math.max(currentHighestInTrade, mid);
    const raw = rawTradeValue(mid, hypotheticalTradeMax, highestValueOverall);
    if (raw < targetRaw) low = mid;
    else high = mid;
  }

  return Math.round((low + high) / 2);
}

/**
 * Evaluate a two-sided trade with KTC-style raw scoring + displayed adjustment.
 *
 * @param {number[]} teamA ordinary values Team A receives
 * @param {number[]} teamB ordinary values Team B receives
 * @param {number} [highestValueOverall]
 */
export function evaluateKtcStyleTrade(
  teamA,
  teamB,
  highestValueOverall = KTC_HIGHEST_VALUE_OVERALL,
) {
  const valuesA = (teamA || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const valuesB = (teamB || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const allValues = [...valuesA, ...valuesB];

  const empty = {
    version: KTC_VALUE_ADJUSTMENT_VERSION,
    ordinaryA: 0,
    ordinaryB: 0,
    rawA: 0,
    rawB: 0,
    tradeMax: 0,
    playerToEven: 0,
    adjustmentForA: 0,
    adjustmentForB: 0,
    adjustedTotalA: 0,
    adjustedTotalB: 0,
    rawWinner: null, // 'A' | 'B' | null
    isEven: true,
  };

  if (allValues.length === 0) return empty;

  const tradeMax = Math.max(...allValues);
  const ordinaryA = valuesA.reduce((sum, v) => sum + v, 0);
  const ordinaryB = valuesB.reduce((sum, v) => sum + v, 0);

  const rawA = valuesA.reduce(
    (sum, value) => sum + rawTradeValue(value, tradeMax, highestValueOverall),
    0,
  );
  const rawB = valuesB.reduce(
    (sum, value) => sum + rawTradeValue(value, tradeMax, highestValueOverall),
    0,
  );

  if (Math.abs(rawA - rawB) < 0.5) {
    return {
      ...empty,
      ordinaryA,
      ordinaryB,
      rawA,
      rawB,
      tradeMax,
      adjustedTotalA: ordinaryA,
      adjustedTotalB: ordinaryB,
      isEven: true,
      rawWinner: null,
    };
  }

  const aIsRawWinner = rawA > rawB;
  const rawGap = Math.abs(rawA - rawB);
  const playerToEven = findPlayerValueForRawGap(
    rawGap,
    tradeMax,
    highestValueOverall,
  );

  const hypotheticalA = ordinaryA + (aIsRawWinner ? 0 : playerToEven);
  const hypotheticalB = ordinaryB + (aIsRawWinner ? playerToEven : 0);
  const displayedAdjustment = Math.abs(hypotheticalA - hypotheticalB);

  // Presentation: add adjustment onto the side with the lower ordinary total
  // (matching the reverse-engineered display convention).
  const adjustmentForA = ordinaryA < ordinaryB ? displayedAdjustment : 0;
  const adjustmentForB = ordinaryB < ordinaryA ? displayedAdjustment : 0;

  return {
    version: KTC_VALUE_ADJUSTMENT_VERSION,
    ordinaryA,
    ordinaryB,
    rawA,
    rawB,
    tradeMax,
    playerToEven,
    adjustmentForA,
    adjustmentForB,
    adjustedTotalA: ordinaryA + adjustmentForA,
    adjustedTotalB: ordinaryB + adjustmentForB,
    rawWinner: aIsRawWinner ? 'A' : 'B',
    isEven: false,
  };
}
