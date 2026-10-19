import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.REACT_APP_SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');
process.env.DATA_DIR = join(ROOT, 'site', 'public', 'data');

const { fetchRosters, fetchUsers } = await import('../../site/lib/mcp/sleeperApi.mjs');
const { buildTeamMap } = await import('../../site/lib/mcp/helpers.mjs');
const { loadSimulationInputs } = await import('../../site/lib/mcp/simData.mjs');
const { loadPlayersData } = await import('../../site/lib/mcp/dataLoader.mjs');
const {
  prepareSimContext,
  computePointsFromSleeperStats,
} = await import('../../site/lib/mcp/simEngine.mjs');

const DATA = join(ROOT, 'site/public/data');
const playersData = loadPlayersData();
const [rosters, users, inputs] = await Promise.all([
  fetchRosters(),
  fetchUsers(),
  loadSimulationInputs(),
]);
const teamMap = buildTeamMap(rosters, users);
const rosterMap = {};
for (const r of rosters) rosterMap[r.roster_id] = (r.players || []).filter((id) => id && id !== '0');

const stats = await Promise.all([1, 2, 3, 4, 5].map(async (week) => {
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

function actualSum(pid) {
  let s = 0;
  const weeks = [];
  for (let w = 0; w < 5; w++) {
    const p = computePointsFromSleeperStats(stats[w]?.[pid], playersData?.[pid]?.position || '', inputs.scoringConfig);
    weeks.push(p);
    s += p;
  }
  return { s, weeks };
}

function poolPercentile(pid, value) {
  const pool = ctx.pools[pid] || [];
  if (!pool.length) return null;
  let below = 0; let ties = 0; let wt = 0;
  for (let i = 0; i < pool.length; i++) {
    const w = pool[i].weight ?? 1;
    let sum = 0;
    for (let k = 0; k < 5; k++) sum += ctx.outcomeWeekPts[pid][i][k];
    wt += w;
    if (sum < value) below += w;
    else if (sum === value) ties += w;
  }
  return (100 * (below + 0.5 * ties)) / wt;
}

function poolMedian(pid) {
  const pool = ctx.pools[pid] || [];
  const items = [];
  for (let i = 0; i < pool.length; i++) {
    if (pool[i].synthetic) continue;
    let sum = 0;
    for (let k = 0; k < 5; k++) sum += ctx.outcomeWeekPts[pid][i][k];
    items.push({ v: sum, w: pool[i].weight ?? 1 });
  }
  items.sort((a, b) => a.v - b.v);
  const total = items.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of items) {
    acc += x.w;
    if (acc >= 0.5 * total) return x.v;
  }
  return null;
}

function norm(name) {
  return (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function loadKtcDate(date) {
  const values = new Map();
  const lines = readFileSync(join(DATA, 'sf_ktc_values_historical.csv'), 'utf8').split('\n');
  const prefix = `${date},`;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith(prefix)) continue;
    const cols = line.split(',');
    const sid = (cols[4] || '').trim();
    const val = Number(cols[2]);
    if (sid && val > 0) values.set(sid, val);
  }
  const rank = new Map();
  [...values.entries()].sort((a, b) => b[1] - a[1]).forEach(([sid], i) => rank.set(sid, i + 1));
  return { values, rank };
}
const preKtc = loadKtcDate('2026-09-09');
const nowKtc = loadKtcDate('2026-10-16');

const FOCUS = [7, 5];
for (const rid of FOCUS) {
  const info = teamMap[rid];
  console.log(`\n=== ${info.teamName} ===`);
  const rows = [];
  for (const pid of rosterMap[rid]) {
    const pos = playersData?.[pid]?.position;
    if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
    const name = playersData[pid]?.full_name || pid;
    const { s, weeks } = actualSum(pid);
    const med = poolMedian(pid);
    const pct = poolPercentile(pid, s);
    const adp = inputs.hwangAdpRankMap[pid];
    const preV = preKtc.values.get(String(pid));
    const nowV = nowKtc.values.get(String(pid));
    rows.push({
      name,
      pos,
      adp: adp ? `${adp.position}${adp.posRank || adp.rank}` : '—',
      actual: s,
      med,
      pct,
      preV: preV ?? null,
      preR: preKtc.rank.get(String(pid)) ?? null,
      nowV: nowV ?? null,
      nowR: nowKtc.rank.get(String(pid)) ?? null,
      weeks,
    });
  }
  rows.sort((a, b) => (b.preV || 0) - (a.preV || 0));
  console.log('player                     pos  adp    pts   comp  scr%   ktc9/9  rnk  ktc10/16  rnk  drank');
  let preSum = 0; let nowSum = 0; let wScore = 0; let wDen = 0;
  for (const r of rows) {
    if ((r.preV || 0) < 2500 && r.actual < 20) continue;
    if (r.preV) {
      preSum += r.preV;
      nowSum += r.nowV || 0;
      if (r.pct != null) { wScore += r.preV * r.pct; wDen += r.preV; }
    }
    const dRank = r.preR && r.nowR ? r.nowR - r.preR : null;
    console.log(
      `${r.name.padEnd(26)} ${r.pos.padEnd(3)} ${String(r.adp).padEnd(6)} ${r.actual.toFixed(1).padStart(6)} ${(r.med == null ? '—' : r.med.toFixed(1)).padStart(6)} ${(r.pct == null ? '—' : r.pct.toFixed(0)).padStart(5)} ${String(r.preV ?? '—').padStart(8)} ${String(r.preR ?? '—').padStart(4)} ${String(r.nowV ?? '—').padStart(9)} ${String(r.nowR ?? '—').padStart(4)} ${dRank == null ? '—' : (dRank > 0 ? '+' : '') + dRank}`,
    );
  }
  console.log(`Sep 9 KTC sum ${preSum}  Oct 16 ${nowSum}  ${(100 * (nowSum / preSum - 1)).toFixed(1)}%`);
  console.log(`KTC-weighted scoring percentile ${(wScore / wDen).toFixed(1)}`);
}
