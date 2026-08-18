/**
 * Playoff predictiveness: ADP vs weeks 1–14 vs weeks 8–14.
 * Also: how tight is the leftover playoff range after k-NN conditioning?
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
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (den === 0) return null;
  return (n * sxy - sx * sy) / den;
}

function r2xy(xs, ys) {
  const r = pearson(xs, ys);
  return r == null ? null : r * r;
}

function r2multi(y, x1, x2) {
  const n = y.length;
  const k = x2 ? 3 : 2;
  const X = y.map((_, i) => (x2 ? [1, x1[i], x2[i]] : [1, x1[i]]));
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
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0; let ssRes = 0;
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

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

function pair(rows, xKey, yKey, invertX = false) {
  const xs = rows.map((r) => (invertX ? -r[xKey] : r[xKey]));
  const ys = rows.map((r) => r[yKey]);
  const rho = spearman(xs, ys);
  const r = pearson(xs, ys);
  return { n: rows.length, spearman: rho, r2: r == null ? null : r * r };
}

const K = 30;

/** Leave-one-out k-NN pool width of playoff totals, by a conditioner. */
function knnWidth(rows, xKey, invertX = false) {
  const byPos = {};
  for (const r of rows) {
    if (!byPos[r.position]) byPos[r.position] = [];
    byPos[r.position].push(r);
  }
  const iqrs = [];
  const stds = [];
  const absErr = [];
  for (const pos of Object.keys(byPos)) {
    const group = byPos[pos];
    const keyed = group.map((r, i) => ({
      i,
      x: invertX ? -r[xKey] : r[xKey],
      po: r.poTotal,
    })).sort((a, b) => a.x - b.x);
    const n = keyed.length;
    for (let i = 0; i < n; i++) {
      let lo = i;
      let hi = i;
      const want = Math.min(K + 1, n); // include self, then drop
      while (hi - lo + 1 < want && (lo > 0 || hi < n - 1)) {
        if (lo === 0) { hi += 1; continue; }
        if (hi === n - 1) { lo -= 1; continue; }
        const ld = Math.abs(keyed[lo - 1].x - keyed[i].x);
        const rd = Math.abs(keyed[hi + 1].x - keyed[i].x);
        if (ld <= rd) lo -= 1;
        else hi += 1;
      }
      const neighbors = [];
      for (let j = lo; j <= hi; j++) {
        if (j === i) continue;
        neighbors.push(keyed[j].po);
      }
      if (neighbors.length < 8) continue;
      neighbors.sort((a, b) => a - b);
      iqrs.push(quantile(neighbors, 0.75) - quantile(neighbors, 0.25));
      stds.push(stdev(neighbors));
      const med = quantile(neighbors, 0.5);
      absErr.push(Math.abs(keyed[i].po - med));
    }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    n: iqrs.length,
    meanIqr: mean(iqrs),
    meanStd: mean(stds),
    mae: mean(absErr),
  };
}

const { catalog, basePointsByYear } = await loadSimulationInputs();

const rows = [];
for (const e of catalog) {
  const weeks = basePointsByYear[String(e.seasonYear)];
  if (!weeks || weeks.length < 17) continue;
  const w = [];
  for (let i = 0; i < 17; i++) w.push(weeks[i]?.[e.sleeperId] ?? 0);
  const w114 = w.slice(0, 14);
  const w814 = w.slice(7, 14);
  const po = w.slice(14, 17);
  const games114 = w114.filter((p) => p > 0).length;
  const games814 = w814.filter((p) => p > 0).length;
  if (games114 < 1) continue;
  rows.push({
    position: e.position,
    year: e.seasonYear,
    effRank: e.effRank,
    logRank: Math.log(Math.max(e.effRank, 0.5)),
    tot114: w114.reduce((a, b) => a + b, 0),
    tot814: w814.reduce((a, b) => a + b, 0),
    poTotal: po.reduce((a, b) => a + b, 0),
    games114,
    games814,
    poGames: po.filter((p) => p > 0).length,
  });
}

function pack(subset, label) {
  const y = subset.map((r) => r.poTotal);
  const adp = pair(subset, 'effRank', 'poTotal', true);
  const t114 = pair(subset, 'tot114', 'poTotal');
  const t814 = pair(subset, 'tot814', 'poTotal');
  const r2Adp = r2xy(subset.map((r) => r.logRank), y);
  const r2_114 = r2xy(subset.map((r) => r.tot114), y);
  const r2_814 = r2xy(subset.map((r) => r.tot814), y);
  const r2Both = r2multi(y, subset.map((r) => r.tot114), subset.map((r) => r.tot814));
  const r2Adp114 = r2multi(y, subset.map((r) => r.logRank), subset.map((r) => r.tot114));
  const r2Adp814 = r2multi(y, subset.map((r) => r.logRank), subset.map((r) => r.tot814));
  return {
    label,
    n: subset.length,
    adpRho: adp.spearman,
    t114Rho: t114.spearman,
    t814Rho: t814.spearman,
    r2Adp,
    r2_114,
    r2_814,
    r2Both,
    incr814Over114: r2Both != null && r2_114 != null ? r2Both - r2_114 : null,
    incr114Over814: r2Both != null && r2_814 != null ? r2Both - r2_814 : null,
    incr114OverAdp: r2Adp114 != null && r2Adp != null ? r2Adp114 - r2Adp : null,
    incr814OverAdp: r2Adp814 != null && r2Adp != null ? r2Adp814 - r2Adp : null,
    widthAdp: knnWidth(subset, 'effRank', true),
    width114: knnWidth(subset, 'tot114'),
    width814: knnWidth(subset, 'tot814'),
  };
}

const overall = pack(rows, 'all ≥1 game in 1–14');
const g814 = pack(rows.filter((r) => r.games814 >= 3), '≥3 games in 8–14');
const top24 = pack(rows.filter((r) => r.effRank <= 24), 'ADP ≤ 24');
const top24g = pack(rows.filter((r) => r.effRank <= 24 && r.games814 >= 3), 'ADP ≤ 24 and ≥3 games 8–14');

const byPos = {};
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  byPos[pos] = pack(rows.filter((r) => r.position === pos), pos);
}

const out = { overall, g814, top24, top24g, byPos, n: rows.length, k: K };
writeFileSync('/tmp/playoff_window_predict.json', JSON.stringify(out, null, 2));

function f(x) { return x == null ? '—' : x.toFixed(3); }
function pts(x) { return x == null ? '—' : x.toFixed(1); }

function dump(s) {
  console.log(`\n=== ${s.label}  n=${s.n} ===`);
  console.log('Predicting playoff total (W15–17)');
  console.log(`  ADP        ρ=${f(s.adpRho)}   R²=${f(s.r2Adp)}`);
  console.log(`  Weeks 1–14 ρ=${f(s.t114Rho)}   R²=${f(s.r2_114)}   +${f(s.incr114OverAdp)} over ADP`);
  console.log(`  Weeks 8–14 ρ=${f(s.t814Rho)}   R²=${f(s.r2_814)}   +${f(s.incr814OverAdp)} over ADP`);
  console.log(`  1–14 + 8–14 R²=${f(s.r2Both)}   8–14 adds ${f(s.incr814Over114)} on top of 1–14; 1–14 adds ${f(s.incr114Over814)} on top of 8–14`);
  console.log(`Leave-one-out k=${K} neighbor playoff-pool width`);
  console.log(`  ADP     IQR=${pts(s.widthAdp.meanIqr)}  std=${pts(s.widthAdp.meanStd)}  MAE=${pts(s.widthAdp.mae)}`);
  console.log(`  1–14    IQR=${pts(s.width114.meanIqr)}  std=${pts(s.width114.meanStd)}  MAE=${pts(s.width114.mae)}`);
  console.log(`  8–14    IQR=${pts(s.width814.meanIqr)}  std=${pts(s.width814.meanStd)}  MAE=${pts(s.width814.mae)}`);
}

dump(overall);
dump(g814);
dump(top24);
dump(top24g);
console.log('\nBy position (all ≥1 game 1–14)');
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  const s = byPos[pos];
  console.log(
    `  ${pos} n=${s.n}  R² ADP/1–14/8–14 ${f(s.r2Adp)}/${f(s.r2_114)}/${f(s.r2_814)}` +
    `  IQR ADP/1–14/8–14 ${pts(s.widthAdp.meanIqr)}/${pts(s.width114.meanIqr)}/${pts(s.width814.meanIqr)}`,
  );
}
