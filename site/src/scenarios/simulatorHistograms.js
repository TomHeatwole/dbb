/**
 * simulatorHistograms.js
 *
 * Lightweight histogram accumulators for Monte Carlo team scores and finishes.
 */

export const SCORE_BIN_WIDTH = {
  reg: 50,
  playoff: 20,
  total: 50,
};

export const SCORE_BIN_ORIGIN = {
  reg: 1200,
  playoff: 0,
  total: 1200,
};

export const SCORE_BIN_COUNT = {
  reg: 80,
  playoff: 60,
  total: 90,
};

const DISPLAY_BUCKETS = 20;

function scoreBinIndex(value, origin, width, count) {
  return Math.min(count - 1, Math.max(0, Math.floor((value - origin) / width)));
}

function createScoreHistogram(metric) {
  return {
    origin: SCORE_BIN_ORIGIN[metric],
    width: SCORE_BIN_WIDTH[metric],
    bins: new Uint32Array(SCORE_BIN_COUNT[metric]),
  };
}

/** Per-team score histogram buffers (reg / playoff / total). */
export function createTeamScoreHistograms(rosterIds) {
  const histograms = {};
  for (const rid of rosterIds) {
    histograms[rid] = {
      reg: createScoreHistogram('reg'),
      playoff: createScoreHistogram('playoff'),
      total: createScoreHistogram('total'),
    };
  }
  return histograms;
}

function incrementScoreBin(hist, value) {
  const idx = scoreBinIndex(value, hist.origin, hist.width, hist.bins.length);
  hist.bins[idx] += 1;
}

/** Record starter totals for each team in one iteration. */
export function accumulateTeamScoreHistograms(histograms, regTotals, ploffTotals, rosterIds) {
  for (const rid of rosterIds) {
    const team = histograms[rid];
    if (!team) continue;

    const reg = regTotals[rid] || 0;
    const playoff = ploffTotals[rid] || 0;
    incrementScoreBin(team.reg, reg);
    incrementScoreBin(team.playoff, playoff);
    incrementScoreBin(team.total, reg + playoff);
  }
}

export function serializeTeamScoreHistograms(histograms) {
  const out = {};
  for (const [rid, team] of Object.entries(histograms || {})) {
    out[rid] = {
      reg: {
        origin: team.reg.origin,
        width: team.reg.width,
        bins: Array.from(team.reg.bins),
      },
      playoff: {
        origin: team.playoff.origin,
        width: team.playoff.width,
        bins: Array.from(team.playoff.bins),
      },
      total: {
        origin: team.total.origin,
        width: team.total.width,
        bins: Array.from(team.total.bins),
      },
    };
  }
  return out;
}

/**
 * Merge fixed-width bins into ~20 display bars for a score histogram.
 */
export function buildScoreHistogramChartData(hist, iterations, targetBuckets = DISPLAY_BUCKETS) {
  if (!hist?.bins?.length) return [];

  const { origin, width, bins } = hist;
  let first = -1;
  let last = -1;
  for (let i = 0; i < bins.length; i++) {
    if (bins[i] > 0) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return [];

  const span = last - first + 1;
  const mergeSize = Math.max(1, Math.ceil(span / targetBuckets));
  const data = [];

  for (let start = first; start <= last; start += mergeSize) {
    const end = Math.min(last, start + mergeSize - 1);
    let count = 0;
    for (let i = start; i <= end; i++) count += bins[i];

    const lo = origin + start * width;
    const hi = origin + (end + 1) * width;
    data.push({
      label: `${lo.toFixed(0)}–${hi.toFixed(0)}`,
      lo,
      hi,
      count,
      pct: iterations > 0 ? (count / iterations) * 100 : 0,
    });
  }

  return data;
}

/** Team league finish (1st–10th) bar chart rows. */
export function buildTeamFinishChartData(buckets, iterations) {
  if (!buckets?.length) return [];
  const ordinals = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

  return buckets.map((bucket, i) => ({
    label: ordinals[i] || `${i + 1}th`,
    place: i + 1,
    count: bucket.count,
    pct: iterations > 0 ? (bucket.count / iterations) * 100 : 0,
    isPlayoff: i < 4,
  }));
}
