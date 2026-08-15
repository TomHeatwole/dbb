/**
 * backtestOutcomePools.mjs — leave-one-year-out validation of the simulator's
 * ADP outcome pools.
 *
 * For each catalog year Y, pools are built from the other 4 years and every
 * year-Y player-season is scored against its predicted distribution:
 *   - PIT (probability integral transform): percentile of the actual season
 *     within the predicted pool. Uniform PITs = calibrated distributions.
 *   - CRPS (continuous ranked probability score): lower = better, rewards
 *     calibration + sharpness. Used to rank candidate pool strategies.
 *
 * Also scans the full-catalog production pools for monotonicity violations
 * (a later ADP slot with better outcomes than an earlier one) and QB depth
 * artifacts.
 *
 * Usage: LEAGUE_ID=... node scripts/backtestOutcomePools.mjs [--json out.json]
 */

import { writeFileSync } from 'fs';
import {
  loadOutcomeCatalog,
  loadHwangPositionMaxRanks,
} from '../lib/mcp/simData.mjs';
import { loadPlayersData } from '../lib/mcp/dataLoader.mjs';
import { CURRENT_YEAR } from '../lib/mcp/config.mjs';
import {
  buildOutcomePool,
  buildPoolCumulativeWeights,
  percentileToOutcomeIndex,
} from '../lib/mcp/simEngine.mjs';

const ADP_WINDOW = 5;
const BOTTOM_BUCKET_SIZE = 10;
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const BANDS = [
  { id: '1-5', lo: 0, hi: 5.999 },
  { id: '6-15', lo: 6, hi: 15.999 },
  { id: '16-30', lo: 16, hi: 30.999 },
  { id: '31+', lo: 31, hi: Infinity },
];

// ─── Candidate pool strategies ───────────────────────────────────────────────

function windowFilter(catalog, position, center, w) {
  return catalog.filter(
    (e) => e.position === position && e.effRank >= center - w && e.effRank <= center + w,
  );
}

function isBottomBucket(effRank, position, maxRanks) {
  const max = maxRanks && maxRanks[position];
  if (!max) return false;
  return effRank >= max.maxEffRank - (BOTTOM_BUCKET_SIZE - 1);
}

function bottomBucketPool(catalog, position, maxRanks) {
  const max = maxRanks[position];
  if (!max) return [];
  const minEff = max.maxEffRank - (BOTTOM_BUCKET_SIZE - 1);
  return catalog.filter((e) => e.position === position && e.effRank >= minEff);
}

/** Pre-fix model: ±5 hard window + elite-finish duplication for top-5 ranks. */
function buildPoolOldInject(adpInfo, catalog, maxRanks) {
  const { position, effRank } = adpInfo;
  if (isBottomBucket(effRank, position, maxRanks)) {
    return bottomBucketPool(catalog, position, maxRanks).slice().sort((a, b) => b.scoringPts - a.scoringPts);
  }
  let pool = windowFilter(catalog, position, effRank, ADP_WINDOW);
  const rank = Math.ceil(effRank);
  if (rank <= 5 && pool.length > 0) {
    const missingUp = Math.max(0, ADP_WINDOW - (rank - 1));
    if (missingUp > 0) {
      const target = Math.round(pool.length * (missingUp / (ADP_WINDOW * 2 + 1)));
      const elite = catalog.filter(
        (e) => e.position === position && e.outcomeRank != null && e.outcomeRank <= rank,
      );
      if (target > 0 && elite.length > 0) {
        const sorted = pool.slice().sort((a, b) => b.scoringPts - a.scoringPts);
        const medianPts = sorted[Math.floor(sorted.length / 2)]?.scoringPts ?? 0;
        const good = elite.filter((e) => e.scoringPts >= medianPts).sort((a, b) => b.scoringPts - a.scoringPts);
        const source = good.length > 0 ? good : elite.slice().sort((a, b) => b.scoringPts - a.scoringPts);
        pool = [...pool];
        for (let i = 0; i < target; i++) pool.push({ ...source[i % source.length], synthetic: true });
      }
    }
  }
  return pool.slice().sort((a, b) => b.scoringPts - a.scoringPts);
}

/** Hard window + top kernel + bottom-10 bucket (the previous shipped model). */
function buildPoolKernelWindow(windowSize) {
  return (adpInfo, catalog, maxRanks) => {
    const { position, effRank } = adpInfo;
    if (isBottomBucket(effRank, position, maxRanks)) {
      return bottomBucketPool(catalog, position, maxRanks).slice().sort((a, b) => b.scoringPts - a.scoringPts);
    }
    let pool = windowFilter(catalog, position, effRank, windowSize);
    if (effRank - windowSize < 1) {
      const halfWidth = windowSize + 1;
      pool = pool.map((e) => ({
        ...e,
        weight: (halfWidth - Math.abs(e.effRank - effRank)) / halfWidth,
      }));
    }
    return pool.slice().sort((a, b) => b.scoringPts - a.scoringPts);
  };
}

const MODELS = {
  // Full shipped pipeline: ±2 grid + monotonic reorder + blend + tail buckets + synthetics.
  shipped: (adpInfo, catalog, maxRanks) => buildOutcomePool(adpInfo, catalog, maxRanks),
  // Same pipeline without synthetic densification.
  shippedNoSynth: (adpInfo, catalog, maxRanks) => buildOutcomePool(adpInfo, catalog, maxRanks, { densify: false }),
  // Shipped pipeline at high variance (extrapolated tails).
  shippedHighVar: (adpInfo, catalog, maxRanks) => buildOutcomePool(adpInfo, catalog, maxRanks, { variance: 'high' }),
  // Previous shipped model (±5 window, kernel top).
  adp5Kernel: buildPoolKernelWindow(5),
  // ±2 window with top kernel only — the shipped pipeline minus
  // reorder/blend/tail-bucket/synthetics. Isolates what the grid adds.
  adp2Raw: buildPoolKernelWindow(2),
  // Original elite-injection model.
  oldInject: buildPoolOldInject,
};

// ─── Scoring ─────────────────────────────────────────────────────────────────

function pitOf(pool, actualPts) {
  let wLess = 0;
  let wEq = 0;
  let wTot = 0;
  for (const e of pool) {
    const w = e.weight ?? 1;
    wTot += w;
    if (e.scoringPts < actualPts) wLess += w;
    else if (e.scoringPts === actualPts) wEq += w;
  }
  if (wTot <= 0) return null;
  return (wLess + 0.5 * wEq) / wTot;
}

function crpsOf(pool, actualPts) {
  const n = pool.length;
  if (n === 0) return null;
  let wTot = 0;
  let term1 = 0;
  for (const e of pool) {
    const w = e.weight ?? 1;
    wTot += w;
    term1 += w * Math.abs(e.scoringPts - actualPts);
  }
  let term2 = 0;
  for (let i = 0; i < n; i++) {
    const wi = pool[i].weight ?? 1;
    for (let j = 0; j < n; j++) {
      const wj = pool[j].weight ?? 1;
      term2 += wi * wj * Math.abs(pool[i].scoringPts - pool[j].scoringPts);
    }
  }
  return term1 / wTot - 0.5 * (term2 / (wTot * wTot));
}

/** One-sample KS statistic vs Uniform(0,1) + asymptotic p-value. */
function ksUniform(pits) {
  const n = pits.length;
  if (n === 0) return { d: null, p: null };
  const sorted = pits.slice().sort((a, b) => a - b);
  let d = 0;
  for (let i = 0; i < n; i++) {
    d = Math.max(d, Math.abs((i + 1) / n - sorted[i]), Math.abs(sorted[i] - i / n));
  }
  const lambda = (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * d;
  let p = 0;
  for (let k = 1; k <= 100; k++) p += 2 * ((k % 2 === 1) ? 1 : -1) * Math.exp(-2 * k * k * lambda * lambda);
  return { d, p: Math.max(0, Math.min(1, p)) };
}

function bandOf(effRank) {
  return BANDS.find((b) => effRank >= b.lo && effRank <= b.hi)?.id ?? '31+';
}

// ─── Backtest ────────────────────────────────────────────────────────────────

const players = loadPlayersData();
const { catalog, years } = loadOutcomeCatalog(CURRENT_YEAR, players);

console.log(`Backtest: leave-one-year-out over ${years.join(', ')} (${catalog.length} player-seasons)\n`);

// records[model] = [{ position, effRank, band, year, pit, crps }]
const records = {};
for (const m of Object.keys(MODELS)) records[m] = [];

for (const testYear of years) {
  const training = catalog.filter((e) => e.seasonYear !== testYear);
  const testEntries = catalog.filter((e) => e.seasonYear === testYear);
  const maxRanks = loadHwangPositionMaxRanks(testYear);

  for (const entry of testEntries) {
    const adpInfo = { position: entry.position, posRank: entry.adpRank, effRank: entry.effRank };
    for (const [modelName, build] of Object.entries(MODELS)) {
      const pool = build(adpInfo, training, maxRanks);
      if (!pool.length) continue;
      const pit = pitOf(pool, entry.scoringPts);
      const crps = crpsOf(pool, entry.scoringPts);
      if (pit == null || crps == null) continue;
      records[modelName].push({
        position: entry.position,
        effRank: entry.effRank,
        band: bandOf(entry.effRank),
        year: testYear,
        pit,
        crps,
      });
    }
  }
}

function summarize(rows) {
  const n = rows.length;
  const pits = rows.map((r) => r.pit);
  const meanPit = pits.reduce((a, b) => a + b, 0) / n;
  const below10 = pits.filter((p) => p < 0.1).length / n;
  const above90 = pits.filter((p) => p > 0.9).length / n;
  const below25 = pits.filter((p) => p < 0.25).length / n;
  const above75 = pits.filter((p) => p > 0.75).length / n;
  const meanCrps = rows.reduce((a, r) => a + r.crps, 0) / n;
  const { d, p } = ksUniform(pits);
  return { n, meanPit, below10, above90, below25, above75, meanCrps, ksD: d, ksP: p };
}

function fmtPct(x) { return `${(100 * x).toFixed(0)}%`; }

function printSummary(label, s) {
  if (!s || !s.n) { console.log(`  ${label}: no data`); return; }
  console.log(
    `  ${label.padEnd(22)} n=${String(s.n).padStart(4)}  meanPIT=${s.meanPit.toFixed(3)}  ` +
    `<P10:${fmtPct(s.below10).padStart(4)}  >P90:${fmtPct(s.above90).padStart(4)}  ` +
    `<P25:${fmtPct(s.below25).padStart(4)}  >P75:${fmtPct(s.above75).padStart(4)}  ` +
    `CRPS=${s.meanCrps.toFixed(1)}  KS-p=${s.ksP != null ? s.ksP.toFixed(3) : '—'}`,
  );
}

const jsonOut = { years, models: {}, monotonicity: {}, qbDepth: {} };

for (const modelName of Object.keys(MODELS)) {
  const rows = records[modelName];
  console.log(`── Model: ${modelName} ${'─'.repeat(Math.max(0, 60 - modelName.length))}`);
  const overall = summarize(rows);
  printSummary('ALL', overall);
  jsonOut.models[modelName] = { overall, bands: {}, positionBands: {} };

  for (const band of BANDS) {
    const bandRows = rows.filter((r) => r.band === band.id);
    if (!bandRows.length) continue;
    const s = summarize(bandRows);
    printSummary(`band ${band.id}`, s);
    jsonOut.models[modelName].bands[band.id] = { ...s, pits: bandRows.map((r) => Number(r.pit.toFixed(4))) };
  }

  for (const pos of POSITIONS) {
    for (const band of BANDS) {
      const sel = rows.filter((r) => r.position === pos && r.band === band.id);
      if (sel.length < 8) continue;
      const s = summarize(sel);
      printSummary(`${pos} ${band.id}`, s);
      jsonOut.models[modelName].positionBands[`${pos} ${band.id}`] = s;
    }
  }
  console.log('');
}

// ─── Monotonicity scan (production pools, full catalog, current model) ───────

console.log('── Monotonicity scan: production pools by rank (current model) ──');
const prodMaxRanks = loadHwangPositionMaxRanks(CURRENT_YEAR);

function poolQuantiles(pool) {
  const cum = buildPoolCumulativeWeights(pool);
  const at = (p) => pool[percentileToOutcomeIndex(p, pool.length, cum)].scoringPts;
  let wTot = 0;
  let mean = 0;
  for (const e of pool) { const w = e.weight ?? 1; wTot += w; mean += w * e.scoringPts; }
  return { p10: at(10), p50: at(50), p90: at(90), mean: mean / wTot, size: pool.length };
}

for (const pos of POSITIONS) {
  const maxRank = Math.ceil(prodMaxRanks[pos]?.maxEffRank ?? 0);
  const curve = [];
  for (let r = 1; r <= maxRank; r++) {
    const pool = buildOutcomePool({ position: pos, posRank: r, effRank: r }, catalog, prodMaxRanks);
    if (!pool.length) continue;
    curve.push({ rank: r, ...poolQuantiles(pool) });
  }
  jsonOut.monotonicity[pos] = curve;

  const violations = [];
  for (let i = 0; i < curve.length; i++) {
    for (let j = i + 1; j < curve.length; j++) {
      const a = curve[i];
      const b = curve[j];
      // Later ADP slot beats earlier slot on median AND P90 by a meaningful margin.
      if (b.p50 > a.p50 * 1.03 && b.p90 > a.p90 * 1.01 && b.rank > a.rank) {
        violations.push({ better: b.rank, worse: a.rank, p50Gap: b.p50 - a.p50, p90Gap: b.p90 - a.p90 });
      }
    }
  }
  const worst = violations.sort((x, y) => y.p50Gap - x.p50Gap).slice(0, 6);
  console.log(`  ${pos}: ranks 1–${maxRank}, ${violations.length} inversion pairs (later rank strictly better on P50+P90)`);
  for (const v of worst) {
    console.log(`     ${pos}${v.better} beats ${pos}${v.worse}: median +${v.p50Gap.toFixed(1)} pts, P90 +${v.p90Gap.toFixed(1)} pts`);
  }
}
console.log('');

// ─── QB depth analysis ────────────────────────────────────────────────────────

console.log('── QB depth: catalog coverage & pool shape by rank ──');
const qbCurve = jsonOut.monotonicity.QB || [];
const qbCatalogByRank = {};
for (const e of catalog) {
  if (e.position !== 'QB') continue;
  const r = Math.round(e.effRank);
  qbCatalogByRank[r] = (qbCatalogByRank[r] || 0) + 1;
}
jsonOut.qbDepth = {
  catalogCountsByRank: qbCatalogByRank,
  maxEffRankByYear: Object.fromEntries(years.map((y) => [y, loadHwangPositionMaxRanks(y).QB?.maxEffRank ?? null])),
  curve: qbCurve,
};
console.log(`  QB max drafted eff rank by year: ${years.map((y) => `${y}:${loadHwangPositionMaxRanks(y).QB?.maxEffRank ?? '—'}`).join('  ')}`);
for (const row of qbCurve) {
  const bar = '#'.repeat(Math.round(row.p50 / 12));
  console.log(
    `  QB${String(row.rank).padStart(2)}: pool=${String(row.size).padStart(3)}  ` +
    `P10=${row.p10.toFixed(0).padStart(4)}  P50=${row.p50.toFixed(0).padStart(4)}  P90=${row.p90.toFixed(0).padStart(4)}  ${bar}`,
  );
}

const jsonPathIdx = process.argv.indexOf('--json');
if (jsonPathIdx !== -1 && process.argv[jsonPathIdx + 1]) {
  writeFileSync(process.argv[jsonPathIdx + 1], JSON.stringify(jsonOut, null, 1));
  console.log(`\nWrote JSON results to ${process.argv[jsonPathIdx + 1]}`);
}
