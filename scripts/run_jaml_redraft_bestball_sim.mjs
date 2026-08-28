/**
 * JAML redraft bestball Monte Carlo — 10k seasons.
 *
 * Format: half-PPR, 1QB / 2RB / 3WR / 1TE / 1FLEX / 1SF. Ignores K/P/DST.
 * Outcome ranges: Redraft Dash positional ranks (dbb_custom_rankings.csv),
 * mapped onto the existing historical Hwang-ADP outcome catalog.
 * Weekly points: Sleeper pts_half_ppr.
 *
 * Usage (from repo root):
 *   node scripts/run_jaml_redraft_bestball_sim.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'site/public/data');
const CACHE_DIR = join(ROOT, '/tmp/jaml_bb_sim_cache'.replace('/tmp/', 'tmp/'));
const ITERATIONS = 10_000;

// Must set before importing site/lib/mcp/config.mjs (reads STARTER slots at import).
const SITE_SETTINGS = {
  LEAGUE_ID: 'jaml-redraft-sim',
  PREVIOUS_YEARS: { 2024: 'x', 2025: 'y' }, // CURRENT_YEAR => 2026
  SEASON_START_DATE: '09/04',
  STARTER_POSITION_NAMES: ['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'WR3', 'TE1', 'FLEX1', 'SUPER'],
};
process.env.REACT_APP_SITE_SETTINGS = JSON.stringify(SITE_SETTINGS);
process.env.DATA_DIR = DATA_DIR;

const {
  prepareSimContext,
  runSeasonSim,
  buildHistoricalPositionRanks,
} = await import('../site/lib/mcp/simEngine.mjs');
const { loadPlayersData } = await import('../site/lib/mcp/dataLoader.mjs');

// ── CSV / name helpers ────────────────────────────────────────────────────────

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitRow(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitRow(line);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}
function splitRow(line) {
  const cells = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i += 1; }
      else q = !q;
    } else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}
function norm(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// ── Draft board (skill only — no K/P/DST) ─────────────────────────────────────

const DRAFT = {
  1: { name: 'CIZ', players: [
    'Josh Allen', 'Malik Nabers', 'Saquon Barkley', 'Jordan Love', 'George Pickens',
    'Quinshon Judkins', 'Terry McLaurin', 'Dallas Goedert', 'Jaylen Warren', 'Aaron Jones',
    'Michael Wilson', 'Deebo Samuel', 'Bryce Young', 'Dontayvion Wicks', 'Chuba Hubbard',
    'Isaiah Likely',
  ]},
  2: { name: 'MIKE', players: [
    'Jahmyr Gibbs', 'Caleb Williams', 'James Cook', 'Bo Nix', 'Kyren Williams',
    'Garrett Wilson', 'Tetairoa McMillan', 'Rome Odunze', 'Malik Willis', 'Quentin Johnston',
    'Jordan Mason', 'Khalil Shakir', 'Travis Kelce', 'KC Concepcion', 'Malik Washington',
    'Jaylin Noel',
  ]},
  3: { name: 'BRACK', players: [
    'Bijan Robinson', 'Justin Jefferson', 'Dak Prescott', 'Chris Olave', 'Breece Hall',
    'Travis Etienne', 'Jameson Williams', 'DK Metcalf', 'Jadarian Price', 'Daniel Jones',
    'Sam Darnold', 'Jayden Reed', 'Sam LaPorta', 'Harold Fannin', 'Chris Rodriguez',
    'Jalen Coker',
  ]},
  4: { name: 'Aidan', players: [
    "Ja'Marr Chase", 'Ashton Jeanty', 'Trevor Lawrence', 'Brock Purdy', 'Trey McBride',
    'Tee Higgins', 'Bucky Irving', 'Cam Skattebo', 'Courtland Sutton', 'Michael Pittman',
    'Alec Pierce', 'Kenneth Gainwell', 'Xavier Worthy', 'Geno Smith', 'Zach Charbonnet',
    'Kenyon Sadiq', 'Mark Andrews',
  ]},
  5: { name: 'Drew', players: [
    'Puka Nacua', 'Jonathan Taylor', 'Derrick Henry', 'Rashee Rice', 'Patrick Mahomes',
    'Josh Jacobs', 'Davante Adams', 'Kyler Murray', 'Baker Mayfield', 'Matthew Golden',
    'CJ Stroud', 'JK Dobbins', 'Kyle Pitts', 'Rashid Shaheed', 'Jakobi Meyers',
  ]},
  6: { name: 'CAM', players: [
    'Lamar Jackson', 'CeeDee Lamb', 'Kenneth Walker', 'Matthew Stafford', 'Colston Loveland',
    'Mike Evans', 'David Montgomery', 'Rhamondre Stevenson', 'Marvin Harrison', 'Jordan Addison',
    'Makai Lemon', 'Tony Pollard', 'Aaron Rodgers', 'Keenan Allen', 'Jaydon Blue',
    'Devaughn Vele',
  ]},
  7: { name: 'Davis', players: [
    'Jaxon Smith-Njigba', 'Justin Herbert', 'Chase Brown', 'Nico Collins', 'Devonta Smith',
    'Javonte Williams', "D'Andre Swift", 'Tyler Shough', 'Tucker Kraft', 'Brian Thomas',
    'Jacory Croskey-Merritt', 'Jordyn Tyson', 'Jacoby Brissett', 'Rachaad White',
    'Juwan Johnson', 'Romeo Doubs',
  ]},
  8: { name: 'Alex', players: [
    'Amon-Ra St. Brown', 'Joe Burrow', 'Omarion Hampton', 'Drake London', 'Zay Flowers',
    'Tyler Warren', 'Luther Burden', 'Jared Goff', 'TreVeyon Henderson', 'Josh Downs',
    'Kyle Monangai', 'Cam Ward', 'RJ Harvey', 'MarShawn Lloyd', 'Dalton Kincaid',
    'Michael Penix',
  ]},
  9: { name: 'Andrew', players: [
    'Drake Maye', 'Jalen Hurts', 'Brock Bowers', "De'Von Achane", 'Emeka Egbuka',
    'Ladd McConkey', 'Parker Washington', 'Christian Watson', 'Jonathon Brooks',
    'Stefon Diggs', 'Rico Dowdle', 'DeZhaun Stribling', 'Fernando Mendoza',
    'Keaton Mitchell', 'Jonah Coleman', 'Nicholas Singleton',
  ]},
  10: { name: 'TOM', players: [
    'Jayden Daniels', 'Christian McCaffrey', 'AJ Brown', 'Jaxson Dart', 'Jeremiyah Love',
    'Jaylen Waddle', 'DJ Moore', 'Bhayshul Tuten', 'Chris Godwin', 'Carnell Tate',
    'Blake Corum', 'George Kittle', "Wan'Dale Robinson", 'Tua Tagovailoa', 'Tyjae Spears',
    'Jake Ferguson',
  ]},
};

// Aliases for fuzzy board / sleeper matching
const ALIASES = {
  marvinharrison: 'marvinharrisonjr',
  michaelpittman: 'michaelpittmanjr',
  patrickmahomes: 'patrickmahomesii',
  travisetienne: 'travisetiennejr',
  chrisgodwin: 'chrisgodwinjr',
  brianthomas: 'brianthomasjr',
  lutherburden: 'lutherburdeniii',
  kennethwalker: 'kennethwalkeriii',
  haroldfannin: 'haroldfanninjr',
  chrisrodriguez: 'chrisrodriguezjr',
  michaelpenix: 'michaelpenixjr',
  ajbrown: 'ajbrown',
  dkmetcalf: 'dkmetcalf',
};

// ── Load players + dash ranks ─────────────────────────────────────────────────

console.log('Loading players + Redraft Dash ranks…');
const playersData = loadPlayersData();

const boardRows = parseCsv(readFileSync(join(ROOT, 'dbbp/redraft-dash/dbb_custom_rankings.csv'), 'utf8'));
const dashBySleeper = new Map();
const dashByName = new Map();
for (const r of boardRows) {
  const pos = (r.position || '').toUpperCase();
  if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
  const posRank = Number(r.pos_rank);
  if (!Number.isFinite(posRank) || posRank < 1) continue;
  const entry = {
    name: r.player,
    position: pos,
    posRank,
    rank: posRank,
    effRank: posRank,
    adp: Number(r.rank) || posRank,
    sleeperId: (r.sleeper_id || '').trim(),
  };
  if (entry.sleeperId) dashBySleeper.set(entry.sleeperId, entry);
  dashByName.set(norm(r.player), entry);
}

// Build sleeper name index from players.json
const sleeperByName = new Map();
for (const [pid, p] of Object.entries(playersData || {})) {
  const pos = (p.position || '').toUpperCase();
  if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
  const full = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
  if (!full) continue;
  const key = norm(full);
  // Prefer active / more recent
  const prev = sleeperByName.get(key);
  if (!prev || (p.active && !prev.active) || (p.team && !prev.team)) {
    sleeperByName.set(key, { pid: String(pid), name: full, position: pos, active: !!p.active, team: p.team });
  }
}

function resolvePlayer(name) {
  const key = norm(name);
  const alias = ALIASES[key] || key;
  // Prefer dash board sleeper id
  const dash = dashByName.get(key) || dashByName.get(alias);
  if (dash?.sleeperId) {
    return { pid: dash.sleeperId, name: dash.name, position: dash.position, via: 'dash' };
  }
  // Direct sleeper name
  let hit = sleeperByName.get(key) || sleeperByName.get(alias);
  if (hit) return { pid: hit.pid, name: hit.name, position: hit.position, via: 'sleeper' };
  // Partial: last name + first initial / includes
  const candidates = [];
  for (const [nk, v] of sleeperByName.entries()) {
    if (nk.includes(key) || key.includes(nk)) candidates.push(v);
  }
  if (candidates.length === 1) {
    return { pid: candidates[0].pid, name: candidates[0].name, position: candidates[0].position, via: 'fuzzy' };
  }
  return null;
}

const rosterMap = {};
const teamNames = {};
const unmatched = [];
const matched = [];
for (const [rid, team] of Object.entries(DRAFT)) {
  teamNames[rid] = team.name;
  const pids = [];
  for (const name of team.players) {
    const hit = resolvePlayer(name);
    if (!hit) {
      unmatched.push({ team: team.name, name });
      continue;
    }
    pids.push(hit.pid);
    matched.push({ team: team.name, name, ...hit });
  }
  rosterMap[rid] = [...new Set(pids)];
}

console.log(`Matched ${matched.length} players; unmatched ${unmatched.length}`);
if (unmatched.length) {
  console.log('Unmatched (will contribute 0):');
  for (const u of unmatched) console.log(`  ${u.team}: ${u.name}`);
}

// Rank map from dash for every rostered skill player
const hwangAdpRankMap = {};
const positionMaxRanks = { QB: { maxPosRank: 0, maxEffRank: 0 }, RB: { maxPosRank: 0, maxEffRank: 0 }, WR: { maxPosRank: 0, maxEffRank: 0 }, TE: { maxPosRank: 0, maxEffRank: 0 } };
for (const row of boardRows) {
  const pos = (row.position || '').toUpperCase();
  if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
  const posRank = Number(row.pos_rank);
  if (!Number.isFinite(posRank)) continue;
  positionMaxRanks[pos].maxPosRank = Math.max(positionMaxRanks[pos].maxPosRank, posRank);
  positionMaxRanks[pos].maxEffRank = Math.max(positionMaxRanks[pos].maxEffRank, posRank);
}
for (const m of matched) {
  const dash = dashBySleeper.get(m.pid) || dashByName.get(norm(m.name));
  if (!dash) continue;
  hwangAdpRankMap[m.pid] = {
    rank: dash.posRank,
    position: dash.position,
    posRank: dash.posRank,
    effRank: dash.posRank,
    adp: dash.adp,
    name: dash.name,
  };
}
const rankedCount = Object.keys(hwangAdpRankMap).length;
console.log(`Dash-ranked rostered players: ${rankedCount}`);

// ── Outcome catalog (historical Hwang ADP seasons — same as site engine) ──────

function loadHwangRows() {
  const text = readFileSync(join(DATA_DIR, 'hwang_adjusted_positional_adp.csv'), 'utf8');
  const rows = parseCsv(text);
  const byYear = new Map();
  for (const r of rows) {
    const year = Number(r.year);
    const sleeperId = (r.sleeper_id || '').trim();
    const position = (r.position || '').trim();
    const hwangAdp = Number(r.hwang_adjusted_adp);
    if (!Number.isFinite(year) || !sleeperId || !position || !Number.isFinite(hwangAdp)) continue;
    const posRank = r.hwang_pos_rank ? Number(r.hwang_pos_rank) : null;
    const effRank = r.hwang_eff_rank ? Number(r.hwang_eff_rank) : posRank;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({ year, sleeperId, position, posRank, effRank, adp: hwangAdp, name: r.name });
  }
  return byYear;
}

const CURRENT_YEAR = 2026;
const historyYears = [];
for (let y = CURRENT_YEAR - 5; y <= CURRENT_YEAR - 1; y += 1) historyYears.push(y);

console.log(`Building outcome catalog for years ${historyYears.join(', ')}…`);
const hwangByYear = loadHwangRows();
const catalog = [];
for (const year of historyYears) {
  let csvText;
  try {
    csvText = readFileSync(join(DATA_DIR, `stats_player_reg_${year}.csv`), 'utf8');
  } catch {
    console.warn(`  missing stats_player_reg_${year}.csv — skip`);
    continue;
  }
  const posRanks = buildHistoricalPositionRanks(csvText, playersData);
  const scoringPtsLookup = {};
  const outcomeRankLookup = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    outcomeRankLookup[pos] = {};
    (posRanks[pos] || []).forEach((entry, idx) => {
      outcomeRankLookup[pos][entry.sleeperId] = idx + 1;
      scoringPtsLookup[entry.sleeperId] = entry.scoringPts;
    });
  }
  for (const row of (hwangByYear.get(year) || [])) {
    if (!['QB', 'RB', 'WR', 'TE'].includes(row.position)) continue;
    const scoringPts = scoringPtsLookup[row.sleeperId];
    if (scoringPts == null || scoringPts <= 0) continue;
    const effRank = row.effRank ?? row.posRank;
    if (effRank == null) continue;
    catalog.push({
      sleeperId: row.sleeperId,
      seasonYear: year,
      position: row.position,
      adpRank: row.posRank,
      effRank,
      scoringPts,
      outcomeRank: outcomeRankLookup[row.position][row.sleeperId] || null,
    });
  }
}
console.log(`Catalog size: ${catalog.length}`);

// ── Half-PPR weekly points from Sleeper (cached) ──────────────────────────────

async function fetchYearWeeks(year) {
  const cachePath = join(CACHE_DIR, `sleeper_weeks_${year}.json`);
  if (existsSync(cachePath)) {
    console.log(`  cache hit ${year}`);
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  }
  console.log(`  fetching Sleeper weeks for ${year}…`);
  const weeks = [];
  for (let w = 1; w <= 17; w += 1) {
    const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${year}/${w}`);
    if (!res.ok) { weeks.push(null); continue; }
    weeks.push(await res.json());
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(weeks));
  return weeks;
}

function buildHalfPprBasePoints(rawWeeks, neededIds) {
  return Array.from({ length: 17 }, (_, weekIdx) => {
    const weekStats = rawWeeks?.[weekIdx];
    if (!weekStats || typeof weekStats !== 'object') return {};
    const weekPts = {};
    for (const [pid, stats] of Object.entries(weekStats)) {
      if (neededIds && !neededIds.has(pid)) continue;
      if (!stats || typeof stats !== 'object') continue;
      const pts = stats.pts_half_ppr;
      if (pts == null || !Number.isFinite(Number(pts))) continue;
      weekPts[pid] = Number(pts);
    }
    return weekPts;
  });
}

const neededIds = new Set(catalog.map((e) => e.sleeperId));
const basePointsByYear = {};
for (const year of historyYears) {
  const raw = await fetchYearWeeks(year);
  basePointsByYear[String(year)] = buildHalfPprBasePoints(raw, neededIds);
}

// ── Run sim ───────────────────────────────────────────────────────────────────

console.log(`Preparing sim context (slots: ${SITE_SETTINGS.STARTER_POSITION_NAMES.join(', ')})…`);
const ctx = prepareSimContext({
  scenarioRosters: rosterMap,
  hwangAdpRankMap,
  catalog,
  positionMaxRanks,
  basePointsByYear,
  playersData,
  variance: 'medium',
  monotone: 'quantiles',
});

// Pool coverage report
let emptyPools = 0;
for (const pid of ctx.allPlayerIds) {
  if (!(ctx.pools[pid] || []).length) emptyPools += 1;
}
console.log(`Players with empty outcome pools: ${emptyPools}/${ctx.allPlayerIds.length}`);

console.log(`Running ${ITERATIONS.toLocaleString()} seasons (2×5k batches; engine max is 5k/call)…`);
const t0 = Date.now();
const batchA = runSeasonSim(ctx, 5000);
const batchB = runSeasonSim(ctx, 5000);
const ran = batchA.iterations + batchB.iterations;

function mergeResults(a, b) {
  const byId = new Map(a.map((r) => [r.rosterId, { ...r }]));
  for (const r of b) {
    const cur = byId.get(r.rosterId);
    if (!cur) { byId.set(r.rosterId, { ...r }); continue; }
    cur.winPct = (cur.winPct + r.winPct) / 2;
    cur.playoffPct = (cur.playoffPct + r.playoffPct) / 2;
    cur.avgFinish = (cur.avgFinish + r.avgFinish) / 2;
    cur.avgTotalScore = (cur.avgTotalScore + r.avgTotalScore) / 2;
    cur.avgRegSeasonScore = ((cur.avgRegSeasonScore || 0) + (r.avgRegSeasonScore || 0)) / 2;
  }
  return [...byId.values()];
}
const results = mergeResults(batchA.results, batchB.results);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

results.sort((a, b) => b.winPct - a.winPct || a.avgFinish - b.avgFinish);

console.log('\n===== JAML REDRAFT BESTBALL — 10,000 seasons =====');
console.log('Half-PPR · 1QB 2RB 3WR 1TE 1FLEX 1SF · Redraft Dash ranks for outcome ranges');
console.log('rank  team            title%  playoff%  avgFin  avgPts');
results.forEach((row, i) => {
  const name = teamNames[row.rosterId] || `Team ${row.rosterId}`;
  console.log(
    `${String(i + 1).padStart(2)}    ${name.padEnd(14)}  ` +
    `${row.winPct.toFixed(1).padStart(5)}  ${row.playoffPct.toFixed(1).padStart(7)}  ` +
    `${row.avgFinish.toFixed(2).padStart(6)}  ` +
    `${Math.round(row.avgTotalScore).toString().padStart(6)}`,
  );
});

// Per-team unranked skill count
console.log('\nUnranked skill players (contribute 0 in sim):');
for (const [rid, pids] of Object.entries(rosterMap)) {
  const missing = [];
  for (const pid of pids) {
    if (hwangAdpRankMap[pid]) continue;
    const p = playersData[pid];
    const nm = p?.full_name || pid;
    const pos = (p?.position || '').toUpperCase();
    if (['QB', 'RB', 'WR', 'TE'].includes(pos)) missing.push(`${nm} (${pos})`);
  }
  // Also list draft names that never resolved
  for (const u of unmatched.filter((x) => x.team === teamNames[rid])) {
    missing.push(`${u.name} (unresolved)`);
  }
  if (missing.length) console.log(`  ${teamNames[rid]}: ${missing.join(', ')}`);
}

writeFileSync(join(CACHE_DIR, 'results.json'), JSON.stringify({
  iterations: ran,
  results,
  teamNames,
  unmatched,
  rankedCount,
  emptyPools,
  slots: SITE_SETTINGS.STARTER_POSITION_NAMES,
}, null, 2));
console.log(`\nWrote ${join(CACHE_DIR, 'results.json')}`);
