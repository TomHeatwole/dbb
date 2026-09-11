import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.env.REACT_APP_SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');
process.env.DATA_DIR = join(ROOT, 'site', 'public', 'data');

const ITERATIONS = Number(process.argv[2]) || 10_000;

const { fetchRosters, fetchUsers } = await import('../site/lib/mcp/sleeperApi.mjs');
const { buildTeamMap } = await import('../site/lib/mcp/helpers.mjs');
const { loadSimulationInputs } = await import('../site/lib/mcp/simData.mjs');
const { prepareSimContext, runSeasonSim } = await import('../site/lib/mcp/simEngine.mjs');

const [rosters, users, inputs] = await Promise.all([
  fetchRosters(),
  fetchUsers(),
  loadSimulationInputs(),
]);
const teamMap = buildTeamMap(rosters, users);
const rosterMap = {};
for (const r of rosters) {
  if (r?.roster_id != null) rosterMap[Number(r.roster_id)] = [...(r.players || [])];
}
const eatIt = Object.values(teamMap).find((t) => String(t.ownerName || '').toLowerCase() === 'givedaddyaspike');
const eatId = Number(eatIt.roster.roster_id);

const configs = [
  { variance: 'low', monotone: 'quantiles' },
  { variance: 'openTail', monotone: 'quantiles' },
  { variance: 'medium', monotone: 'quantiles' },
  { variance: 'high', monotone: 'quantiles' },
  { variance: 'openTail', monotone: 'medianPool' },
];

console.log(`${ITERATIONS} runs, Eat It = ${eatIt.teamName}`);
for (const cfg of configs) {
  const ctx = prepareSimContext({
    scenarioRosters: rosterMap,
    hwangAdpRankMap: inputs.hwangAdpRankMap,
    catalog: inputs.catalog,
    positionMaxRanks: inputs.positionMaxRanks,
    basePointsByYear: inputs.basePointsByYear,
    playersData: inputs.playersData,
    variance: cfg.variance,
    monotone: cfg.monotone,
  });
  const { results } = runSeasonSim(ctx, ITERATIONS, { uncapped: true });
  const row = results.find((r) => r.rosterId === eatId);
  console.log(`${cfg.variance.padEnd(10)} ${cfg.monotone.padEnd(12)} title ${row.winPct.toFixed(2)}%  playoff ${row.playoffPct.toFixed(1)}%`);
}
