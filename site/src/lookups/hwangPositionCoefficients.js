/**
 * Single source of truth for Hwang positional value multipliers.
 *
 * Edit the numbers here to retune:
 *   - Hwang Market / Hwang True rankings (KTC × coeffs)
 *   - Hwang Adjusted Competitor / Rebuild rankings (Competitor|Rebuild × coeffs)
 *
 * A coefficient is either:
 *   - a flat number (value × m), or
 *   - a power-law curve { c, k } meaning m(v) = c · (v/5000)^k — the fitted
 *     output of the Hwang True Simulator (mean-grounded: 1.0 = the average
 *     same-priced player; value- and points-weighted least squares over
 *     2021–2025, 200 builds × 19 archetypes).
 *
 * `true` is fitted against Final KTC prices (apply to KTC values).
 * `trueComp` is fitted against competitor-adjusted prices (apply to
 * Competitor/Rebuild bases) — that's what HWANG_COMPOSITE_COEFFICIENT_KEY
 * selects.
 *
 * HWANG_COMPOSITE_COEFFICIENT_KEY picks which set is applied on top of
 * Competitor / Rebuild bases. Change that key (or the numbers) in this file only.
 */

export const HWANG_MULTIPLIER_VREF = 5000;

export const HWANG_POSITION_COEFFICIENTS = {
  market: {
    QB: 1.0,
    RB: 1.12,
    WR: 0.96,
    TE: 1.0,
  },
  // Hwang True Simulator v3b fit, Final KTC basis (Hwang format).
  // `flat` is the baseline (value-independent) multiplier from the same fit,
  // shown alongside the formula as a mental-math approximation.
  true: {
    QB: { c: 0.932, k: -0.175, flat: 0.97 },
    RB: { c: 1.263, k: 0.345, flat: 1.30 },
    WR: { c: 0.866, k: -0.030, flat: 0.85 },
    TE: { c: 0.981, k: -0.140, flat: 0.94 },
  },
  // Hwang True Simulator v3b fit, competitor-adjusted basis (Hwang format).
  trueComp: {
    QB: { c: 0.900, k: 0.173, flat: 0.94 },
    RB: { c: 1.343, k: 0.121, flat: 1.37 },
    WR: { c: 0.871, k: -0.235, flat: 0.87 },
    TE: { c: 0.950, k: -0.059, flat: 0.90 },
  },
};

export const HWANG_COEFFICIENT_LABELS = {
  market: 'Hwang Market Value Adjusted KTC',
  true: 'Hwang True Value Adjusted KTC',
  trueComp: 'Hwang True Value Adjusted Competitor',
};

/** Which coefficient set powers Hwang-Adjusted Competitor / Rebuild rankings. */
export const HWANG_COMPOSITE_COEFFICIENT_KEY = 'trueComp';

/**
 * Effective multiplier for a coefficient entry at a given base value.
 * Flat numbers ignore the value; curves evaluate m(v) = c · (v/5000)^k.
 * Values are clamped at 100 so tail darts don't explode the curve.
 */
export function hwangMultiplierAt(entry, value) {
  if (entry == null) return 1;
  if (typeof entry === 'number') return entry;
  const v = Math.max(Number(value) || 0, 100);
  return entry.c * ((v / HWANG_MULTIPLIER_VREF) ** entry.k);
}

/** Human-readable form of a single coefficient entry. */
export function formatHwangCoefficient(entry) {
  if (entry == null) return '1';
  if (typeof entry === 'number') return String(entry);
  const k = entry.k >= 0 ? `+${entry.k}` : String(entry.k);
  const flat = entry.flat != null ? ` (≈${entry.flat} flat)` : '';
  return `${entry.c}·(v/5k)^${k}${flat}`;
}

export function getHwangCoefficientMap(adjustmentKey) {
  const coeffs = HWANG_POSITION_COEFFICIENTS[adjustmentKey];
  if (!coeffs) return null;
  return new Map(
    Object.entries(coeffs).map(([pos, multiplier]) => [pos.toUpperCase(), multiplier]),
  );
}
