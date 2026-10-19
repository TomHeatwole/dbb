import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.REACT_APP_SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');
process.env.DATA_DIR = join(ROOT, 'site', 'public', 'data');

const { LEAGUE_ID } = await import('../../site/lib/mcp/config.mjs');
const { loadScoringConfig } = await import('../../site/lib/mcp/simData.mjs');
const { loadPlayersData } = await import('../../site/lib/mcp/dataLoader.mjs');
const {
  computePointsFromSleeperStats,
  computeOptimalWeekStarterTotal,
  buildPlayerPositionsMap,
} = await import('../../site/lib/mcp/simEngine.mjs');
const { fetchMatchups, fetchRosters } = await import('../../site/lib/mcp/sleeperApi.mjs');

const league = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`).then((r) => r.json());
const s = league.scoring_settings || {};
const recKeys = Object.keys(s).filter((k) => /rec|bonus|fum|pass_td|pass_yd/.test(k)).sort();
console.log('League scoring (rec/bonus/pass subset):');
for (const k of recKeys) console.log(`  ${k}: ${s[k]}`);

const config = loadScoringConfig();
console.log('\nscore_format.json receptions:', config.scoring.receptions, config.position_specific_scoring?.receptions);

const pprConfig = structuredClone(config);
pprConfig.scoring.receptions = 1;
pprConfig.position_specific_scoring = {
  ...pprConfig.position_specific_scoring,
  receptions: { QB: 1, RB: 1, WR: 1, TE: 1.5, FB: 1 },
};

const playersData = loadPlayersData();
const rosters = await fetchRosters();
const rosterMap = {};
for (const r of rosters) rosterMap[r.roster_id] = r.players || [];

async function weekStats(week) {
  const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/2026/${week}`);
  if (!res.ok) throw new Error(`stats ${week} ${res.status}`);
  return res.json();
}

const weeks = await Promise.all([1, 2, 3, 4, 5].map(weekStats));
const matchups = await Promise.all([1, 2, 3, 4, 5].map((w) => fetchMatchups(w)));

function scoreWeek(playerList, stats, cfg) {
  const weekPts = {};
  let recs = 0;
  let teRecs = 0;
  for (const pid of playerList) {
    const st = stats[pid];
    const pos = playersData?.[pid]?.position || '';
    weekPts[pid] = computePointsFromSleeperStats(st, pos, cfg);
  }
  const positions = buildPlayerPositionsMap(playerList, playersData);
  const total = computeOptimalWeekStarterTotal(playerList, weekPts, positions, null);
  // receptions among players who scored, rough: recompute starters by taking top — skip, just all rostered recs is wrong.
  // Count recs on players with points in the optimal set by re-running a greedy via sorting weekPts.
  return { total, weekPts, positions };
}

console.log('\nWeek-by-week: Sleeper points vs our scorer (file config) vs 1.0/1.5 PPR');
const sums = { sleeper: 0, file: 0, ppr: 0 };
for (let wi = 0; wi < 5; wi++) {
  let sl = 0; let file = 0; let ppr = 0;
  for (const row of matchups[wi]) {
    const list = rosterMap[row.roster_id] || row.players || [];
    const a = scoreWeek(list, weeks[wi], config);
    const b = scoreWeek(list, weeks[wi], pprConfig);
    sl += Number(row.points) || 0;
    file += a.total;
    ppr += b.total;
    if (wi === 0 && row.roster_id === 4) {
      console.log(`\nseanjcrow week 1 sleeper=${row.points} file=${a.total.toFixed(1)} ppr=${b.total.toFixed(1)}`);
    }
  }
  sums.sleeper += sl; sums.file += file; sums.ppr += ppr;
  console.log(
    `  week ${wi + 1}  league sleeper=${sl.toFixed(1)}  file-config=${file.toFixed(1)}  ppr=${ppr.toFixed(1)}`
      + `  sleeper-file=${(sl - file).toFixed(1)}  sleeper-ppr=${(sl - ppr).toFixed(1)}`,
  );
}
console.log(
  `  TOTAL sleeper=${sums.sleeper.toFixed(1)} file=${sums.file.toFixed(1)} ppr=${sums.ppr.toFixed(1)}`
    + ` gapFile=${(sums.sleeper - sums.file).toFixed(1)} gapPpr=${(sums.sleeper - sums.ppr).toFixed(1)}`,
);

// Historical week coverage: mean skill-player points by week for 2024 using file config, from already-fetched? fetch 2024.
console.log('\n2024 vs 2026 mean points of players with >=1 snap-ish (pts>0), file config, by week');
const y2024 = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(async (week) => {
  const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/2024/${week}`);
  return res.ok ? res.json() : null;
}));
function meanPositive(stats, cfg) {
  let n = 0; let sum = 0; let rec = 0; let recN = 0;
  for (const [pid, st] of Object.entries(stats || {})) {
    const pos = playersData?.[pid]?.position;
    if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
    const pts = computePointsFromSleeperStats(st, pos, cfg);
    if (pts > 0) { n += 1; sum += pts; }
    if ((st.rec || 0) > 0) { rec += st.rec; recN += 1; }
  }
  return { n, mean: n ? sum / n : 0, recMean: recN ? rec / recN : 0 };
}
for (let wi = 0; wi < 5; wi++) {
  const a = meanPositive(y2024[wi], pprConfig);
  const b = meanPositive(weeks[wi], pprConfig);
  console.log(`  week ${wi + 1}  2024 mean ${a.mean.toFixed(2)} (n=${a.n})  2026 mean ${b.mean.toFixed(2)} (n=${b.n})  ratio ${(b.mean / a.mean).toFixed(3)}`);
}
