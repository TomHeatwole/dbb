/**
 * checkInjuryUniformity.mjs — audit whether zero-week rates (injury/DNP/bye
 * proxy) stay roughly uniform across ADP bands in the shipped outcome pools,
 * or whether pool construction / small-sample variance has skewed them.
 *
 * Usage (from site/):
 *   set -a && source .env.local && set +a
 *   node scripts/checkInjuryUniformity.mjs [--json /tmp/injury_uniformity.json]
 */
import { writeFileSync } from 'fs';
import { loadSimulationInputs, loadHwangPositionMaxRanks } from '../lib/mcp/simData.mjs';
import { CURRENT_YEAR } from '../lib/mcp/config.mjs';
import {
  buildOutcomePool,
  materializeOutcomeWeeks,
} from '../lib/mcp/simEngine.mjs';

const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const BANDS = [
  { id: '1-5', lo: 0, hi: 5.999 },
  { id: '6-15', lo: 6, hi: 15.999 },
  { id: '16-30', lo: 16, hi: 30.999 },
  { id: '31+', lo: 31, hi: Infinity },
];
const REG_WEEKS = 14;
// Assume ~1 bye among zeros; residual is injury/DNP/inactive proxy.
const BYE_ADJUST = 1;

function bandOf(effRank) {
  return BANDS.find((b) => effRank >= b.lo && effRank <= b.hi)?.id ?? '31+';
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 5) return null;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  let sx = 0; let sy = 0; let sxx = 0; let syy = 0; let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += rx[i]; sy += ry[i];
    sxx += rx[i] * rx[i]; syy += ry[i] * ry[i];
    sxy += rx[i] * ry[i];
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (den === 0) return null;
  return num / den;
}

function zeroStats(weeks) {
  const reg = weeks.slice(0, REG_WEEKS);
  const zeros = reg.filter((p) => !(p > 0)).length;
  const injuryProxy = Math.max(0, zeros - BYE_ADJUST);
  return {
    zeros,
    injuryProxy,
    heavyInjury: injuryProxy >= 3, // ≥3 non-bye zeros in weeks 1–14
    total: weeks.reduce((a, b) => a + (b || 0), 0),
  };
}

function summarizeRates(rows, weightKey = null) {
  if (!rows.length) return null;
  let wTot = 0;
  let zSum = 0;
  let injSum = 0;
  let heavySum = 0;
  for (const r of rows) {
    const w = weightKey ? (r[weightKey] ?? 1) : 1;
    wTot += w;
    zSum += w * r.zeros;
    injSum += w * r.injuryProxy;
    heavySum += w * (r.heavyInjury ? 1 : 0);
  }
  return {
    n: rows.length,
    wTot,
    meanZeros: zSum / wTot,
    meanInjuryProxy: injSum / wTot,
    heavyInjuryRate: heavySum / wTot,
  };
}

function fmt(x, d = 2) {
  return x == null || Number.isNaN(x) ? '—' : x.toFixed(d);
}

console.log('Loading simulation inputs (catalog + Sleeper weekly points)…');
const { catalog, basePointsByYear, positionMaxRanks } = await loadSimulationInputs();
const years = [...new Set(catalog.map((e) => e.seasonYear))].sort();
console.log(`Catalog: ${catalog.length} player-seasons across ${years.join(', ')}\n`);

// ─── Historical catalog rates by ADP ─────────────────────────────────────────

const catalogRows = [];
for (const e of catalog) {
  const weeks = [];
  const yr = basePointsByYear[String(e.seasonYear)];
  if (!yr || yr.length < REG_WEEKS) continue;
  for (let i = 0; i < 17; i++) weeks.push(yr[i]?.[e.sleeperId] ?? 0);
  const zs = zeroStats(weeks);
  catalogRows.push({
    position: e.position,
    effRank: e.effRank,
    band: bandOf(e.effRank),
    year: e.seasonYear,
    ...zs,
  });
}

console.log('── Historical catalog: reg-season zero weeks by ADP band ──');
console.log('   (injuryProxy = max(0, zeros − 1 bye); heavy = injuryProxy ≥ 3)\n');

const catalogByBand = {};
const catalogByPosBand = {};
for (const band of BANDS) {
  const rows = catalogRows.filter((r) => r.band === band.id);
  const s = summarizeRates(rows);
  catalogByBand[band.id] = s;
  console.log(
    `  band ${band.id.padEnd(6)} n=${String(s.n).padStart(4)}  ` +
    `meanZeros=${fmt(s.meanZeros)}  injuryProxy=${fmt(s.meanInjuryProxy)}  ` +
    `heavy=${fmt(100 * s.heavyInjuryRate, 1)}%`,
  );
}
console.log('');
for (const pos of POSITIONS) {
  for (const band of BANDS) {
    const rows = catalogRows.filter((r) => r.position === pos && r.band === band.id);
    if (rows.length < 8) continue;
    const s = summarizeRates(rows);
    catalogByPosBand[`${pos} ${band.id}`] = s;
    console.log(
      `  ${pos} ${band.id.padEnd(6)} n=${String(s.n).padStart(4)}  ` +
      `meanZeros=${fmt(s.meanZeros)}  injuryProxy=${fmt(s.meanInjuryProxy)}  ` +
      `heavy=${fmt(100 * s.heavyInjuryRate, 1)}%`,
    );
  }
}

const catalogRho = spearman(
  catalogRows.map((r) => r.effRank),
  catalogRows.map((r) => r.injuryProxy),
);
console.log(`\n  Spearman(effRank, injuryProxy) catalog = ${fmt(catalogRho, 3)}`);

// ─── Production pools: what the sim actually samples ─────────────────────────

const MODELS = {
  shipped: {},
  shippedNoSynth: { densify: false },
};

const poolByModel = {};
const rankCurves = {};

for (const [modelName, opts] of Object.entries(MODELS)) {
  console.log(`\n── Production pools (${modelName}): weighted zero rates by ADP ──`);
  const bandBuckets = Object.fromEntries(BANDS.map((b) => [b.id, []]));
  const posBandBuckets = {};
  const curves = {};

  for (const pos of POSITIONS) {
    const maxRank = Math.ceil(positionMaxRanks[pos]?.maxEffRank ?? 0);
    curves[pos] = [];
    for (let r = 1; r <= maxRank; r++) {
      const pool = buildOutcomePool(
        { position: pos, posRank: r, effRank: r },
        catalog,
        positionMaxRanks,
        opts,
      );
      if (!pool.length) continue;

      let wTot = 0;
      let zSum = 0;
      let injSum = 0;
      let heavySum = 0;
      let nReal = 0;
      let nSynth = 0;
      for (const e of pool) {
        const w = e.weight ?? 1;
        const weeks = materializeOutcomeWeeks(e, basePointsByYear, 17);
        const zs = zeroStats(Array.from(weeks));
        wTot += w;
        zSum += w * zs.zeros;
        injSum += w * zs.injuryProxy;
        heavySum += w * (zs.heavyInjury ? 1 : 0);
        if (e.synthetic) nSynth += 1;
        else nReal += 1;
      }
      const row = {
        position: pos,
        rank: r,
        band: bandOf(r),
        poolSize: pool.length,
        nReal,
        nSynth,
        meanZeros: zSum / wTot,
        meanInjuryProxy: injSum / wTot,
        heavyInjuryRate: heavySum / wTot,
      };
      curves[pos].push(row);
      bandBuckets[row.band].push(row);
      const pb = `${pos} ${row.band}`;
      if (!posBandBuckets[pb]) posBandBuckets[pb] = [];
      posBandBuckets[pb].push(row);
    }
  }

  // Band summary: average across integer ranks in band (equal weight per rank slot)
  const bandSummary = {};
  for (const band of BANDS) {
    const rows = bandBuckets[band.id];
    if (!rows.length) continue;
    const s = {
      nRanks: rows.length,
      meanZeros: mean(rows.map((r) => r.meanZeros)),
      meanInjuryProxy: mean(rows.map((r) => r.meanInjuryProxy)),
      heavyInjuryRate: mean(rows.map((r) => r.heavyInjuryRate)),
      sdInjuryProxy: stdev(rows.map((r) => r.meanInjuryProxy)),
      minInjuryProxy: Math.min(...rows.map((r) => r.meanInjuryProxy)),
      maxInjuryProxy: Math.max(...rows.map((r) => r.meanInjuryProxy)),
    };
    bandSummary[band.id] = s;
    console.log(
      `  band ${band.id.padEnd(6)} ranks=${String(s.nRanks).padStart(3)}  ` +
      `meanZeros=${fmt(s.meanZeros)}  injuryProxy=${fmt(s.meanInjuryProxy)}  ` +
      `heavy=${fmt(100 * s.heavyInjuryRate, 1)}%  ` +
      `range=[${fmt(s.minInjuryProxy)}–${fmt(s.maxInjuryProxy)}] sd=${fmt(s.sdInjuryProxy)}`,
    );
  }

  const allRankRows = Object.values(curves).flat();
  const poolRho = spearman(
    allRankRows.map((r) => r.rank),
    allRankRows.map((r) => r.meanInjuryProxy),
  );
  console.log(`  Spearman(rank, pool injuryProxy) = ${fmt(poolRho, 3)}`);

  // Position × band
  const posBandSummary = {};
  for (const [key, rows] of Object.entries(posBandBuckets)) {
    posBandSummary[key] = {
      nRanks: rows.length,
      meanZeros: mean(rows.map((r) => r.meanZeros)),
      meanInjuryProxy: mean(rows.map((r) => r.meanInjuryProxy)),
      heavyInjuryRate: mean(rows.map((r) => r.heavyInjuryRate)),
      sdInjuryProxy: stdev(rows.map((r) => r.meanInjuryProxy)),
    };
  }

  poolByModel[modelName] = { bandSummary, posBandSummary, rho: poolRho };
  rankCurves[modelName] = curves;
}

// ─── Compare catalog vs shipped pools ────────────────────────────────────────

console.log('\n── Catalog vs shipped pool injuryProxy (by band) ──');
const deltas = [];
for (const band of BANDS) {
  const cat = catalogByBand[band.id];
  const pool = poolByModel.shipped.bandSummary[band.id];
  if (!cat || !pool) continue;
  const delta = pool.meanInjuryProxy - cat.meanInjuryProxy;
  deltas.push({ band: band.id, catalog: cat.meanInjuryProxy, pool: pool.meanInjuryProxy, delta });
  console.log(
    `  ${band.id.padEnd(6)} catalog=${fmt(cat.meanInjuryProxy)}  ` +
    `pool=${fmt(pool.meanInjuryProxy)}  Δ=${delta >= 0 ? '+' : ''}${fmt(delta)}`,
  );
}

const overallCat = mean(catalogRows.map((r) => r.injuryProxy));
const overallPool = mean(
  Object.values(rankCurves.shipped).flat().map((r) => r.meanInjuryProxy),
);
const bandMeans = BANDS.map((b) => poolByModel.shipped.bandSummary[b.id]?.meanInjuryProxy).filter((x) => x != null);
const bandSpread = Math.max(...bandMeans) - Math.min(...bandMeans);
const maxAbsDelta = Math.max(...deltas.map((d) => Math.abs(d.delta)));

// Flag ranks where pool injuryProxy is >2σ from position's overall mean (noise spikes)
console.log('\n── Rank-level outliers in shipped pools (|z| > 2 vs position mean) ──');
const outliers = [];
for (const pos of POSITIONS) {
  const curve = rankCurves.shipped[pos] || [];
  const vals = curve.map((r) => r.meanInjuryProxy);
  const m = mean(vals);
  const sd = stdev(vals);
  if (sd == null || sd < 1e-9) continue;
  for (const r of curve) {
    const z = (r.meanInjuryProxy - m) / sd;
    if (Math.abs(z) > 2) {
      outliers.push({ ...r, z, posMean: m });
      console.log(
        `  ${pos}${String(r.rank).padStart(2)}  injuryProxy=${fmt(r.meanInjuryProxy)}  ` +
        `z=${fmt(z)}  (pos mean ${fmt(m)}, pool n=${r.poolSize})`,
      );
    }
  }
}
if (!outliers.length) console.log('  none');

// Verdict heuristics
const rhoShip = poolByModel.shipped.rho;
const concerns = [];
if (Math.abs(rhoShip ?? 0) > 0.25) {
  concerns.push(`Shipped pools show ADP↔injury correlation ρ=${fmt(rhoShip, 3)} (|ρ|>0.25)`);
}
if (bandSpread > 0.75) {
  concerns.push(`Band injuryProxy spread ${fmt(bandSpread)} weeks (>0.75)`);
}
if (maxAbsDelta > 0.5) {
  concerns.push(`Largest catalog→pool Δ ${fmt(maxAbsDelta)} weeks (>0.5)`);
}
if (outliers.length > 12) {
  concerns.push(`${outliers.length} rank-level |z|>2 outliers (noisy per-rank sampling)`);
}

console.log('\n── Verdict ──');
console.log(`  Overall catalog injuryProxy: ${fmt(overallCat)} weeks/season (reg, bye-adjusted)`);
console.log(`  Overall shipped pool injuryProxy: ${fmt(overallPool)}`);
console.log(`  Band spread (max−min pool injuryProxy): ${fmt(bandSpread)}`);
console.log(`  Max |catalog−pool| Δ: ${fmt(maxAbsDelta)}`);
console.log(`  Spearman ADP↔injury (catalog / shipped): ${fmt(catalogRho, 3)} / ${fmt(rhoShip, 3)}`);
if (concerns.length) {
  console.log('  CONCERNS:');
  for (const c of concerns) console.log(`    - ${c}`);
} else {
  console.log('  OK: injury exposure looks sufficiently uniform across ADP bands;');
  console.log('      pool construction has not introduced a material ADP injury gradient.');
}

const jsonOut = {
  years,
  catalogN: catalogRows.length,
  byeAdjust: BYE_ADJUST,
  catalogByBand,
  catalogByPosBand,
  catalogRho,
  poolByModel,
  rankCurves: {
    shipped: Object.fromEntries(
      POSITIONS.map((pos) => [
        pos,
        (rankCurves.shipped[pos] || []).map((r) => ({
          rank: r.rank,
          meanZeros: Number(r.meanZeros.toFixed(3)),
          meanInjuryProxy: Number(r.meanInjuryProxy.toFixed(3)),
          heavyInjuryRate: Number(r.heavyInjuryRate.toFixed(4)),
          poolSize: r.poolSize,
        })),
      ]),
    ),
  },
  deltas,
  outliers: outliers.map((o) => ({
    position: o.position,
    rank: o.rank,
    meanInjuryProxy: Number(o.meanInjuryProxy.toFixed(3)),
    z: Number(o.z.toFixed(2)),
    poolSize: o.poolSize,
  })),
  summary: {
    overallCat,
    overallPool,
    bandSpread,
    maxAbsDelta,
    catalogRho,
    shippedRho: rhoShip,
    concerns,
    ok: concerns.length === 0,
  },
};

const jsonPathIdx = process.argv.indexOf('--json');
if (jsonPathIdx !== -1 && process.argv[jsonPathIdx + 1]) {
  writeFileSync(process.argv[jsonPathIdx + 1], JSON.stringify(jsonOut, null, 2));
  console.log(`\nWrote JSON to ${process.argv[jsonPathIdx + 1]}`);
}
