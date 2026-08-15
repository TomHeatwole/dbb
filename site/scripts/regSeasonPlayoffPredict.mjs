/**
 * How well do weeks 1–14 totals and per-game rate (zeros dropped as
 * injury/bye/DNP) predict weeks 15–17 scoring?
 */
import { loadSimulationInputs } from '../lib/mcp/simData.mjs';
import { writeFileSync } from 'fs';

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
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
  return pearson(rank(xs), rank(ys));
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0; let sy = 0; let sxx = 0; let syy = 0; let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i];
    sxx += xs[i] * xs[i]; syy += ys[i] * ys[i];
    sxy += xs[i] * ys[i];
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (den === 0) return null;
  return num / den;
}

function r2xy(xs, ys) {
  const r = pearson(xs, ys);
  return r == null ? null : r * r;
}

/** Multiple R² of y ~ 1 + x1 + x2 (optional x2). */
function r2multi(y, x1, x2) {
  const n = y.length;
  const k = x2 ? 3 : 2;
  const X = [];
  for (let i = 0; i < n; i++) {
    X.push(x2 ? [1, x1[i], x2[i]] : [1, x1[i]]);
  }
  // XtX
  const XtX = Array.from({ length: k }, () => Array(k).fill(0));
  const Xty = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  const beta = solve(XtX, Xty);
  if (!beta) return null;
  let ssTot = 0; let ssRes = 0;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) {
    let pred = 0;
    for (let a = 0; a < k; a++) pred += beta[a] * X[i][a];
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - yMean) ** 2;
  }
  if (ssTot === 0) return null;
  return 1 - ssRes / ssTot;
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let max = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[max][i])) max = r;
    [M[i], M[max]] = [M[max], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    const piv = M[i][i];
    for (let c = i; c <= n; c++) M[i][c] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((row) => row[n]);
}

function pairStats(rows, xKey, yKey) {
  const xs = rows.map((r) => r[xKey]);
  const ys = rows.map((r) => r[yKey]);
  const rho = spearman(xs, ys);
  const r = pearson(xs, ys);
  return {
    n: rows.length,
    spearman: rho,
    pearson: r,
    r2: r == null ? null : r * r,
  };
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function ppg(weeks) {
  const played = weeks.filter((p) => p > 0);
  if (!played.length) return null;
  return { ppg: mean(played), games: played.length, zeros: weeks.length - played.length };
}

const { catalog, basePointsByYear } = await loadSimulationInputs();

const rows = [];
for (const e of catalog) {
  const weeks = basePointsByYear[String(e.seasonYear)];
  if (!weeks || weeks.length < 17) continue;
  const w = [];
  for (let i = 0; i < 17; i++) w.push(weeks[i]?.[e.sleeperId] ?? 0);
  const reg = w.slice(0, 14);
  const po = w.slice(14, 17);
  const regRate = ppg(reg);
  const poRate = ppg(po);
  if (!regRate) continue;
  rows.push({
    position: e.position,
    year: e.seasonYear,
    effRank: e.effRank,
    logRank: Math.log(Math.max(e.effRank, 0.5)),
    regTotal: reg.reduce((a, b) => a + b, 0),
    poTotal: po.reduce((a, b) => a + b, 0),
    regPpg: regRate.ppg,
    regGames: regRate.games,
    regZeros: regRate.zeros,
    poPpg: poRate?.ppg ?? null,
    poGames: poRate?.games ?? 0,
    w,
  });
}

function pack(subset, label) {
  const playedPo = subset.filter((r) => r.poGames >= 1);
  const adpPo = pairStats(subset, 'effRank', 'poTotal');
  const totPo = pairStats(subset, 'regTotal', 'poTotal');
  const ppgPo = pairStats(subset, 'regPpg', 'poTotal');
  const totPoPpg = pairStats(playedPo, 'regTotal', 'poPpg');
  const ppgPpg = pairStats(playedPo, 'regPpg', 'poPpg');
  const adpPpg = pairStats(playedPo, 'effRank', 'poPpg');

  const yTot = subset.map((r) => r.poTotal);
  const r2Adp = r2xy(subset.map((r) => r.logRank), yTot);
  const r2Tot = r2xy(subset.map((r) => r.regTotal), yTot);
  const r2Ppg = r2xy(subset.map((r) => r.regPpg), yTot);
  const r2BothTot = r2multi(yTot, subset.map((r) => r.logRank), subset.map((r) => r.regTotal));
  const r2BothPpg = r2multi(yTot, subset.map((r) => r.logRank), subset.map((r) => r.regPpg));
  const r2TotOnly = r2multi(yTot, subset.map((r) => r.regTotal));

  const yPpg = playedPo.map((r) => r.poPpg);
  const r2PpgRate = r2xy(playedPo.map((r) => r.regPpg), yPpg);
  const r2AdpRate = r2xy(playedPo.map((r) => r.logRank), yPpg);
  const r2BothRate = r2multi(yPpg, playedPo.map((r) => r.logRank), playedPo.map((r) => r.regPpg));

  return {
    label,
    n: subset.length,
    nPlayedPo: playedPo.length,
    // |ρ| — ADP is inverse so take abs
    adpVsPoRho: Math.abs(adpPo.spearman ?? 0),
    totVsPoRho: totPo.spearman,
    ppgVsPoRho: ppgPo.spearman,
    totVsPoPpgRho: totPoPpg.spearman,
    ppgVsPoPpgRho: ppgPpg.spearman,
    adpVsPoPpgRho: Math.abs(adpPpg.spearman ?? 0),
    r2Adp,
    r2Tot,
    r2Ppg,
    r2BothTot,
    r2BothPpg,
    r2TotOnly,
    r2PpgRate,
    r2AdpRate,
    r2BothRate,
    incrTotOverAdp: r2BothTot != null && r2Adp != null ? r2BothTot - r2Adp : null,
    incrPpgOverAdp: r2BothPpg != null && r2Adp != null ? r2BothPpg - r2Adp : null,
    incrAdpOverTot: r2BothTot != null && r2Tot != null ? r2BothTot - r2Tot : null,
    incrPpgRateOverAdp: r2BothRate != null && r2AdpRate != null ? r2BothRate - r2AdpRate : null,
  };
}

// In-season control: weeks 1–11 total / PPG → weeks 12–14 (same 3-week target, not playoffs)
function packControl(subset) {
  const tmp = [];
  for (const r of subset) {
    const early = r.w.slice(0, 11);
    const late = r.w.slice(11, 14);
    const rate = ppg(early);
    const lateRate = ppg(late);
    if (!rate) continue;
    tmp.push({
      logRank: r.logRank,
      regTotal: early.reduce((a, b) => a + b, 0),
      regPpg: rate.ppg,
      poTotal: late.reduce((a, b) => a + b, 0),
      poPpg: lateRate?.ppg ?? null,
      poGames: lateRate?.games ?? 0,
      effRank: r.effRank,
    });
  }
  return pack(tmp, 'control 1–11 → 12–14');
}

const overall = pack(rows, 'all');
const g4 = pack(rows.filter((r) => r.regGames >= 4), '≥4 games 1–14');
const g8 = pack(rows.filter((r) => r.regGames >= 8), '≥8 games 1–14');
const control = packControl(rows);
const controlG8 = packControl(rows.filter((r) => r.regGames >= 8));

const byPos = {};
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  byPos[pos] = pack(rows.filter((r) => r.position === pos), pos);
}

const byYear = {};
for (const y of [...new Set(rows.map((r) => r.year))].sort()) {
  byYear[y] = pack(rows.filter((r) => r.year === y), String(y));
}

// Zero-week rates for context
const zeroStats = {
  meanRegZeros: mean(rows.map((r) => r.regZeros)),
  meanRegGames: mean(rows.map((r) => r.regGames)),
  pctNoPlayoffGame: rows.filter((r) => r.poGames === 0).length / rows.length,
  meanPoGames: mean(rows.map((r) => r.poGames)),
  byPos: {},
};
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  const s = rows.filter((r) => r.position === pos);
  zeroStats.byPos[pos] = {
    meanRegGames: mean(s.map((r) => r.regGames)),
    pctNoPlayoffGame: s.filter((r) => r.poGames === 0).length / s.length,
  };
}

const out = { overall, g4, g8, control, controlG8, byPos, byYear, zeroStats, n: rows.length };
writeFileSync('/tmp/reg_playoff_predict.json', JSON.stringify(out, null, 2));

function f(x) { return x == null ? '—' : x.toFixed(3); }
function pct(x) { return x == null ? '—' : `${(100 * x).toFixed(0)}%`; }

function dump(s) {
  console.log(`\n=== ${s.label}  n=${s.n}  (played ≥1 playoff game: ${s.nPlayedPo}) ===`);
  console.log('Predicting playoff TOTAL (w15–17, zeros kept)');
  console.log(`  ADP          ρ=${f(s.adpVsPoRho)}   R²=${f(s.r2Adp)}`);
  console.log(`  1–14 total   ρ=${f(s.totVsPoRho)}   R²=${f(s.r2Tot)}`);
  console.log(`  1–14 PPG*    ρ=${f(s.ppgVsPoRho)}   R²=${f(s.r2Ppg)}`);
  console.log(`  ADP+total    R²=${f(s.r2BothTot)}   +${f(s.incrTotOverAdp)} over ADP   +${f(s.incrAdpOverTot)} over total`);
  console.log(`  ADP+PPG      R²=${f(s.r2BothPpg)}   +${f(s.incrPpgOverAdp)} over ADP`);
  console.log('Predicting playoff PPG* (played ≥1 of w15–17)');
  console.log(`  ADP          ρ=${f(s.adpVsPoPpgRho)}   R²=${f(s.r2AdpRate)}`);
  console.log(`  1–14 total   ρ=${f(s.totVsPoPpgRho)}`);
  console.log(`  1–14 PPG*    ρ=${f(s.ppgVsPoPpgRho)}   R²=${f(s.r2PpgRate)}`);
  console.log(`  ADP+PPG      R²=${f(s.r2BothRate)}   +${f(s.incrPpgRateOverAdp)} over ADP`);
}

console.log(`n=${rows.length} with ≥1 non-zero week in 1–14`);
console.log(`mean games 1–14 (ex-zero): ${zeroStats.meanRegGames.toFixed(1)}   mean zero weeks 1–14: ${zeroStats.meanRegZeros.toFixed(1)}`);
console.log(`no playoff game (all zeros 15–17): ${pct(zeroStats.pctNoPlayoffGame)}`);

dump(overall);
dump(g4);
dump(g8);
dump(control);
dump(controlG8);

console.log('\nBy position (all, ≥1 game 1–14)');
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  const s = byPos[pos];
  console.log(
    `  ${pos} n=${s.n}  tot→po ρ=${f(s.totVsPoRho)} R²=${f(s.r2Tot)}   ` +
    `ppg→po ρ=${f(s.ppgVsPoRho)} R²=${f(s.r2Ppg)}   ` +
    `ppg→poPpg ρ=${f(s.ppgVsPoPpgRho)} R²=${f(s.r2PpgRate)}   ` +
    `ADP R²=${f(s.r2Adp)}  incr tot|ADP ${f(s.incrTotOverAdp)}`,
  );
}

console.log('\nBy year');
for (const [y, s] of Object.entries(byYear)) {
  console.log(`  ${y}  tot→po ρ=${f(s.totVsPoRho)} R²=${f(s.r2Tot)}   ppg→poPpg R²=${f(s.r2PpgRate)}   ADP R²=${f(s.r2Adp)}`);
}
