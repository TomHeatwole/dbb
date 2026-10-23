/**
 * Actual weeks 1–5 vs pool mean, by position and ADP tier, for a season.
 *   node tmp/week5_runout/tiers.mjs 2026
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.REACT_APP_SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');
process.env.DATA_DIR = join(ROOT, 'site', 'public', 'data');
const SEASON = Number(process.argv[2] || 2026);

const { fetchMatchups } = await import('../../site/lib/mcp/sleeperApi.mjs');
const {
  loadHwangAdpRankMap, loadHwangPositionMaxRanks, loadOutcomeCatalog,
  loadScoringConfig, loadBasePointsByYear,
} = await import('../../site/lib/mcp/simData.mjs');
const { loadPlayersData } = await import('../../site/lib/mcp/dataLoader.mjs');
const { prepareSimContext, computePointsFromSleeperStats } = await import('../../site/lib/mcp/simEngine.mjs');

const playersData = loadPlayersData();
const scoringConfig = loadScoringConfig();
const hwangAdpRankMap = loadHwangAdpRankMap(SEASON);
const positionMaxRanks = loadHwangPositionMaxRanks(SEASON);
const { years, catalog } = loadOutcomeCatalog(SEASON, playersData);
const neededIds = new Set(catalog.map((e) => e.sleeperId));
const [basePointsByYear, week1, stats] = await Promise.all([
  loadBasePointsByYear(years, neededIds, scoringConfig, playersData),
  fetchMatchups(1, SEASON),
  Promise.all([1, 2, 3, 4, 5].map(async (w) => {
    const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${SEASON}/${w}`);
    return res.ok ? res.json() : {};
  })),
]);
const rosters = {};
for (const row of week1) rosters[row.roster_id] = (row.players || []).filter((id) => id && id !== '0');

const ctx = prepareSimContext({
  scenarioRosters: rosters, hwangAdpRankMap, catalog, positionMaxRanks,
  basePointsByYear, playersData, variance: 'openTail', monotone: 'quantiles',
});

const tiers = [[1, 6, 'ADP 1-6'], [7, 12, 'ADP 7-12'], [13, 24, 'ADP 13-24'], [25, 999, 'ADP 25+']];
const agg = {};
function bump(key, act, exp) {
  const a = (agg[key] ||= { n: 0, act: 0, exp: 0 });
  a.n += 1; a.act += act; a.exp += exp;
}
for (const pid of ctx.allPlayerIds) {
  const pos = playersData?.[pid]?.position;
  if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
  const pool = ctx.pools[pid] || [];
  if (!pool.length) continue;
  let act = 0;
  for (let w = 0; w < 5; w++) act += computePointsFromSleeperStats(stats[w]?.[pid], pos, scoringConfig);
  let wt = 0; let sm = 0;
  for (let i = 0; i < pool.length; i++) {
    const w = pool[i].weight ?? 1;
    let s = 0;
    for (let k = 0; k < 5; k++) s += ctx.outcomeWeekPts[pid][i][k];
    wt += w; sm += w * s;
  }
  const exp = sm / wt;
  const rank = hwangAdpRankMap[pid].posRank || hwangAdpRankMap[pid].rank;
  const tier = tiers.find(([lo, hi]) => rank >= lo && rank <= hi)?.[2] || 'ADP 25+';
  bump(`${pos}`, act, exp);
  bump(`${pos} ${tier}`, act, exp);
  bump('ALL', act, exp);
  bump(`ALL ${tier}`, act, exp);
}
console.log(`${SEASON}: actual weeks 1–5 vs pool mean (tagged rostered skill players)`);
const order = Object.keys(agg).sort();
for (const key of order) {
  const a = agg[key];
  console.log(`  ${key.padEnd(14)} n=${String(a.n).padStart(3)}  actual ${a.act.toFixed(0).padStart(5)}  pool ${a.exp.toFixed(0).padStart(5)}  ratio ${(a.act / a.exp).toFixed(3)}  per-player diff ${((a.act - a.exp) / a.n).toFixed(1)}`);
}
