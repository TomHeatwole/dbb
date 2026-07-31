/**
 * Single source of truth for Hwang positional value multipliers.
 *
 * Edit the numbers here to retune:
 *   - Hwang Market / Hwang True rankings (KTC × coeffs)
 *   - Hwang Adjusted Competitor / Rebuild rankings (Competitor|Rebuild × coeffs)
 *
 * HWANG_COMPOSITE_COEFFICIENT_KEY picks which set is applied on top of
 * Competitor / Rebuild bases. Change that key (or the numbers) in this file only.
 */

export const HWANG_POSITION_COEFFICIENTS = {
  market: {
    QB: 1.0,
    RB: 1.12,
    WR: 0.96,
    TE: 1.0,
  },
  true: {
    QB: 1.0,
    RB: 1.2,
    WR: 0.9,
    TE: 1.1,
  },
};

export const HWANG_COEFFICIENT_LABELS = {
  market: 'Hwang Market Value Adjusted KTC',
  true: 'Hwang True Value Adjusted KTC',
};

/** Which coefficient set powers Hwang-Adjusted Competitor / Rebuild rankings. */
export const HWANG_COMPOSITE_COEFFICIENT_KEY = 'true';

export function getHwangCoefficientMap(adjustmentKey) {
  const coeffs = HWANG_POSITION_COEFFICIENTS[adjustmentKey];
  if (!coeffs) return null;
  return new Map(
    Object.entries(coeffs).map(([pos, multiplier]) => [pos.toUpperCase(), multiplier]),
  );
}
