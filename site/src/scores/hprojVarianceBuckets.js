/**
 * HProj weekly residual buckets + outcome quantiles.
 *
 * Static table: ./hprojVarianceBuckets.json
 * Outcome at percentile p = projection + residual_p for that position band.
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
  const p = raw > 0 && raw <= 1 ? raw * 100 : raw;
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
 * Outcome at a percentile for a projected player-week.
 * `percentile` is 0–1 or 0–100 (0.8 and 80 both mean P80).
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
  const offset = residualQuantile(band.resid, percentile);
  if (offset == null) return null;
  return round1(x + offset);
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
export function sampleHprojResidual(resid, u) {
  if (!resid) return null;
  const x = Number(u);
  if (!Number.isFinite(x)) return null;
  const knots = RESID_KEYS.map(([p, key]) => [p / 100, resid[key]]);
  if (x <= knots[0][0]) {
    const [p0, v0] = knots[0];
    const [p1, v1] = knots[1];
    return v0 + ((v1 - v0) / (p1 - p0)) * (x - p0);
  }
  const last = knots[knots.length - 1];
  if (x >= last[0]) {
    const [p0, v0] = knots[knots.length - 2];
    const [p1, v1] = last;
    return v1 + ((v1 - v0) / (p1 - p0)) * (x - p1);
  }
  for (let i = 1; i < knots.length; i += 1) {
    if (x <= knots[i][0]) {
      const [p0, v0] = knots[i - 1];
      const [p1, v1] = knots[i];
      return v0 + ((v1 - v0) / (p1 - p0)) * (x - p0);
    }
  }
  return last[1];
}

export function hprojRange(position, projection) {
  const band = lookupHprojVariance(position, projection);
  const x = Number(projection);
  if (!band?.resid || !Number.isFinite(x)) return null;
  return {
    band,
    p10: round1(x + band.resid.p10),
    p20: round1(x + band.resid.p20),
    p50: round1(x + band.resid.p50),
    p80: round1(x + band.resid.p80),
    p90: round1(x + band.resid.p90),
    p95: round1(x + band.resid.p95),
  };
}
