/**
 * HProj weekly residual buckets + outcome quantiles.
 *
 * Static table: ./hprojVarianceBuckets.json — games-played residuals
 * (week − season PPG). The mid (P25–P80) stays on that table so averages
 * hold. Tails are reshaped: injury/DNP zeros on the floor, fatter boom
 * games at P90–P99. The raw table never sees inactive weeks, so a "clean"
 * residual CDF never ducks to 0 and clips real ceilings.
 */

import table from './hprojVarianceBuckets.json';

/** @typedef {{ p10: number, p20: number, p25: number, p50: number, p75: number, p80: number, p90: number, p95: number }} HprojResid */

/** @typedef {{
 *   lo: number,
 *   hi: number|null,
 *   label: string,
 *   std: number,
 *   skew: number,
 *   resid: HprojResid,
 * }} HprojVarianceBand */

export const HPROJ_VARIANCE_META = table.meta;

/** @type {Record<string, HprojVarianceBand[]>} */
export const HPROJ_VARIANCE_BUCKETS = table.positions;

const RESID_KEYS = [
  [10, 'p10'], [20, 'p20'], [25, 'p25'], [50, 'p50'],
  [75, 'p75'], [80, 'p80'], [90, 'p90'], [95, 'p95'],
];

/** Percentile through which outcome is 0 (injury / sit / leave early). */
const ZERO_THROUGH = { QB: 7, RB: 12, WR: 11, TE: 10 };

/** P99 outcome ≈ projection × this. Real boom weeks, not residual P95. */
const P99_MULT = { QB: 2.2, RB: 2.55, WR: 2.65, TE: 2.45 };

function interpolateKnots(knots, t) {
  if (!knots || !knots.length) return null;
  const x = Number(t);
  if (!Number.isFinite(x)) return null;
  if (x <= knots[0][0]) return knots[0][1];
  const last = knots[knots.length - 1];
  if (x >= last[0]) {
    if (knots.length < 2) return last[1];
    const [p0, v0] = knots[knots.length - 2];
    const [p1, v1] = last;
    const den = p1 - p0 || 1;
    return v1 + ((v1 - v0) / den) * (x - p1);
  }
  for (let i = 1; i < knots.length; i += 1) {
    if (x <= knots[i][0]) {
      const [p0, v0] = knots[i - 1];
      const [p1, v1] = knots[i];
      const den = p1 - p0 || 1;
      return v0 + ((v1 - v0) / den) * (x - p0);
    }
  }
  return last[1];
}

/**
 * Games-played residuals, with a zero floor and a stretched ceiling.
 * Knots are [0–1, residual]. Outcome = max(0, projection + residual).
 */
export function residualKnots(resid, position, projection) {
  const x = Number(projection);
  if (!resid || !Number.isFinite(x)) return null;
  const pos = ZERO_THROUGH[position] != null ? position : 'WR';
  const floor = -Math.max(0, x);
  const zeroP = ZERO_THROUGH[pos] / 100;
  const p99Resid = Math.max(
    x * ((P99_MULT[pos] || 2.5) - 1),
    (Number(resid.p95) || 0) * 1.65,
  );
  const p90 = Number(resid.p90);
  const p95 = Number(resid.p95);
  const raw = [
    [0, floor],
    [zeroP, floor],
    [0.25, resid.p25],
    [0.50, resid.p50],
    [0.75, resid.p75],
    [0.80, resid.p80],
    [0.90, p90 + 0.28 * (p99Resid - p90)],
    [0.95, p95 + 0.55 * (p99Resid - p95)],
    [0.99, p99Resid],
  ];
  let prev = floor;
  return raw.map(([p, v]) => {
    let y = Number(v);
    if (!Number.isFinite(y)) y = prev;
    y = Math.max(y, floor, prev);
    prev = y;
    return [p, y];
  });
}

/**
 * Residual band for a weekly projection. Negative / missing proj uses the
 * lowest band. Elite projections above the last cut use the open top band.
 *
 * @param {string} position
 * @param {number} projection
 * @returns {HprojVarianceBand|null}
 */
export function lookupHprojVariance(position, projection) {
  const bands = HPROJ_VARIANCE_BUCKETS[position];
  if (!bands || !bands.length) return null;
  const x = Number(projection);
  if (!Number.isFinite(x)) return bands[0];
  let chosen = bands[0];
  for (const band of bands) {
    if (x >= band.lo) chosen = band;
    else break;
  }
  return chosen;
}

/**
 * Interpolate a residual offset. `percentile` is 0–1 or 0–100.
 *
 * @param {HprojResid} resid
 * @param {number} percentile
 * @returns {number|null}
 */
export function residualQuantile(resid, percentile) {
  if (!resid) return null;
  const raw = Number(percentile);
  if (!Number.isFinite(raw)) return null;
  // Fractions are (0, 1). Integer 1 is P1, not 100% — sliders use 0–99.
  const p = raw > 0 && raw < 1 ? raw * 100 : raw;
  if (p <= RESID_KEYS[0][0]) return resid[RESID_KEYS[0][1]];
  const last = RESID_KEYS[RESID_KEYS.length - 1];
  if (p >= last[0]) return resid[last[1]];
  for (let i = 1; i < RESID_KEYS.length; i += 1) {
    const [pHi, kHi] = RESID_KEYS[i];
    const [pLo, kLo] = RESID_KEYS[i - 1];
    if (p <= pHi) {
      const t = (p - pLo) / (pHi - pLo);
      return resid[kLo] + t * (resid[kHi] - resid[kLo]);
    }
  }
  return resid[last[1]];
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Percentile (0–99) of an actual score vs the projection residual band.
 * Used to label completed games as FINAL - Pxx on /hproj.
 */
export function hprojPercentile(position, projection, actual) {
  const x = Number(projection);
  const y = Number(actual);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const loPts = hprojQuantile(position, x, 0);
  const hiPts = hprojQuantile(position, x, 99);
  if (loPts == null || hiPts == null) return null;
  if (y <= loPts) return 0;
  if (y >= hiPts) return 99;
  let lo = 0;
  let hi = 99;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    const q = hprojQuantile(position, x, mid);
    if (q == null) return null;
    if (q < y) lo = mid;
    else hi = mid;
  }
  return Math.max(0, Math.min(99, Math.round((lo + hi) / 2)));
}

/**
 * Outcome at a percentile for a projected player-week.
 * `percentile` is 0–100, or a fraction in (0, 1). 0.8 and 80 both mean P80;
 * 1 means P1 (slider tick), not 100%. Use 99/100 or 0.99 for the ceiling.
 *
 * @param {string} position
 * @param {number} projection
 * @param {number} percentile
 * @returns {number|null}
 */
export function hprojQuantile(position, projection, percentile) {
  const band = lookupHprojVariance(position, projection);
  const x = Number(projection);
  if (!band?.resid || !Number.isFinite(x)) return null;
  const raw = Number(percentile);
  if (!Number.isFinite(raw)) return null;
  const t = raw > 0 && raw < 1 ? raw : raw / 100;
  const knots = residualKnots(band.resid, position, x);
  const offset = interpolateKnots(knots, t);
  if (offset == null) return null;
  return round1(Math.max(0, x + offset));
}

/**
 * Common outcome range for a projected player-week.
 *
 * @param {string} position
 * @param {number} projection
 * @returns {{ band: HprojVarianceBand, p10: number, p20: number, p50: number, p80: number, p90: number, p95: number }|null}
 */
/**
 * Draw one residual from the piecewise-linear inverse CDF of `resid`.
 * `u` is Uniform(0, 1). Tails outside P10–P95 extrapolate the end segments.
 *
 * @param {HprojResid} resid
 * @param {number} u
 * @returns {number|null}
 */
export function sampleHprojResidual(resid, u, position, projection) {
  if (!resid) return null;
  const t = Number(u);
  if (!Number.isFinite(t)) return null;
  const x = Number(projection);
  const knots = Number.isFinite(x)
    ? residualKnots(resid, position, x)
    : RESID_KEYS.map(([p, key]) => [p / 100, resid[key]]);
  const offset = interpolateKnots(knots, t);
  if (offset == null) return null;
  if (Number.isFinite(x)) return Math.max(-x, offset);
  return offset;
}

export function hprojRange(position, projection) {
  const band = lookupHprojVariance(position, projection);
  const x = Number(projection);
  if (!band?.resid || !Number.isFinite(x)) return null;
  return {
    band,
    p0: hprojQuantile(position, x, 0),
    p10: hprojQuantile(position, x, 10),
    p20: hprojQuantile(position, x, 20),
    p50: hprojQuantile(position, x, 50),
    p80: hprojQuantile(position, x, 80),
    p90: hprojQuantile(position, x, 90),
    p95: hprojQuantile(position, x, 95),
    p99: hprojQuantile(position, x, 99),
  };
}
