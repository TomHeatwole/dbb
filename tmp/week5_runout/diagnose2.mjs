/**
 * Why is every team above the sim median? Check scoring, bye/zero rates,
 * and whether 2026 player weeks sit above their outcome-pool weeks 1–5.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.REACT_APP_SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');
process.env.DATA_DIR = join(ROOT, 'site', 'public', 'data');

const { fetchRosters, fetchMatchups } = await import('../../site/lib/mcp/sleeperApi.mjs');
const { loadSimulationInputs } = await import('../../site/lib/mcp/simData.mjs');
const { loadPlayersData } = await import('../../site/lib/mcp/dataLoader.mjs');
const {
  prepareSimContext,
  computePointsFromSleeperStats,
  computeOptimalWeekStarterTotal,
  buildPlayerPositionsMap,
} = await import('../../site/lib/mcp/simEngine.mjs');

const playersData = loadPlayersData();
const [rosters, inputs, matchups] = await Promise.all([
  fetchRosters(),
  loadSimulationInputs(),
  Promise.all([1, 2, 3, 4, 5].map((w) => fetchMatchups(w))),
]);

const rosterMap = {};
for (const r of rosters) rosterMap[r.roster_id] = (r.players || []).filter((id) => id && id !== '0');

const stats2026 = await Promise.all([1, 2, 3, 4, 5].map(async (week) => {
  const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/2026/${week}`);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}));

const ctx = prepareSimContext({
  scenarioRosters: rosterMap,
  hwangAdpRankMap: inputs.hwangAdpRankMap,
  catalog: inputs.catalog,
  positionMaxRanks: inputs.positionMaxRanks,
  basePointsByYear: inputs.basePointsByYear,
  playersData,
  variance: 'openTail',
  monotone: 'quantiles',
});

function actualPts(pid, wi) {
  const st = stats2026[wi]?.[pid];
  const pos = playersData?.[pid]?.position || '';
  return computePointsFromSleeperStats(st, pos, inputs.scoringConfig);
}

function poolWeekSums(pid) {
  const outcomes = ctx.outcomeWeekPts[pid] || [];
  const weights = ctx.pools[pid] || [];
  const rows = [];
  for (let i = 0; i < outcomes.length; i++) {
    const arr = outcomes[i];
    let sum = 0;
    const weeks = [];
    for (let w = 0; w < 5; w++) {
      const p = arr ? arr[w] : 0;
      weeks.push(p);
      sum += p;
    }
    rows.push({ sum, weeks, weight: weights[i]?.weight ?? 1, synthetic: !!weights[i]?.synthetic });
  }
  return rows;
}

function weightedQuantile(rows, q, pick) {
  const items = rows.map((r) => ({ v: pick(r), w: r.weight })).filter((x) => x.w > 0);
  items.sort((a, b) => a.v - b.v);
  const total = items.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  const target = q * total;
  for (const x of items) {
    acc += x.w;
    if (acc >= target) return x.v;
  }
  return items.length ? items[items.length - 1].v : 0;
}

function weightedMean(rows, pick) {
  let w = 0; let s = 0;
  for (const r of rows) {
    w += r.weight;
    s += r.weight * pick(r);
  }
  return w ? s / w : 0;
}

const skill = [];
for (const pid of ctx.allPlayerIds) {
  const pos = playersData?.[pid]?.position;
  if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
  const rows = poolWeekSums(pid);
  if (!rows.length) continue;
  const actual = [0, 1, 2, 3, 4].map((w) => actualPts(pid, w));
  const actualSum = actual.reduce((a, b) => a + b, 0);
  const med = weightedQuantile(rows, 0.5, (r) => r.sum);
  const mean = weightedMean(rows, (r) => r.sum);
  const realRows = rows.filter((r) => !r.synthetic);
  const realMed = realRows.length ? weightedQuantile(realRows, 0.5, (r) => r.sum) : null;
  skill.push({
    pid,
    name: playersData[pid]?.full_name || pid,
    pos,
    actual,
    actualSum,
    med,
    mean,
    realMed,
    rows,
  });
}

const relevant = skill.filter((p) => p.med >= 20);
const ratio = relevant.reduce((s, p) => s + p.actualSum / p.med, 0) / relevant.length;
const sumActual = relevant.reduce((s, p) => s + p.actualSum, 0);
const sumMed = relevant.reduce((s, p) => s + p.med, 0);
const sumRealMed = relevant.reduce((s, p) => s + (p.realMed || 0), 0);
console.log(`Relevant skill players (pool median w1-5 >= 20): ${relevant.length}`);
console.log(`Sum actual ${sumActual.toFixed(0)}  sum pool-median ${sumMed.toFixed(0)}  ratio ${(sumActual / sumMed).toFixed(3)}`);
console.log(`Sum real-only median ${sumRealMed.toFixed(0)}  actual/realMed ${(sumActual / sumRealMed).toFixed(3)}`);
console.log(`Unweighted mean of actual/median ratios ${ratio.toFixed(3)}`);

console.log('\nZero rate by week: actual rostered skill vs weighted pool (same players)');
for (let w = 0; w < 5; w++) {
  const actZero = skill.filter((p) => p.actual[w] === 0).length / skill.length;
  let zW = 0; let zS = 0;
  for (const p of skill) {
    for (const r of p.rows) {
      zW += r.weight;
      if (r.weeks[w] === 0) zS += r.weight;
    }
  }
  console.log(`  week ${w + 1}  actual zero ${(100 * actZero).toFixed(1)}%   pool zero ${(100 * zS / zW).toFixed(1)}%`);
}

console.log('\nNFL-wide zero rate among players who scored >8 in at least 3 of the 5 weeks');
function nflZero(statsWeeks) {
  const ids = new Set();
  for (const week of statsWeeks) {
    for (const pid of Object.keys(week || {})) {
      const pos = playersData?.[pid]?.position;
      if (['QB', 'RB', 'WR', 'TE'].includes(pos)) ids.add(pid);
    }
  }
  const lines = [];
  for (let w = 0; w < 5; w++) {
    let used = 0; let zero = 0;
    for (const pid of ids) {
      const pos = playersData[pid].position;
      const pts = statsWeeks.map((st) => computePointsFromSleeperStats(st?.[pid], pos, inputs.scoringConfig));
      const big = pts.filter((p) => p > 8).length;
      if (big < 3) continue;
      used += 1;
      if (pts[w] === 0) zero += 1;
    }
    lines.push({ used, zeroPct: used ? zero / used : 0 });
  }
  return lines;
}
const z2026 = nflZero(stats2026);
async function yearWeeks(year) {
  return Promise.all([1, 2, 3, 4, 5].map(async (week) => {
    const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${year}/${week}`);
    return res.ok ? res.json() : {};
  }));
}
for (const year of [2023, 2024, 2025]) {
  const stats = await yearWeeks(year);
  const z = nflZero(stats);
  console.log(`  ${year}: ` + z.map((r, i) => `w${i + 1} ${(100 * r.zeroPct).toFixed(1)}%`).join('  '));
}
console.log(`  2026: ` + z2026.map((r, i) => `w${i + 1} ${(100 * r.zeroPct).toFixed(1)}%`).join('  '));

// Median-week lineup vs actual sleeper, per team
console.log('\nIf every player posted their pool-median week (not a real lineup draw):');
const nameByRid = {};
for (const r of rosters) nameByRid[r.roster_id] = r.roster_id;
for (const rid of Object.keys(rosterMap)) {
  const list = rosterMap[rid];
  const positions = buildPlayerPositionsMap(list, playersData);
  let medTotal = 0;
  const weekPtsList = [0, 1, 2, 3, 4].map(() => ({}));
  for (const pid of list) {
    const rows = poolWeekSums(pid);
    for (let w = 0; w < 5; w++) {
      weekPtsList[w][pid] = rows.length ? weightedQuantile(rows, 0.5, (r) => r.weeks[w]) : 0;
    }
  }
  for (let w = 0; w < 5; w++) {
    medTotal += computeOptimalWeekStarterTotal(list, weekPtsList[w], positions, null);
  }
  const actual = (matchups).reduce((s, weekRows, wi) => {
    const row = (weekRows || []).find((x) => String(x.roster_id) === String(rid));
    return s + (Number(row?.points) || 0);
  }, 0);
  console.log(`  roster ${rid}  actual ${actual.toFixed(1)}  median-week lineup ${medTotal.toFixed(1)}  ratio ${(actual / medTotal).toFixed(3)}`);
}

console.log('\nHottest / coldest relevant players vs pool median');
const ranked = relevant.slice().sort((a, b) => (b.actualSum - b.med) - (a.actualSum - a.med));
for (const p of [...ranked.slice(0, 8), ...ranked.slice(-5)]) {
  console.log(
    `  ${p.pos} ${p.name}  actual ${p.actualSum.toFixed(1)}  poolMed ${p.med.toFixed(1)}  realMed ${(p.realMed || 0).toFixed(1)}  d ${(p.actualSum - p.med).toFixed(1)}`,
  );
}
