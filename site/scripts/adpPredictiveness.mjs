/**
 * How well does ADP predict season totals vs playoff (wk 15–17) totals?
 * Also: is 15–17 worse than a random 3-week slice (calendar effect)
 * or just worse because n=3 (sample-size effect)?
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

function r2(xs, ys) {
  const r = pearson(xs, ys);
  return r == null ? null : r * r;
}

function summarize(rows, xKey, yKey) {
  const xs = rows.map((r) => r[xKey]);
  const ys = rows.map((r) => r[yKey]);
  const rho = spearman(xs, ys);
  const r = pearson(xs, ys);
  return { n: rows.length, spearman: rho, pearson: r, r2: r == null ? null : r * r };
}

const { catalog, basePointsByYear } = await loadSimulationInputs();

const rows = [];
for (const e of catalog) {
  const weeks = basePointsByYear[String(e.seasonYear)];
  if (!weeks || weeks.length < 17) continue;
  const w = [];
  for (let i = 0; i < 17; i++) w.push(weeks[i]?.[e.sleeperId] ?? 0);
  const season = w.reduce((a, b) => a + b, 0);
  const reg = w.slice(0, 14).reduce((a, b) => a + b, 0);
  const po = w[14] + w[15] + w[16];
  // Three consecutive 3-week windows in the regular season (0-2, 1-3, … 11-13)
  const sliding = [];
  for (let s = 0; s <= 11; s++) sliding.push(w[s] + w[s + 1] + w[s + 2]);
  rows.push({
    position: e.position,
    year: e.seasonYear,
    effRank: e.effRank,
    logRank: Math.log(Math.max(e.effRank, 0.5)),
    season,
    reg,
    po,
    sliding,
  });
}

function pack(subset) {
  const season = summarize(subset, 'effRank', 'season');
  const reg = summarize(subset, 'effRank', 'reg');
  const po = summarize(subset, 'effRank', 'po');
  // Spearman of ADP vs each sliding 3-week window, then mean |ρ|
  const slideRhos = [];
  for (let s = 0; s <= 11; s++) {
    const tmp = subset.map((r) => ({ effRank: r.effRank, y: r.sliding[s] }));
    const sm = summarize(tmp, 'effRank', 'y');
    if (sm.spearman != null) slideRhos.push(sm.spearman);
  }
  const slideMean = slideRhos.reduce((a, b) => a + b, 0) / slideRhos.length;
  const slideMin = Math.min(...slideRhos);
  const slideMax = Math.max(...slideRhos);
  // Better ADP = lower rank, so correlations are negative. Report |ρ| as predictive strength.
  const abs = (s) => (s.spearman == null ? null : Math.abs(s.spearman));
  return {
    n: subset.length,
    seasonRho: abs(season),
    seasonR2: r2(subset.map((r) => r.logRank), subset.map((r) => r.season)),
    regRho: abs(reg),
    regR2: r2(subset.map((r) => r.logRank), subset.map((r) => r.reg)),
    poRho: abs(po),
    poR2: r2(subset.map((r) => r.logRank), subset.map((r) => r.po)),
    slideMeanRho: Math.abs(slideMean),
    slideMinRho: Math.abs(slideMax), // max of negative ρ is weakest; abs(max) = min strength
    slideMaxRho: Math.abs(slideMin), // min of negative ρ is strongest
    rawSeasonRho: season.spearman,
    rawPoRho: po.spearman,
    dropVsSeason: abs(season) && abs(po) ? 1 - abs(po) / abs(season) : null,
    dropVsReg: abs(reg) && abs(po) ? 1 - abs(po) / abs(reg) : null,
    dropVsSlide: abs(po) && slideMean ? 1 - abs(po) / Math.abs(slideMean) : null,
  };
}

const overall = pack(rows);
const byPos = {};
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  byPos[pos] = pack(rows.filter((r) => r.position === pos));
}
const byYear = {};
for (const y of [...new Set(rows.map((r) => r.year))].sort()) {
  byYear[y] = pack(rows.filter((r) => r.year === y));
}

// Top-24 only (starters / relevant ADP) — deep dart ranks add noise
const top24 = pack(rows.filter((r) => r.effRank <= 24));
const byPosTop24 = {};
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  byPosTop24[pos] = pack(rows.filter((r) => r.position === pos && r.effRank <= 24));
}

// Per sliding window so we can see if weeks 15-17 are an outlier among 3-week blocks
const windowRhos = [];
for (let s = 0; s <= 14; s++) {
  if (s > 14) break;
  const end = s + 2;
  if (end > 16) continue;
  const tmp = rows.map((r) => {
    const weeks = r.sliding; // only 0-11 defined
    let y;
    if (s <= 11) y = r.sliding[s];
    else if (s === 12) y = null;
    else y = r.po;
    return { effRank: r.effRank, y };
  }).filter((r) => r.y != null);
  // weeks 13-15 and 14-16 as extra mid/late windows
}
// Build explicit week-index windows 1-3, 2-4, ... 15-17
const namedWindows = [];
for (let start = 0; start <= 14; start++) {
  const tmp = [];
  for (const e of catalog) {
    const weeks = basePointsByYear[String(e.seasonYear)];
    if (!weeks) continue;
    let y = 0;
    for (let k = 0; k < 3; k++) y += weeks[start + k]?.[e.sleeperId] ?? 0;
    tmp.push({ effRank: e.effRank, y, position: e.position });
  }
  const sm = summarize(tmp, 'effRank', 'y');
  namedWindows.push({
    label: `W${start + 1}–${start + 3}`,
    start: start + 1,
    rho: sm.spearman == null ? null : Math.abs(sm.spearman),
    isPlayoff: start === 14,
  });
}

const out = { overall, byPos, byYear, top24, byPosTop24, namedWindows, n: rows.length };
writeFileSync('/tmp/adp_predict.json', JSON.stringify(out, null, 2));

function pct(x) { return x == null ? '—' : `${(100 * x).toFixed(0)}%`; }
function rho(x) { return x == null ? '—' : x.toFixed(3); }

console.log(`n=${rows.length} player-seasons\n`);
console.log('ALL ranks   |ρ| Spearman(ADP, points)   R²(log ADP, points)');
console.log(`  Full season     ρ=${rho(overall.seasonRho)}   R²=${rho(overall.seasonR2)}`);
console.log(`  Weeks 1–14      ρ=${rho(overall.regRho)}   R²=${rho(overall.regR2)}`);
console.log(`  Weeks 15–17     ρ=${rho(overall.poRho)}   R²=${rho(overall.poR2)}`);
console.log(`  Random 3-wk avg ρ=${rho(overall.slideMeanRho)}  (range ${rho(overall.slideMinRho)}–${rho(overall.slideMaxRho)})`);
console.log(`  Playoff drop vs season: ${pct(overall.dropVsSeason)}   vs 1–14: ${pct(overall.dropVsReg)}   vs random 3-wk: ${pct(overall.dropVsSlide)}`);

console.log('\nBy position (all ranks)');
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  const s = byPos[pos];
  console.log(
    `  ${pos} n=${s.n}  season ρ=${rho(s.seasonRho)}  po ρ=${rho(s.poRho)}  ` +
    `drop vs season ${pct(s.dropVsSeason)}  vs random3 ${pct(s.dropVsSlide)}`,
  );
}

console.log('\nTop-24 ADP only');
console.log(`  season ρ=${rho(top24.seasonRho)}  po ρ=${rho(top24.poRho)}  drop vs season ${pct(top24.dropVsSeason)}  vs random3 ${pct(top24.dropVsSlide)}`);
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  const s = byPosTop24[pos];
  console.log(
    `  ${pos} n=${s.n}  season ρ=${rho(s.seasonRho)}  po ρ=${rho(s.poRho)}  drop ${pct(s.dropVsSeason)}`,
  );
}

console.log('\nBy year');
for (const [y, s] of Object.entries(byYear)) {
  console.log(`  ${y}  season ρ=${rho(s.seasonRho)}  po ρ=${rho(s.poRho)}  drop ${pct(s.dropVsSeason)}`);
}

console.log('\n|ρ| by 3-week window (all positions)');
for (const w of namedWindows) {
  const mark = w.isPlayoff ? '  ← playoffs' : '';
  console.log(`  ${w.label}: ${rho(w.rho)}${mark}`);
}
