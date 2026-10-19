/**
 * Actual weeks 1–5 team totals vs the preseason full-season simulator's
 * weeks 1–5 distribution. One-off analysis.
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

const ITERATIONS = Number(process.argv[2] || 40000);
const WORKERS = Math.max(1, Math.min(8, (cpus()?.length || 2) - 1));

function splitIterations(total, workerCount) {
  const n = Math.min(workerCount, total);
  const base = Math.floor(total / n);
  const extra = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

function percentileRank(sorted, value) {
  const n = sorted.length;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  const below = lo;
  lo = below;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  const ties = lo - below;
  return (100 * (below + 0.5 * ties)) / n;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

const { fetchRosters, fetchUsers, fetchMatchups, fetchTransactions } = await import('../../site/lib/mcp/sleeperApi.mjs');
const { buildTeamMap } = await import('../../site/lib/mcp/helpers.mjs');
const { loadSimulationInputs } = await import('../../site/lib/mcp/simData.mjs');

console.log('Loading rosters, weeks 1–5 scores, sim inputs…');
const [rosters, users, inputs, weeks, txWeeks] = await Promise.all([
  fetchRosters(),
  fetchUsers(),
  loadSimulationInputs(),
  Promise.all([1, 2, 3, 4, 5].map((w) => fetchMatchups(w))),
  Promise.all([1, 2, 3, 4, 5, 6].map((w) => fetchTransactions(w).catch(() => []))),
]);

const teamMap = buildTeamMap(rosters, users);
const currentRoster = {};
for (const r of rosters) {
  if (r?.roster_id != null) currentRoster[Number(r.roster_id)] = [...(r.players || [])];
}

const actual = {};
const week1Roster = {};
for (const weekRows of weeks) {
  for (const row of weekRows || []) {
    const rid = Number(row.roster_id);
    if (!actual[rid]) actual[rid] = { weeks: [], playersByWeek: [] };
    actual[rid].weeks.push(Number(row.points) || 0);
    actual[rid].playersByWeek.push(row.players || null);
    if (!week1Roster[rid] && row.players) week1Roster[rid] = [...row.players];
  }
}

const trades = [];
for (let i = 0; i < txWeeks.length; i++) {
  for (const tx of txWeeks[i] || []) {
    if (tx?.type === 'trade' && tx.status === 'complete') {
      trades.push({ week: i + 1, rosterIds: tx.roster_ids, adds: tx.adds, drops: tx.drops });
    }
  }
}

function setDiff(a, b) {
  const bs = new Set((b || []).map(String));
  return (a || []).filter((id) => id && id !== '0' && !bs.has(String(id)));
}

console.log('\nRoster drift (current vs week-1 matchup players):');
for (const rid of Object.keys(teamMap).map(Number).sort((a, b) => a - b)) {
  const info = teamMap[rid];
  const added = setDiff(currentRoster[rid], week1Roster[rid]);
  const dropped = setDiff(week1Roster[rid], currentRoster[rid]);
  const weeks = actual[rid]?.weeks || [];
  const total = weeks.reduce((s, p) => s + p, 0);
  console.log(
    `  ${info.teamName}  w1-5=${total.toFixed(1)}  [${weeks.map((p) => p.toFixed(1)).join(', ')}]`
      + `  +${added.length} -${dropped.length}`,
  );
}
console.log(`Completed trades weeks 1–6: ${trades.length}`);
for (const t of trades) {
  console.log(`  week ${t.week} rosters ${t.rosterIds?.join(',')}`);
}

// Preseason composition: week-1 matchup player list when present, else current.
const scenarioRosters = {};
for (const rid of Object.keys(currentRoster)) {
  scenarioRosters[rid] = week1Roster[rid]?.length ? week1Roster[rid] : currentRoster[rid];
}

function runWorker(payload) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_PATH, {
      workerData: { siteSettings: SITE_SETTINGS, dataDir: DATA_DIR },
    });
    worker.on('message', (msg) => {
      if (msg?.type === 'ready') {
        const { onProgress, ...cloneable } = payload;
        worker.postMessage(cloneable);
        return;
      }
      if (msg?.type === 'progress') {
        payload.onProgress?.(msg.progress);
        return;
      }
      if (msg?.type === 'done') {
        settled = true;
        resolve(msg);
        worker.terminate();
      }
    });
    worker.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    worker.on('exit', (code) => {
      if (!settled && code !== 0) reject(new Error(`worker exited ${code}`));
    });
  });
}

const chunks = splitIterations(ITERATIONS, WORKERS);
console.log(`\nRunning ${ITERATIONS.toLocaleString()} full-season sims across ${chunks.length} workers…`);
const progress = Array.from({ length: chunks.length }, () => 0);
let lastPct = -1;
const started = Date.now();
const batches = await Promise.all(chunks.map((n, workerIndex) => runWorker({
  scenarioRosters,
  hwangAdpRankMap: inputs.hwangAdpRankMap,
  catalog: inputs.catalog,
  positionMaxRanks: inputs.positionMaxRanks,
  basePointsByYear: inputs.basePointsByYear,
  variance: 'openTail',
  monotone: 'quantiles',
  iterations: n,
  onProgress: (p) => {
    progress[workerIndex] = p;
    const weighted = chunks.reduce((sum, c, i) => sum + c * progress[i], 0) / ITERATIONS;
    const pct = Math.floor(weighted * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      const elapsed = (Date.now() - started) / 1000;
      process.stdout.write(`\r  ${pct}%  ${elapsed.toFixed(0)}s   `);
    }
  },
})));
process.stdout.write('\n');

const merged5 = {};
const merged14 = {};
for (const batch of batches) {
  for (const [rid, pack] of Object.entries(batch.samples)) {
    if (!merged5[rid]) { merged5[rid] = []; merged14[rid] = []; }
    merged5[rid].push(...pack.w5);
    merged14[rid].push(...pack.w14);
  }
}

const rows = Object.keys(teamMap).map(Number).map((rid) => {
  const weeks = actual[rid]?.weeks || [];
  const total = weeks.reduce((s, p) => s + p, 0);
  const ppg5 = total / 5;
  const ppg14 = (merged14[rid] || []).map((v) => v / 14).sort((a, b) => a - b);
  const ppg5sim = merged5[rid] || [];
  const sim5mean = ppg5sim.reduce((s, v) => s + v, 0) / (ppg5sim.length || 1) / 5;
  const sim14mean = ppg14.reduce((s, v) => s + v, 0) / (ppg14.length || 1);
  const ratio = sim5mean / sim14mean;
  return {
    rosterId: rid,
    team: teamMap[rid].teamName,
    actual: Math.round(total * 10) / 10,
    ppg5,
    sim14p50: quantile(ppg14, 0.5),
    sim14mean,
    sim5mean,
    ratio,
    pct: percentileRank(ppg14, ppg5),
    pctPace: percentileRank(ppg14, ppg5 / ratio),
  };
});
const byScore = rows.slice().sort((a, b) => b.actual - a.actual);
byScore.forEach((r, i) => { r.place = i + 1; });
const struct = rows.reduce((s, r) => s + r.sim5mean, 0) / rows.reduce((s, r) => s + r.sim14mean, 0);
console.log(`\nSim's own weeks 1-5 PPG / 14-week PPG = ${struct.toFixed(3)}`);
console.log('Pct = actual 5-week avg inside the 14-week avg distribution');
console.log('Pace = same, after each team\'s own early-season premium in the sim\n');
const header = ['Place', 'Team', '5wk avg', '14wk p50', 'Pct', 'Pace'];
const body = byScore.map((r) => [
  String(r.place),
  r.team,
  r.ppg5.toFixed(1),
  r.sim14p50.toFixed(1),
  r.pct.toFixed(1),
  r.pctPace.toFixed(1),
]);
const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
const fmt = (cells) => cells.map((c, i) => String(c)[i === 1 ? 'padEnd' : 'padStart'](widths[i])).join('  ');
console.log(fmt(header));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const row of body) console.log(fmt(row));
