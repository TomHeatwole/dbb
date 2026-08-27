/**
 * simulatorHistograms.js
 *
 * Lightweight histogram accumulators for Monte Carlo team scores and finishes.
 */

/** All score metrics use the same bucket width (points). */
export const SCORE_BUCKET_WIDTH = 25;

export const SCORE_BIN_ORIGIN = {
  reg: 0,
  playoff: 0,
  total: 0,
};

export const SCORE_BIN_COUNT = {
  reg: 200,    // 0–5000
  playoff: 48, // 0–1200
  total: 220,  // 0–5500
};

function scoreBinIndex(value, origin, width, count) {
  return Math.min(count - 1, Math.max(0, Math.floor((value - origin) / width)));
}

function createScoreHistogram(metric) {
  return {
    origin: SCORE_BIN_ORIGIN[metric],
    width: SCORE_BUCKET_WIDTH,
    bins: new Uint32Array(SCORE_BIN_COUNT[metric]),
    sum: 0,
    sumSq: 0,
    count: 0,
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

function recordScoreValue(hist, value) {
  incrementScoreBin(hist, value);
  hist.sum += value;
  hist.sumSq += value * value;
  hist.count += 1;
}

/** Record starter totals for each team in one iteration. */
export function accumulateTeamScoreHistograms(histograms, regTotals, ploffTotals, rosterIds) {
  for (const rid of rosterIds) {
    const team = histograms[rid] ?? histograms[String(rid)];
    if (!team) continue;

    const reg = Number(regTotals[rid] ?? regTotals[String(rid)]) || 0;
    const playoff = Number(ploffTotals[rid] ?? ploffTotals[String(rid)]) || 0;
    recordScoreValue(team.reg, reg);
    recordScoreValue(team.playoff, playoff);
    recordScoreValue(team.total, reg + playoff);
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
        sum: team.reg.sum,
        sumSq: team.reg.sumSq,
        count: team.reg.count,
      },
      playoff: {
        origin: team.playoff.origin,
        width: team.playoff.width,
        bins: Array.from(team.playoff.bins),
        sum: team.playoff.sum,
        sumSq: team.playoff.sumSq,
        count: team.playoff.count,
      },
      total: {
        origin: team.total.origin,
        width: team.total.width,
        bins: Array.from(team.total.bins),
        sum: team.total.sum,
        sumSq: team.total.sumSq,
        count: team.total.count,
      },
    };
  }
  return out;
}

/**
 * Build chart rows for 25-pt score bins (includes empty bins in range for a continuous shape).
 */
export function buildScoreHistogramChartData(hist, iterations) {
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

  const data = [];
  for (let i = first; i <= last; i++) {
    const lo = origin + i * width;
    const hi = lo + width;
    const mid = lo + width / 2;
    data.push({
      label: `${Math.round(mid)}`,
      mid,
      lo,
      hi,
      count: bins[i],
      pct: iterations > 0 ? (bins[i] / iterations) * 100 : 0,
    });
  }

  return data;
}

function histogramTotal(hist) {
  if (hist?.count > 0) return hist.count;
  return (hist?.bins || []).reduce((s, c) => s + c, 0);
}

function percentileFromHist(hist, p) {
  const { origin, width, bins } = hist;
  const total = histogramTotal(hist);
  if (total <= 0) return null;

  const target = total * p;
  let cumulative = 0;

  for (let i = 0; i < bins.length; i++) {
    const count = bins[i];
    if (count === 0) continue;

    const lo = origin + i * width;
    if (cumulative + count >= target) {
      const frac = (target - cumulative) / count;
      return lo + frac * width;
    }
    cumulative += count;
  }

  const lastIdx = bins.length - 1;
  return origin + lastIdx * width + width / 2;
}

/** Median, P25, P75, and standard deviation for a score histogram. */
export function computeScoreHistogramStats(hist) {
  if (!hist?.bins?.length) return null;

  const total = histogramTotal(hist);
  if (total <= 0) return null;

  const { origin, width, bins } = hist;
  let stdDev = null;

  // Prefer exact std dev when running sums were tracked during simulation.
  if (
    typeof hist.sum === 'number'
    && typeof hist.sumSq === 'number'
    && hist.count > 0
    && Number.isFinite(hist.sum)
    && Number.isFinite(hist.sumSq)
  ) {
    const mean = hist.sum / hist.count;
    const variance = Math.max(0, hist.sumSq / hist.count - mean * mean);
    stdDev = Math.sqrt(variance);
  } else {
    // Fallback: estimate from bin midpoints (always available from bins alone).
    let sumMid = 0;
    let sumSqMid = 0;
    for (let i = 0; i < bins.length; i++) {
      const count = bins[i];
      if (count === 0) continue;
      const mid = origin + (i + 0.5) * width;
      sumMid += mid * count;
      sumSqMid += mid * mid * count;
    }
    const meanMid = sumMid / total;
    const varianceMid = Math.max(0, sumSqMid / total - meanMid * meanMid);
    stdDev = Math.sqrt(varianceMid);
  }

  const median = percentileFromHist(hist, 0.5);
  const p25 = percentileFromHist(hist, 0.25);
  const p75 = percentileFromHist(hist, 0.75);

  if (
    median == null
    || p25 == null
    || p75 == null
    || stdDev == null
    || !Number.isFinite(stdDev)
  ) {
    return null;
  }

  return { median, p25, p75, stdDev };
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

/** Slot score histogram bucket config (per lineup position). */
export const SLOT_SCORE_BUCKET_WIDTH = 10;

export const SLOT_SCORE_BIN_ORIGIN = {
  reg: 0,
  playoff: 0,
  total: 0,
};

export const SLOT_SCORE_BIN_COUNT = {
  reg: 53,     // 0–530
  playoff: 40, // 0–400
  total: 63,   // 0–630
};

function createSlotScoreHistogram(metric) {
  return {
    origin: SLOT_SCORE_BIN_ORIGIN[metric],
    width: SLOT_SCORE_BUCKET_WIDTH,
    bins: new Uint32Array(SLOT_SCORE_BIN_COUNT[metric]),
    sum: 0,
    sumSq: 0,
    count: 0,
  };
}

function createRankHistogram() {
  return {
    bins: new Uint32Array(10),
    sum: 0,
    count: 0,
  };
}

function createSlotRangeHistograms() {
  return {
    reg: { score: createSlotScoreHistogram('reg'), rank: createRankHistogram() },
    playoff: { score: createSlotScoreHistogram('playoff'), rank: createRankHistogram() },
    total: { score: createSlotScoreHistogram('total'), rank: createRankHistogram() },
  };
}

/** Per-team, per-lineup-slot score + league-rank histograms. */
export function createTeamSlotHistograms(rosterIds, slotNames) {
  const histograms = {};
  const names = slotNames || [];
  for (const rid of rosterIds) {
    histograms[rid] = {
      slots: names.map((pos, idx) => ({
        pos,
        idx,
        ...createSlotRangeHistograms(),
      })),
    };
  }
  return histograms;
}

function recordRankValue(hist, place) {
  const idx = place - 1;
  if (idx < 0 || idx >= hist.bins.length) return;
  hist.bins[idx] += 1;
  hist.sum += place;
  hist.count += 1;
}

const SLOT_RANGES = ['reg', 'playoff', 'total'];

function slotTotalForRange(slotReg, slotPloff, si, range) {
  const reg = slotReg?.[si] ?? 0;
  const ploff = slotPloff?.[si] ?? 0;
  if (range === 'reg') return reg;
  if (range === 'playoff') return ploff;
  return reg + ploff;
}

/** Record per-slot score and league rank for one simulation iteration. */
export function accumulateTeamSlotHistograms(histograms, slotReg, slotPloff, rosterIds) {
  const firstTeam = histograms[rosterIds[0]] ?? histograms[String(rosterIds[0])];
  const numSlots = firstTeam?.slots?.length ?? 0;
  if (numSlots === 0) return;

  for (const range of SLOT_RANGES) {
    for (let si = 0; si < numSlots; si++) {
      const teamTotals = rosterIds.map((rid) => {
        const regSlots = slotReg[rid] ?? slotReg[String(rid)];
        const ploffSlots = slotPloff[rid] ?? slotPloff[String(rid)];
        const total = slotTotalForRange(regSlots, ploffSlots, si, range);
        return { rid, total };
      });

      teamTotals.sort((a, b) => b.total - a.total);

      teamTotals.forEach((entry, rankIdx) => {
        const team = histograms[entry.rid] ?? histograms[String(entry.rid)];
        const slot = team?.slots?.[si];
        if (!slot) return;
        recordScoreValue(slot[range].score, entry.total);
        recordRankValue(slot[range].rank, rankIdx + 1);
      });
    }
  }
}

export function serializeTeamSlotHistograms(histograms) {
  const out = {};
  for (const [rid, team] of Object.entries(histograms || {})) {
    out[rid] = {
      slots: (team.slots || []).map((slot) => ({
        pos: slot.pos,
        idx: slot.idx,
        reg: {
          score: serializeScoreHist(slot.reg.score),
          rank: serializeRankHist(slot.reg.rank),
        },
        playoff: {
          score: serializeScoreHist(slot.playoff.score),
          rank: serializeRankHist(slot.playoff.rank),
        },
        total: {
          score: serializeScoreHist(slot.total.score),
          rank: serializeRankHist(slot.total.rank),
        },
      })),
    };
  }
  return out;
}

function serializeScoreHist(hist) {
  return {
    origin: hist.origin,
    width: hist.width,
    bins: Array.from(hist.bins),
    sum: hist.sum,
    sumSq: hist.sumSq,
    count: hist.count,
  };
}

function serializeRankHist(hist) {
  return {
    bins: Array.from(hist.bins),
    sum: hist.sum,
    count: hist.count,
  };
}

function rankHistogramTotal(hist) {
  if (hist?.count > 0) return hist.count;
  return (hist?.bins || []).reduce((s, c) => s + c, 0);
}

/** Average slot score from histogram running sums. */
export function computeSlotScoreAverage(hist) {
  if (!hist || hist.count <= 0) return null;
  return hist.sum / hist.count;
}

/** Average league rank at a slot (e.g. 6.3 among 10 teams). */
export function computeSlotRankAverage(hist) {
  const total = rankHistogramTotal(hist);
  if (!hist || total <= 0) return null;
  if (hist.sum > 0 && hist.count > 0) return hist.sum / hist.count;
  let sum = 0;
  for (let i = 0; i < hist.bins.length; i++) sum += (i + 1) * hist.bins[i];
  return sum / total;
}

/**
 * Rank all teams at each lineup slot by average score (highest first).
 * rankings[si] = [{ rid, total }, ...] sorted descending by average points.
 */
export function computeSlotObjectiveRankings(teamSlotHistograms, rangeKey) {
  const teams = Object.entries(teamSlotHistograms || {});
  if (!teams.length) return [];
  const slotCount = teams[0][1]?.slots?.length || 0;
  const out = [];
  for (let si = 0; si < slotCount; si++) {
    const rankings = [];
    for (const [rid, team] of teams) {
      const slot = team.slots?.[si];
      const rangeData = slot?.[rangeKey] || slot?.reg;
      const avg = computeSlotScoreAverage(rangeData?.score);
      if (avg == null || !Number.isFinite(avg)) continue;
      rankings.push({ rid: Number(rid), total: avg });
    }
    rankings.sort((a, b) => b.total - a.total);
    out.push(rankings);
  }
  return out;
}

/** Slot league-rank distribution (1st–10th) bar chart rows. */
export function buildSlotRankChartData(rankHist, iterations) {
  if (!rankHist?.bins?.length) return [];
  const ordinals = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

  return rankHist.bins.map((count, i) => ({
    label: ordinals[i] || `${i + 1}th`,
    place: i + 1,
    count,
    pct: iterations > 0 ? (count / iterations) * 100 : 0,
    isPlayoff: i < 3,
  }));
}
