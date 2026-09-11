/**
 * Compare Eat It While She Sleeper title odds across the UI knobs
 * I did not use on the 1M run (rank source + playoff format).
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.env.REACT_APP_SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');
process.env.DATA_DIR = join(ROOT, 'site', 'public', 'data');

const ITERATIONS = Number(process.argv[2]) || 15_000;
const TARGET_OWNER = 'givedaddyaspike';

function parseCsvRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) { result.push(current); current = ''; }
    else current += c;
  }
  result.push(current);
  return result;
}

function loadDashRankMap() {
  const text = readFileSync(
    join(ROOT, 'site', 'public', 'data', 'redraft_dash', 'dbb_custom_rankings.csv'),
    'utf8',
  );
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
  const idx = (name) => headers.indexOf(name);
  const rankMap = {};
  const maxByPos = {};
  for (const line of lines.slice(1)) {
    const cols = parseCsvRow(line);
    const sleeperId = (cols[idx('sleeper_id')] || '').trim();
    const position = (cols[idx('position')] || '').trim().toUpperCase();
    const name = (cols[idx('player')] || '').trim();
    const posRank = parseInt(cols[idx('pos_rank')], 10);
    if (!sleeperId || !['QB', 'RB', 'WR', 'TE'].includes(position) || !Number.isFinite(posRank)) continue;
    rankMap[sleeperId] = {
      rank: posRank,
      position,
      posRank,
      effRank: posRank,
      adp: parseFloat(cols[idx('rank')]) || posRank,
      name,
    };
    if (!maxByPos[position]) maxByPos[position] = { maxPosRank: 0, maxEffRank: 0 };
    maxByPos[position].maxPosRank = Math.max(maxByPos[position].maxPosRank, posRank);
    maxByPos[position].maxEffRank = Math.max(maxByPos[position].maxEffRank, posRank);
  }
  return { rankMap, maxByPos };
}

const { CURRENT_YEAR } = await import('../site/lib/mcp/config.mjs');
const { fetchRosters, fetchUsers } = await import('../site/lib/mcp/sleeperApi.mjs');
const { buildTeamMap } = await import('../site/lib/mcp/helpers.mjs');
const { loadSimulationInputs } = await import('../site/lib/mcp/simData.mjs');
const { prepareSimContext, runSeasonSim } = await import('../site/lib/mcp/simEngine.mjs');
const { loadPlayersData } = await import('../site/lib/mcp/dataLoader.mjs');

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
const eatIt = Object.values(teamMap).find((t) => (
  String(t.ownerName || '').toLowerCase() === TARGET_OWNER
  || String(t.teamName || '').toLowerCase().includes('eat it')
));
if (!eatIt) throw new Error('Could not find Eat It While She Sleeper');

const dash = loadDashRankMap();
const playersData = loadPlayersData();
const eatRoster = rosterMap[eatIt.roster.roster_id] || [];

console.log(`Eat It roster_id=${eatIt.roster.roster_id}  ${eatRoster.length} players`);
console.log('Skill-player ADP vs Dash pos ranks:');
for (const pid of eatRoster) {
  const p = playersData[pid];
  const pos = (p?.position || '').toUpperCase();
  if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
  const adp = inputs.hwangAdpRankMap[pid];
  const d = dash.rankMap[pid];
  const name = p?.full_name || pid;
  if (!adp && !d) continue;
  const adpLabel = adp ? `${adp.position}${adp.posRank}` : '—';
  const dashLabel = d ? `${d.position}${d.posRank}` : '—';
  const delta = (adp && d) ? (d.posRank - adp.posRank) : null;
  console.log(`  ${name.padEnd(22)} ADP ${adpLabel.padEnd(6)} Dash ${dashLabel.padEnd(6)}${delta != null ? `  Δ${delta > 0 ? '+' : ''}${delta}` : ''}`);
}

const configs = [
  { label: 'ADP + cumulative (what the 1M used)', rank: 'adp', format: 'cumulative' },
  { label: 'ADP + 2025 bracket', rank: 'adp', format: 'bracket' },
  { label: 'Redraft Dash + cumulative', rank: 'dash', format: 'cumulative' },
  { label: 'Redraft Dash + 2025 bracket', rank: 'dash', format: 'bracket' },
];

console.log(`\nRunning ${ITERATIONS.toLocaleString()} sims × ${configs.length} configs…`);
for (const cfg of configs) {
  const ctx = prepareSimContext({
    scenarioRosters: rosterMap,
    hwangAdpRankMap: cfg.rank === 'dash' ? dash.rankMap : inputs.hwangAdpRankMap,
    catalog: inputs.catalog,
    positionMaxRanks: cfg.rank === 'dash' ? dash.maxByPos : inputs.positionMaxRanks,
    basePointsByYear: inputs.basePointsByYear,
    playersData,
    playoffFormat: cfg.format,
  });
  const { results } = runSeasonSim(ctx, ITERATIONS, { uncapped: true, playoffFormat: cfg.format });
  const row = results.find((r) => r.rosterId === Number(eatIt.roster.roster_id));
  const top = results.slice(0, 4).map((r) => {
    const name = teamMap[r.rosterId]?.teamName || r.rosterId;
    return `${name} ${r.winPct.toFixed(1)}%`;
  }).join(' · ');
  console.log(`\n${cfg.label}`);
  console.log(`  Eat It  title ${row.winPct.toFixed(2)}%  playoff ${row.playoffPct.toFixed(1)}%  avg seed ${row.avgRegSeasonRank.toFixed(2)}  avg finish ${row.avgFinish.toFixed(2)}`);
  console.log(`  Top 4   ${top}`);
}
