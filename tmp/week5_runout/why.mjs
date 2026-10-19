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
  buildOutcomePool,
  materializeOutcomeWeeks,
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

// Catalog season total vs materialized weeks 1–17.
let catN = 0; let catCsv = 0; let catWk = 0; let catZero = 0;
const byPos = {};
for (const e of inputs.catalog) {
  const yearWeeks = inputs.basePointsByYear[String(e.seasonYear)];
  let sum = 0;
  for (let w = 0; w < 17; w++) sum += yearWeeks?.[w]?.[e.sleeperId] || 0;
  catN += 1;
  catCsv += e.scoringPts;
  catWk += sum;
  if (sum === 0) catZero += 1;
  if (!byPos[e.position]) byPos[e.position] = { n: 0, csv: 0, wk: 0, zero: 0 };
  byPos[e.position].n += 1;
  byPos[e.position].csv += e.scoringPts;
  byPos[e.position].wk += sum;
  if (sum === 0) byPos[e.position].zero += 1;
}
console.log(`Catalog seasons ${catN}  weekly1-17/csv ${(catWk / catCsv).toFixed(3)}  zero-week-sum ${catZero}`);
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  const r = byPos[pos];
  console.log(`  ${pos} n=${r.n} weekly/csv ${(r.wk / r.csv).toFixed(3)} zeroSums ${r.zero}`);
}

// Pool composition and player-level real vs synthetic weeks 1–5.
let wReal = 0; let wSyn = 0; let sumReal = 0; let sumSyn = 0; let nPlayers = 0; let empty = 0;
let varReal = 0; let varSyn = 0; let varNReal = 0; let varNSyn = 0;
for (const pid of ctx.allPlayerIds) {
  const pool = ctx.pools[pid] || [];
  if (!pool.length) { empty += 1; continue; }
  nPlayers += 1;
  for (let i = 0; i < pool.length; i++) {
    const o = pool[i];
    const arr = ctx.outcomeWeekPts[pid][i];
    let s = 0;
    const weeks = [];
    for (let w = 0; w < 5; w++) { weeks.push(arr[w]); s += arr[w]; }
    const mean = s / 5;
    let v = 0;
    for (const x of weeks) v += (x - mean) ** 2;
    v /= 5;
    const wt = o.weight ?? 1;
    if (o.synthetic) { wSyn += wt; sumSyn += wt * s; varSyn += wt * v; varNSyn += wt; }
    else { wReal += wt; sumReal += wt * s; varReal += wt * v; varNReal += wt; }
  }
}
console.log(`\nRostered players with a pool ${nPlayers}  empty ${empty}`);
console.log(`Weight real ${(wReal / (wReal + wSyn)).toFixed(3)} synthetic ${(wSyn / (wReal + wSyn)).toFixed(3)}`);
console.log(`Mean w1-5 total  real ${(sumReal / wReal).toFixed(1)}  synthetic ${(sumSyn / wSyn).toFixed(1)}  ratio ${((sumSyn / wSyn) / (sumReal / wReal)).toFixed(3)}`);
console.log(`Mean within-player week variance  real ${(varReal / varNReal).toFixed(2)}  synthetic ${(varSyn / varNSyn).toFixed(2)}`);

// Actual lineup vs pool means of those same starters.
let actualStarterPts = 0; let poolMeanOfActualStarters = 0; let realMeanOfActualStarters = 0;
let emptyStarterPts = 0;
for (let wi = 0; wi < 5; wi++) {
  for (const row of matchups[wi]) {
    const starters = row.starters || [];
    for (const pid of starters) {
      if (!pid || pid === '0') continue;
      const pts = actualPts(pid, wi);
      actualStarterPts += pts;
      const pool = ctx.pools[pid] || [];
      if (!pool.length) { emptyStarterPts += pts; continue; }
      let wt = 0; let sm = 0; let rwt = 0; let rsm = 0;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i].weight ?? 1;
        const p = ctx.outcomeWeekPts[pid][i][wi];
        wt += w; sm += w * p;
        if (!pool[i].synthetic) { rwt += w; rsm += w * p; }
      }
      poolMeanOfActualStarters += wt ? sm / wt : 0;
      realMeanOfActualStarters += rwt ? rsm / rwt : 0;
    }
  }
}
console.log(`\nActual starter points ${actualStarterPts.toFixed(1)}`);
console.log(`Pool-mean of those starters ${poolMeanOfActualStarters.toFixed(1)}  ratio ${(actualStarterPts / poolMeanOfActualStarters).toFixed(3)}`);
console.log(`Real-only mean of those starters ${realMeanOfActualStarters.toFixed(1)}  ratio ${(actualStarterPts / realMeanOfActualStarters).toFixed(3)}`);
console.log(`Starter points from players with no pool ${emptyStarterPts.toFixed(1)}`);

// Real-outcome-only Monte Carlo of team weeks 1–5.
function weightedPick(pool) {
  let total = 0;
  for (const o of pool) if (!o.synthetic) total += o.weight ?? 1;
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    if (pool[i].synthetic) continue;
    r -= pool[i].weight ?? 1;
    if (r <= 0) return i;
  }
  for (let i = pool.length - 1; i >= 0; i--) if (!pool[i].synthetic) return i;
  return 0;
}

const N = 2000;
const teamSums = {};
for (const rid of Object.keys(rosterMap)) teamSums[rid] = 0;
const chosen = {};
for (let iter = 0; iter < N; iter++) {
  const weekPts = [{}, {}, {}, {}, {}];
  const seasonTotals = {};
  for (const pid of ctx.allPlayerIds) {
    const pool = ctx.pools[pid];
    if (!pool?.length) continue;
    const idx = weightedPick(pool);
    const arr = ctx.outcomeWeekPts[pid][idx];
    let tot = 0;
    for (let w = 0; w < 17; w++) tot += arr[w];
    seasonTotals[pid] = tot;
    for (let w = 0; w < 5; w++) weekPts[w][pid] = arr[w];
  }
  for (const rid of Object.keys(rosterMap)) {
    const list = rosterMap[rid];
    const positions = buildPlayerPositionsMap(list, playersData);
    let s = 0;
    for (let w = 0; w < 5; w++) {
      s += computeOptimalWeekStarterTotal(list, weekPts[w], positions, seasonTotals);
    }
    teamSums[rid] += s;
  }
}
let realMc = 0; let actual = 0;
console.log(`\nReal-outcome-only team means (${N} draws) vs actual`);
for (const rid of Object.keys(rosterMap)) {
  const mean = teamSums[rid] / N;
  const act = matchups.reduce((s, rows) => s + (Number(rows.find((r) => String(r.roster_id) === String(rid))?.points) || 0), 0);
  realMc += mean;
  actual += act;
  console.log(`  roster ${rid}  real-mc ${mean.toFixed(1)}  actual ${act.toFixed(1)}  ratio ${(act / mean).toFixed(3)}`);
}
console.log(`LEAGUE real-mc ${realMc.toFixed(1)}  actual ${actual.toFixed(1)}  ratio ${(actual / realMc).toFixed(3)}`);
