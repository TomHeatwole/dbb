/**
 * Single source of truth for Hwang positional value multipliers.
 *
 * Edit the numbers here to retune:
 *   - Hwang Market / Hwang True rankings (KTC × coeffs)
 *   - Hwang Adjusted Competitor / Rebuild rankings (Competitor|Rebuild × coeffs)
 *
 * A coefficient is either:
 *   - a flat number (value × m), or
 *   - a power-law curve { c, k } meaning m(v) = c · (v/5000)^k.
 *
 * Skill positions (RB / WR / TE) are the Hwang ÷ Underdog format factor:
 *   numerator   Hwang clubs + Hwang scoring          (v3b, format=hwang)
 *   denominator Underdog BBM clubs + UD lineup/PPR
 *               + TE premium 0.5                     (bbm_50_tep)
 * RB/WR are fit from the RB-vs-WR pair curve only (geo-mean 1 between
 * them). TE is then fit against that gauge so no-TEP Underdog cannot
 * manufacture a TE bump. QB has no valid 1QB Underdog denominator;
 * it is the Hwang True Simulator curve on Final KTC (v3b `true.QB`).
 *
 * `true` uses the KTC-basis format-factor fit (apply to KTC values).
 * `trueComp` uses the competitor-basis format-factor fit (apply to
 * Competitor/Rebuild bases). QB is the same KTC-basis Hwang curve on
 * both. Regenerate skill coeffs with:
 *   python scripts/fit_hwang_format_factor_coeffs.py
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
  // Format factor on KTC basis (Hwang ÷ Underdog+TEP), plus Hwang-from-KTC QB.
  // `flat` is the value-independent mental-math version of the same split.
  true: {
    QB: { c: 0.932, k: -0.175, flat: 0.97 },
    RB: { c: 1.112, k: -0.029, flat: 1.11 },
    WR: { c: 0.899, k: 0.029, flat: 0.90 },
    TE: { c: 0.976, k: 0.069, flat: 0.95 },
  },
  // Same recipe on the competitor-adjusted board. Skill curves are nearly
  // flat; QB is still the KTC-basis Hwang measurement (no SF best-ball
  // baseline exists to make a QB format factor).
  trueComp: {
    QB: { c: 0.932, k: -0.175, flat: 0.97 },
    RB: { c: 1.112, k: -0.011, flat: 1.12 },
    WR: { c: 0.899, k: 0.011, flat: 0.90 },
    TE: { c: 0.974, k: 0.050, flat: 0.96 },
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
