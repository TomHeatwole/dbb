/**
 * Backtest: rebuild the preseason simulator for a past season and see where
 * that season's real weeks 1–5 (and 1–14) landed in the sim distribution.
 *
 *   node tmp/week5_runout/backtest.mjs 2025 [iterations]
 */
import { readFileSync } from 'fs';
import { cpus } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'worker.mjs');
const SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');
const DATA_DIR = join(ROOT, 'site', 'public', 'data');
process.env.REACT_APP_SITE_SETTINGS = SITE_SETTINGS;
process.env.DATA_DIR = DATA_DIR;

const SEASON = Number(process.argv[2] || 2025);
const ITERATIONS = Number(process.argv[3] || 20000);
const WORKERS = Math.max(1, Math.min(8, (cpus()?.length || 2) - 1));

const { fetchMatchups, fetchUsers, fetchRosters } = await import('../../site/lib/mcp/sleeperApi.mjs');
const { buildTeamMap } = await import('../../site/lib/mcp/helpers.mjs');
const {
  loadHwangAdpRankMap, loadHwangPositionMaxRanks, loadOutcomeCatalog,
  loadScoringConfig, loadBasePointsByYear,
} = await import('../../site/lib/mcp/simData.mjs');
const { loadPlayersData } = await import('../../site/lib/mcp/dataLoader.mjs');
const {
  prepareSimContext, computePointsFromSleeperStats,
} = await import('../../site/lib/mcp/simEngine.mjs');

function percentileRank(sorted, value) {
  let below = 0; let ties = 0;
  for (const v of sorted) {
    if (v < value) below += 1;
    else if (v === value) ties += 1;
  }
  return (100 * (below + 0.5 * ties)) / sorted.length;
}
function quantile(sorted, q) {
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx); const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}
function mean(arr) { return arr.reduce((s, v) => s + v, 0) / (arr.length || 1); }
function sd(arr) { const m = mean(arr); return Math.sqrt(mean(arr.map((v) => (v - m) ** 2))); }

console.log(`Season ${SEASON}: loading week-1 rosters, weekly scores, sim inputs…`);
const playersData = loadPlayersData();
const scoringConfig = loadScoringConfig();
const hwangAdpRankMap = loadHwangAdpRankMap(SEASON);
const positionMaxRanks = loadHwangPositionMaxRanks(SEASON);
const { years, catalog } = loadOutcomeCatalog(SEASON, playersData);
const neededIds = new Set(catalog.map((e) => e.sleeperId));
const [basePointsByYear, matchups, users, rosters] = await Promise.all([
  loadBasePointsByYear(years, neededIds, scoringConfig, playersData),
  Promise.all(Array.from({ length: 14 }, (_, i) => fetchMatchups(i + 1, SEASON))),
  fetchUsers(SEASON),
  fetchRosters(SEASON),
]);
console.log(`Comp years ${years.join(',')}  catalog seasons ${catalog.length}  ADP tags ${Object.keys(hwangAdpRankMap).length}`);

const teamMap = buildTeamMap(rosters, users);
const week1Roster = {};
const weekly = {};
for (let wi = 0; wi < 14; wi++) {
  for (const row of matchups[wi] || []) {
    const rid = Number(row.roster_id);
    if (wi === 0) week1Roster[rid] = (row.players || []).filter((id) => id && id !== '0');
    if (!weekly[rid]) weekly[rid] = [];
    weekly[rid][wi] = Number(row.points) || 0;
  }
}
const rosterIds = Object.keys(week1Roster).map(Number).sort((a, b) => a - b);

// Tag coverage for the rostered players
let tagged = 0; let untagged = 0; const untaggedNames = [];
for (const rid of rosterIds) {
  for (const pid of week1Roster[rid]) {
    const pos = playersData?.[pid]?.position;
    if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
    if (hwangAdpRankMap[pid]) tagged += 1;
    else { untagged += 1; if (untaggedNames.length < 12) untaggedNames.push(playersData[pid]?.full_name || pid); }
  }
}
console.log(`Rostered skill players with ADP tag ${tagged}, without ${untagged}  e.g. ${untaggedNames.join(', ')}`);

// Player-level: actual weeks 1–5 vs pool weighted mean, for tagged players
const stats = await Promise.all([1, 2, 3, 4, 5].map(async (w) => {
  const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${SEASON}/${w}`);
  return res.ok ? res.json() : {};
}));
const ctx = prepareSimContext({
  scenarioRosters: week1Roster, hwangAdpRankMap, catalog, positionMaxRanks,
  basePointsByYear, playersData, variance: 'openTail', monotone: 'quantiles',
});
let actSum = 0; let poolMeanSum = 0; let poolMedSum = 0; let nPlayers = 0;
let untaggedActual = 0;
for (const pid of ctx.allPlayerIds) {
  const pos = playersData?.[pid]?.position;
  if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
  let act = 0;
  for (let w = 0; w < 5; w++) act += computePointsFromSleeperStats(stats[w]?.[pid], pos, scoringConfig);
  const pool = ctx.pools[pid] || [];
  if (!pool.length) { untaggedActual += act; continue; }
  let wt = 0; let sm = 0; const items = [];
  for (let i = 0; i < pool.length; i++) {
    const w = pool[i].weight ?? 1;
    let s = 0;
    for (let k = 0; k < 5; k++) s += ctx.outcomeWeekPts[pid][i][k];
    wt += w; sm += w * s; items.push({ v: s, w });
  }
  items.sort((a, b) => a.v - b.v);
  let acc = 0; let med = 0;
  for (const it of items) { acc += it.w; if (acc >= wt / 2) { med = it.v; break; } }
  actSum += act; poolMeanSum += sm / wt; poolMedSum += med; nPlayers += 1;
}
console.log(`\nPlayer level (tagged, n=${nPlayers}): actual w1-5 ${actSum.toFixed(0)}  pool mean ${poolMeanSum.toFixed(0)}  ratio ${(actSum / poolMeanSum).toFixed(3)}  (vs pool median ${(actSum / poolMedSum).toFixed(3)})`);
console.log(`Untagged skill players scored ${untaggedActual.toFixed(0)} in w1-5 (sim gives them 0)`);

function runWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData: { siteSettings: SITE_SETTINGS, dataDir: DATA_DIR } });
    worker.on('message', (msg) => {
      if (msg?.type === 'ready') worker.postMessage(payload);
      else if (msg?.type === 'done') { resolve(msg); worker.terminate(); }
    });
    worker.on('error', reject);
  });
}
const n = Math.min(WORKERS, ITERATIONS);
const chunks = Array.from({ length: n }, (_, i) => Math.floor(ITERATIONS / n) + (i < ITERATIONS % n ? 1 : 0));
console.log(`\nRunning ${ITERATIONS} preseason-${SEASON} sims…`);
const batches = await Promise.all(chunks.map((iterations) => runWorker({
  scenarioRosters: week1Roster, hwangAdpRankMap, catalog, positionMaxRanks, basePointsByYear,
  variance: 'openTail', monotone: 'quantiles', iterations,
})));
const sim5 = {}; const sim14 = {};
for (const b of batches) {
  for (const [rid, pack] of Object.entries(b.samples)) {
    (sim5[rid] ||= []).push(...pack.w5);
    (sim14[rid] ||= []).push(...pack.w14);
  }
}

let leagueAct5 = 0; let leagueSim5 = 0; let leagueAct14 = 0; let leagueSim14 = 0;
const rows = rosterIds.map((rid) => {
  const s5 = sim5[rid].sort((a, b) => a - b);
  const s14 = sim14[rid].sort((a, b) => a - b);
  const act5 = weekly[rid].slice(0, 5).reduce((a, b) => a + b, 0);
  const act14 = weekly[rid].slice(0, 14).reduce((a, b) => a + b, 0);
  leagueAct5 += act5; leagueSim5 += mean(s5); leagueAct14 += act14; leagueSim14 += mean(s14);
  return {
    team: teamMap[rid]?.teamName || `Roster ${rid}`,
    act5, sim5p50: quantile(s5, 0.5), sim5sd: sd(s5), pct5: percentileRank(s5, act5),
    act14, sim14p50: quantile(s14, 0.5), pct14: percentileRank(s14, act14),
  };
}).sort((a, b) => b.act5 - a.act5);

console.log(`\n${SEASON} weeks 1–5: league actual ${leagueAct5.toFixed(0)}  sim mean ${leagueSim5.toFixed(0)}  ratio ${(leagueAct5 / leagueSim5).toFixed(3)}`);
console.log(`${SEASON} weeks 1–14: league actual ${leagueAct14.toFixed(0)}  sim mean ${leagueSim14.toFixed(0)}  ratio ${(leagueAct14 / leagueSim14).toFixed(3)}  (rosters drift over 14 weeks)`);
console.log('\nTeam                        act5   sim5 p50  sim5 sd   pct5 |  act14  sim14 p50  pct14');
for (const r of rows) {
  console.log(`${r.team.padEnd(26)} ${r.act5.toFixed(1).padStart(7)} ${r.sim5p50.toFixed(1).padStart(9)} ${r.sim5sd.toFixed(1).padStart(8)} ${r.pct5.toFixed(1).padStart(6)} | ${r.act14.toFixed(1).padStart(7)} ${r.sim14p50.toFixed(1).padStart(9)} ${r.pct14.toFixed(1).padStart(6)}`);
}
const pcts = rows.map((r) => r.pct5);
console.log(`\npct5 mean ${mean(pcts).toFixed(1)}  (calibrated sim: ~50)   above 50: ${pcts.filter((p) => p > 50).length}/${pcts.length}`);
