/**
 * Run the actual browser Season Simulator functions (not the MCP port)
 * and compare Eat It While She Sleeper against the Node/MCP path.
 *
 *   npx tsx scripts/run_browser_sim_eat_it.mjs [iterations]
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'site', 'public', 'data');
const ITERATIONS = Math.max(500, Math.round(Number(process.argv[2]) || 3000));

process.env.REACT_APP_SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');
process.env.DATA_DIR = DATA;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const href = typeof url === 'string' ? url : url?.url;
  if (typeof href === 'string' && href.startsWith('/')) {
    const filePath = join(ROOT, 'site', 'public', href);
    if (!existsSync(filePath)) {
      return { ok: false, status: 404, text: async () => '', json: async () => null };
    }
    const text = readFileSync(filePath, 'utf8');
    return {
      ok: true,
      status: 200,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  }
  return realFetch(url, opts);
};

const {
  prepareSimulatorContext,
  runMonteCarloSimulationSync,
} = await import('../site/src/scenarios/simulatorMonteCarloCore.js');
const { loadCurrentHwangAdpRankMap, loadHwangPositionMaxRanks } = await import('../site/src/scenarios/hwangAdpLoader.js');
const { loadHistoricalOutcomeCatalog, getOutcomeHistoryYears } = await import('../site/src/scenarios/historicalOutcomeData.js');
const { fetchMultipleWeeksStats } = await import('../site/src/data_parse/weeklyStatsLoader.js');
const { DEFAULT_VARIANCE, DEFAULT_MONOTONE, buildOutcomePool } = await import('../site/src/scenarios/outcomeDistribution.js');
const { DEFAULT_PLAYOFF_FORMAT } = await import('../site/src/scenarios/playoffStandings.js');
const { CURRENT_YEAR } = await import('../site/lib/mcp/config.mjs');
const { fetchRosters, fetchUsers } = await import('../site/lib/mcp/sleeperApi.mjs');
const { buildTeamMap } = await import('../site/lib/mcp/helpers.mjs');
const { loadPlayersData } = await import('../site/lib/mcp/dataLoader.mjs');
const mcp = await import('../site/lib/mcp/simData.mjs');
const { prepareSimContext, runSeasonSim, buildOutcomePool: mcpBuildPool } = await import('../site/lib/mcp/simEngine.mjs');

const playersData = loadPlayersData();
const scoringConfig = JSON.parse(readFileSync(join(DATA, 'score_format.json'), 'utf8'));
const [rosters, users, adpMap, maxRanks, catalogPack] = await Promise.all([
  fetchRosters(),
  fetchUsers(),
  loadCurrentHwangAdpRankMap(CURRENT_YEAR),
  loadHwangPositionMaxRanks(CURRENT_YEAR),
  loadHistoricalOutcomeCatalog(Number(CURRENT_YEAR), playersData),
]);

const teamMap = buildTeamMap(rosters, users);
const rosterMap = {};
for (const r of rosters) {
  if (r?.roster_id != null) rosterMap[Number(r.roster_id)] = [...(r.players || [])];
}
const eatIt = Object.values(teamMap).find((t) => String(t.ownerName || '').toLowerCase() === 'givedaddyaspike');
const eatId = Number(eatIt.roster.roster_id);
const eatRoster = rosterMap[eatId] || [];

const yearsNeeded = getOutcomeHistoryYears(Number(CURRENT_YEAR));
const allWeeks = Array.from({ length: 17 }, (_, i) => i + 1);
const weeklyStatsByYear = {};
await Promise.all(yearsNeeded.map(async (year) => {
  const raw = await fetchMultipleWeeksStats(year, allWeeks, 0).catch(() => null);
  weeklyStatsByYear[String(year)] = raw
    ? Array.from({ length: 17 }, (_, i) => raw[i + 1] || null)
    : Array.from({ length: 17 }, () => null);
}));

const mcpInputs = await mcp.loadSimulationInputs();

console.log(`Season ${CURRENT_YEAR}  browser catalog ${catalogPack.catalog.length}  MCP catalog ${mcpInputs.catalog.length}`);
console.log(`Eat It roster_id=${eatId}  ${eatRoster.length} players\n`);
console.log('Player pools (browser UI functions vs MCP port):');
console.log('name                     ADP/tag         brwN  brwMed   mcpN  mcpMed');

for (const pid of eatRoster) {
  const p = playersData[pid];
  const pos = (p?.position || '').toUpperCase();
  if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
  const uiAdp = adpMap[pid];
  const mcpAdp = mcpInputs.hwangAdpRankMap[pid];
  const uiPool = uiAdp
    ? buildOutcomePool(uiAdp, catalogPack.catalog, maxRanks, { variance: DEFAULT_VARIANCE, monotone: DEFAULT_MONOTONE })
    : [];
  const mcpPool = mcpAdp
    ? mcpBuildPool(mcpAdp, mcpInputs.catalog, mcpInputs.positionMaxRanks, { variance: DEFAULT_VARIANCE, monotone: DEFAULT_MONOTONE })
    : [];
  const med = (pool) => {
    if (!pool.length) return null;
    const pts = pool.map((o) => o.scoringPts).sort((a, b) => a - b);
    return pts[Math.floor(pts.length / 2)];
  };
  const name = (p?.full_name || pid).slice(0, 22).padEnd(22);
  const tag = uiAdp ? `${uiAdp.position}${uiAdp.posRank}${uiAdp.effRank != null && uiAdp.effRank !== uiAdp.posRank ? `/${Number(uiAdp.effRank).toFixed(1)}` : ''}` : 'UNRANKED';
  const tagM = mcpAdp ? `${mcpAdp.position}${mcpAdp.posRank}` : 'UNRANKED';
  if (tag !== tagM.replace(/\/.*/, '')) {
    // keep both visible if they differ
  }
  console.log(
    `${name} ${(tag + (tag !== tagM ? ` vs ${tagM}` : '')).padEnd(16)} ${String(uiPool.length).padStart(4)} ${String(med(uiPool) ?? '—').padStart(7)}  ${String(mcpPool.length).padStart(4)} ${String(med(mcpPool) ?? '—').padStart(7)}`,
  );
}

console.log(`\nRunning BROWSER engine ${ITERATIONS.toLocaleString()} iterations (UI defaults)…`);
const uiCtx = prepareSimulatorContext({
  scenarioRosters: rosterMap,
  hwangAdpRankMap: adpMap,
  catalog: catalogPack.catalog,
  positionMaxRanks: maxRanks,
  weeklyStatsByYear,
  scoringConfig,
  playersData,
  variance: DEFAULT_VARIANCE,
  monotone: DEFAULT_MONOTONE,
  playoffFormat: DEFAULT_PLAYOFF_FORMAT,
});
const uiStarted = Date.now();
const uiOut = runMonteCarloSimulationSync(uiCtx, { iterations: ITERATIONS, lightweight: true });
console.log(`browser done in ${((Date.now() - uiStarted) / 1000).toFixed(1)}s`);

console.log(`Running MCP engine ${ITERATIONS.toLocaleString()} iterations…`);
const mcpCtx = prepareSimContext({
  scenarioRosters: rosterMap,
  hwangAdpRankMap: mcpInputs.hwangAdpRankMap,
  catalog: mcpInputs.catalog,
  positionMaxRanks: mcpInputs.positionMaxRanks,
  basePointsByYear: mcpInputs.basePointsByYear,
  playersData,
  variance: DEFAULT_VARIANCE,
  monotone: DEFAULT_MONOTONE,
});
const mcpStarted = Date.now();
const mcpOut = runSeasonSim(mcpCtx, ITERATIONS, { uncapped: true });
console.log(`MCP done in ${((Date.now() - mcpStarted) / 1000).toFixed(1)}s\n`);

function printTable(label, results) {
  console.log(label);
  for (const [i, row] of results.entries()) {
    const name = teamMap[row.rosterId]?.teamName || row.rosterId;
    const mark = row.rosterId === eatId ? '  <— Eat It' : '';
    console.log(
      `  ${String(i + 1).padStart(2)}. ${String(name).padEnd(26)} title ${row.winPct.toFixed(1)}%  playoff ${row.playoffPct.toFixed(1)}%  avg14 ${row.avgRegSeason.toFixed(1)}${mark}`,
    );
  }
}

printTable('BROWSER UI engine', uiOut.results);
console.log('');
printTable('MCP / Node port', mcpOut.results);

const uiEat = uiOut.results.find((r) => r.rosterId === eatId);
const mcpEat = mcpOut.results.find((r) => r.rosterId === eatId);
console.log('\nEat It delta (browser − MCP):');
console.log(`  title    ${uiEat.winPct.toFixed(2)}% vs ${mcpEat.winPct.toFixed(2)}%  (${(uiEat.winPct - mcpEat.winPct).toFixed(2)} pp)`);
console.log(`  playoff  ${uiEat.playoffPct.toFixed(2)}% vs ${mcpEat.playoffPct.toFixed(2)}%  (${(uiEat.playoffPct - mcpEat.playoffPct).toFixed(2)} pp)`);
console.log(`  avg 14wk ${uiEat.avgRegSeason.toFixed(1)} vs ${mcpEat.avgRegSeason.toFixed(1)}`);
