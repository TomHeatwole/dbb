/**
 * Same-team pass-catcher double / triple study on the 19 Hwang archetypes.
 *
 * A pass-catcher group is that NFL team's WRs and TEs inside top-200 overall
 * ADP. Doubles are the top 2 (WR/WR, WR/TE, TE/WR). Triples are the top 3
 * (WR/WR/TE, WR/WR/WR, TE/WR/WR, …).
 *
 * Paired construction: jitter instantiate, destack (keep the team's highest
 * overall-ADP catcher, swap the extras), then force a double or a triple
 * into rank-window slots of matching position. QBs and RBs stay fixed.
 *
 * Usage:
 *   npx tsx scripts/run_hwang_passcatcher_study.mjs [seed] [builds] [outDir]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.argv[4]
  ? path.resolve(process.argv[4])
  : path.join(ROOT, 'example_data', 'hwang_passcatcher_study');
const SEED = Number(process.argv[2]) || 1;
const BUILDS = Number(process.argv[3]) || 60;
const JITTER = 10;
const WINDOW_PCT = 0.22;
const MIN_WINDOW = 4;
const NUM_WEEKS = 17;
const YEARS = [2021, 2022, 2023, 2024, 2025];
const LEAGUE_WIN = 2500;
const LEAGUE_WIN_STRICT = 2700;
const OVERALL_ADP_MAX = 200;

process.env.REACT_APP_SITE_SETTINGS = fs.readFileSync(
  path.join(ROOT, 'settings/settings.json'), 'utf8',
);

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/')) {
    const filePath = path.join(ROOT, 'site/public', url);
    if (!fs.existsSync(filePath)) {
      return { ok: false, status: 404, text: async () => '', json: async () => null };
    }
    const text = fs.readFileSync(filePath, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  }
  return realFetch(url, opts);
};

const { calculateFantasyPoints } = await import(
  path.join(ROOT, 'site/src/data_parse/fantasyCalculator.js')
);
const { mapSleeperStats } = await import(
  path.join(ROOT, 'site/src/scenarios/sleeperScoring.js')
);
const {
  applyReceptionScoring,
  optimalTotal,
  SLOT_COUNTS,
} = await import(
  path.join(ROOT, 'site/src/hwangTrueSimulator/hwangTrueSimulatorEngine.js')
);
const {
  buildSeasonBoards,
  instantiateArchetype,
  mulberry32,
  parseCsv,
} = await import(
  path.join(ROOT, 'site/src/archetypeRosterBuilder/archetypeRosterGenerator.js')
);

function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(filename, header, rows) {
  const lines = [header.join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  const outPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
  const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`  wrote ${filename}: ${rows.length.toLocaleString()} rows (${mb} MB)`);
}

function normName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function summarize(values) {
  if (!values.length) {
    return {
      n: 0, mean: null, median: null, std: null, variance: null,
      p10: null, p90: null, iqr: null, win2500: null, win2700: null,
    };
  }
  const xs = values.slice().sort((a, b) => a - b);
  const n = xs.length;
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return {
    n,
    mean: Math.round(mean * 10) / 10,
    median: Math.round(quantile(xs, 0.5) * 10) / 10,
    std: Math.round(Math.sqrt(variance) * 10) / 10,
    variance: Math.round(variance * 10) / 10,
    p10: Math.round(quantile(xs, 0.1) * 10) / 10,
    p90: Math.round(quantile(xs, 0.9) * 10) / 10,
    iqr: Math.round((quantile(xs, 0.75) - quantile(xs, 0.25)) * 10) / 10,
    win2500: Math.round((1000 * xs.filter((v) => v >= LEAGUE_WIN).length) / n) / 10,
    win2700: Math.round((1000 * xs.filter((v) => v >= LEAGUE_WIN_STRICT).length) / n) / 10,
  };
}

function rankWindow(slotRank) {
  return Math.max(MIN_WINDOW, Math.round(WINDOW_PCT * slotRank));
}

function rankFits(slotRank, playerRank) {
  if (slotRank == null || playerRank == null) return false;
  return Math.abs(playerRank - slotRank) <= rankWindow(slotRank);
}

function fitRank(p) {
  return p.slotRank || p.rank;
}

function joinCompRows(finalKtcRows, compRows) {
  const sleeperIds = new Map();
  for (const row of finalKtcRows) {
    sleeperIds.set(`${row.year}|${(row.name || '').trim().toLowerCase()}`, row.sleeper_id);
  }
  const valueRows = [];
  for (const row of compRows) {
    const value = Number(row.competitor_adjusted_value);
    if (!Number.isFinite(value)) continue;
    const sleeperId = sleeperIds.get(`${row.year}|${(row.name || '').trim().toLowerCase()}`);
    if (!sleeperId) continue;
    valueRows.push({
      year: row.year,
      name: row.name,
      position: row.position,
      sleeper_id: sleeperId,
      ktc_value: value,
    });
  }
  return valueRows;
}

function buildArchetypes(archetypeRows) {
  const byId = new Map();
  for (const row of archetypeRows) {
    if (!byId.has(row.archetype_id)) {
      const record = row.rank_basis === 'standings' ? ` (${row.wins}-${row.losses})` : '';
      byId.set(row.archetype_id, {
        archetypeId: row.archetype_id,
        label: `${row.season} #${row.finish_rank} — ${row.team_name}${record}`,
        season: row.season,
        finishRank: Number(row.finish_rank),
        teamName: row.team_name,
        slots: [],
      });
    }
    byId.get(row.archetype_id).slots.push({
      playerName: row.player_name,
      position: row.position,
      posRank: row.comp_adj_pos_rank ? Number(row.comp_adj_pos_rank) : null,
      ktcValue: row.comp_adj_value ? Number(row.comp_adj_value) : null,
    });
  }
  return Array.from(byId.values());
}

function loadTeamBySleeperYear(players, ktcRows) {
  const out = new Map();
  for (const year of YEARS) {
    const statsPath = path.join(ROOT, 'site/public/data', `stats_player_reg_${year}.csv`);
    const stats = parseCsv(fs.readFileSync(statsPath, 'utf8'));
    const byGsis = new Map();
    const byNamePos = new Map();
    for (const row of stats) {
      const pos = (row.position || '').toUpperCase();
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
      if (row.player_id) byGsis.set(row.player_id, row.recent_team);
      const key = `${normName(row.player_display_name)}|${pos}`;
      const list = byNamePos.get(key) || [];
      list.push(row.recent_team);
      byNamePos.set(key, list);
    }
    const yearKtc = ktcRows.filter((r) => Number(r.year) === year && r.sleeper_id);
    let hit = 0;
    for (const row of yearKtc) {
      const sid = row.sleeper_id;
      const pos = (row.position || '').toUpperCase();
      const pl = players[sid];
      let team = null;
      if (pl?.gsis_id && byGsis.has(pl.gsis_id)) team = byGsis.get(pl.gsis_id);
      if (!team) {
        const names = [row.name, pl?.full_name].filter(Boolean);
        for (const name of names) {
          const list = byNamePos.get(`${normName(name)}|${pos}`);
          if (list && new Set(list).size === 1) {
            team = list[0];
            break;
          }
        }
      }
      if (team) {
        out.set(`${year}|${sid}`, team);
        hit += 1;
      }
    }
    console.log(`  ${year}: team map ${hit}/${yearKtc.length} KTC players`);
  }
  return out;
}

function loadAdpBySleeperYear() {
  const out = new Map();
  for (const year of YEARS) {
    const p = path.join(ROOT, 'site/public/data/adp', `fantasypros_adp_overall_${year}.csv`);
    if (!fs.existsSync(p)) continue;
    for (const row of parseCsv(fs.readFileSync(p, 'utf8'))) {
      const sid = (row.sleeper_id || '').trim();
      if (!sid) continue;
      const adp = Number(row.avg);
      const posRank = Number(row.pos_rank);
      const overall = Number(row.rank);
      out.set(`${year}|${sid}`, {
        adp: Number.isFinite(adp) ? adp : null,
        posRank: Number.isFinite(posRank) ? posRank : null,
        overall: Number.isFinite(overall) ? overall : null,
        position: (row.position || '').toUpperCase(),
      });
    }
  }
  return out;
}

function shapeOf(players) {
  return players.map((p) => p.position).join('/');
}

function enrichBoards(seasonBoards, teamMap, adpMap) {
  const groupsByYear = new Map();
  const listed = {};
  for (const year of YEARS) {
    const board = seasonBoards.get(year);
    if (!board) continue;
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      for (const p of board[pos] || []) {
        p.position = pos;
        p.team = teamMap.get(`${year}|${p.sleeperId}`) || '';
        const adp = adpMap.get(`${year}|${p.sleeperId}`);
        p.adp = adp?.adp ?? null;
        p.adpPosRank = adp?.posRank ?? null;
        p.adpOverall = adp?.overall ?? null;
      }
    }
    const byTeam = new Map();
    for (const pos of ['WR', 'TE']) {
      for (const p of board[pos] || []) {
        if (!p.team || !p.sleeperId) continue;
        if (p.adpOverall == null || p.adpOverall > OVERALL_ADP_MAX) continue;
        const list = byTeam.get(p.team) || [];
        list.push(p);
        byTeam.set(p.team, list);
      }
    }
    const yearGroups = new Map();
    const yearList = [];
    for (const [team, catchers] of byTeam) {
      const ranked = catchers.slice().sort((a, b) => a.adpOverall - b.adpOverall);
      if (ranked.length < 2) continue;
      const double = ranked.slice(0, 2);
      const triple = ranked.length >= 3 ? ranked.slice(0, 3) : null;
      yearGroups.set(team, { members: ranked, double, triple });
      yearList.push({
        team,
        n: ranked.length,
        doubleShape: shapeOf(double),
        tripleShape: triple ? shapeOf(triple) : '',
        names: ranked.map((p) => `${p.name} (${p.position} ovr ${p.adpOverall})`).join(', '),
        doubleNames: double.map((p) => p.name).join('/'),
        tripleNames: triple ? triple.map((p) => p.name).join('/') : '',
      });
    }
    yearList.sort((a, b) => b.n - a.n || a.team.localeCompare(b.team));
    listed[year] = yearList;
    groupsByYear.set(year, yearGroups);
    const nD = yearList.length;
    const nT = yearList.filter((g) => g.n >= 3).length;
    console.log(`  ${year}: ${nD} doubles, ${nT} triples (WR/TE in overall ADP ≤ ${OVERALL_ADP_MAX})`);
    for (const g of yearList.filter((x) => x.n >= 3).slice(0, 8)) {
      console.log(`    ${g.team}  ${g.tripleShape}  ${g.tripleNames}`);
    }
  }
  return { groupsByYear, listed };
}

function loadWeeklyPoints(year, scoringConfig, positionsById) {
  const cachePath = path.join(ROOT, 'tmp/jaml_bb_sim_cache', `sleeper_weeks_${year}.json`);
  if (!fs.existsSync(cachePath)) {
    throw new Error(`Missing weekly cache ${cachePath}`);
  }
  const weeks = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  if (!Array.isArray(weeks) || weeks.length < NUM_WEEKS) {
    throw new Error(`Weekly cache for ${year} has ${weeks?.length} weeks, need ${NUM_WEEKS}`);
  }
  const ptsById = new Map();
  for (let w = 0; w < NUM_WEEKS; w += 1) {
    const weekly = weeks[w] || {};
    for (const [pid, position] of positionsById.entries()) {
      const stats = weekly[pid];
      if (!stats || typeof stats !== 'object') continue;
      const points = calculateFantasyPoints(mapSleeperStats(stats, position), scoringConfig);
      if (!ptsById.has(pid)) ptsById.set(pid, new Float64Array(NUM_WEEKS));
      ptsById.get(pid)[w] = points;
    }
  }
  return ptsById;
}

function scoreRoster(players, ptsById, slotCounts) {
  const weeks = Array.from({ length: NUM_WEEKS }, () => ({ QB: [], RB: [], WR: [], TE: [] }));
  for (const player of players) {
    const pts = ptsById.get(player.sleeperId);
    if (!pts) continue;
    for (let w = 0; w < NUM_WEEKS; w += 1) {
      if (pts[w] > 0) weeks[w][player.position].push(pts[w]);
    }
  }
  const weekly = [];
  for (const week of weeks) {
    for (const pos of ['QB', 'RB', 'WR', 'TE']) week[pos].sort((a, b) => b - a);
    weekly.push(optimalTotal(week, slotCounts));
  }
  const total = weekly.reduce((s, v) => s + v, 0);
  const mean = total / NUM_WEEKS;
  const variance = weekly.reduce((s, v) => s + (v - mean) ** 2, 0) / NUM_WEEKS;
  return {
    total: Math.round(total * 10) / 10,
    weeklyStd: Math.round(Math.sqrt(variance) * 100) / 100,
  };
}

function resultsToPlayers(results) {
  return results
    .map((r, idx) => {
      const g = r.generated;
      if (!g?.sleeperId) return null;
      return {
        slotIdx: idx,
        sleeperId: g.sleeperId,
        name: g.name,
        position: r.slot.position,
        rank: g.rank,
        value: g.value,
        team: g.team || '',
        adp: g.adp ?? null,
        adpPosRank: g.adpPosRank ?? null,
        adpOverall: g.adpOverall ?? null,
        slotRank: r.targetRank,
      };
    })
    .filter(Boolean);
}

function classifyGroups(players, groups) {
  const ids = new Set(players.map((p) => p.sleeperId));
  const hits = [];
  for (const [team, g] of groups.entries()) {
    const on = g.members.filter((p) => ids.has(p.sleeperId));
    if (on.length >= 2) {
      hits.push({
        team,
        n: on.length,
        names: on.map((p) => p.name).join('/'),
        shape: shapeOf(on),
      });
    }
  }
  hits.sort((a, b) => b.n - a.n);
  const maxN = hits[0]?.n || 0;
  let stackClass = 'none';
  if (maxN >= 3) stackClass = 'triple';
  else if (maxN === 2) stackClass = 'double';
  return { hits, maxN, stackClass, nGroups: hits.length };
}

function clonePlayers(players) {
  return players.map((p) => ({ ...p }));
}

function swapPlayer(roster, slotIdx, incoming) {
  const idx = roster.findIndex((p) => p.slotIdx === slotIdx);
  if (idx < 0) return false;
  roster[idx] = {
    ...roster[idx],
    sleeperId: incoming.sleeperId,
    name: incoming.name,
    rank: incoming.rank,
    value: incoming.value,
    team: incoming.team || '',
    adp: incoming.adp ?? null,
    adpPosRank: incoming.adpPosRank ?? null,
    adpOverall: incoming.adpOverall ?? null,
  };
  return true;
}

function partnerIdsIfKept(roster, exceptId, groups) {
  const taken = new Set(roster.map((p) => p.sleeperId));
  taken.delete(exceptId);
  const partners = new Set();
  for (const g of groups.values()) {
    const on = g.members.filter((p) => taken.has(p.sleeperId));
    if (on.length >= 1) {
      for (const p of g.members) partners.add(p.sleeperId);
    }
  }
  return partners;
}

function replacementCatcher(roster, slot, board, groups, rng) {
  const taken = new Set(roster.map((p) => p.sleeperId));
  taken.delete(slot.sleeperId);
  const partners = partnerIdsIfKept(roster, slot.sleeperId, groups);
  const slotKey = fitRank(slot);
  const pool = (board[slot.position] || []).filter((p) => (
    p.sleeperId
    && !taken.has(p.sleeperId)
    && p.team !== slot.team
    && !partners.has(p.sleeperId)
    && rankFits(slotKey, fitRank(p))
  ));
  if (!pool.length) return null;
  pool.sort((a, b) => Math.abs(fitRank(a) - slotKey) - Math.abs(fitRank(b) - slotKey));
  const top = pool.slice(0, Math.min(6, pool.length));
  return top[Math.floor(rng() * top.length)];
}

function destackRoster(players, board, groups, rng, keepTeam = null) {
  const roster = clonePlayers(players);
  for (let guard = 0; guard < 12; guard += 1) {
    const cls = classifyGroups(roster, groups);
    const leftover = cls.hits.filter((h) => h.team !== keepTeam);
    if (!leftover.length && (keepTeam ? cls.hits.every((h) => h.team === keepTeam) : cls.maxN < 2)) {
      return roster;
    }
    if (!keepTeam && cls.maxN < 2) return roster;
    let swapped = false;
    for (const hit of leftover) {
      const g = groups.get(hit.team);
      const on = g.members
        .filter((p) => roster.some((r) => r.sleeperId === p.sleeperId))
        .sort((a, b) => a.adpOverall - b.adpOverall);
      for (const extra of on.slice(1)) {
        const slot = roster.find((p) => p.sleeperId === extra.sleeperId);
        if (!slot) continue;
        const alt = replacementCatcher(roster, slot, board, groups, rng);
        if (alt && swapPlayer(roster, slot.slotIdx, alt)) swapped = true;
      }
    }
    if (!swapped) break;
    const next = classifyGroups(roster, groups);
    const leftoverNext = next.hits.filter((h) => h.team !== keepTeam);
    if (!leftoverNext.length) return roster;
  }
  const final = classifyGroups(roster, groups);
  const leftoverFinal = final.hits.filter((h) => h.team !== keepTeam);
  return leftoverFinal.length ? null : roster;
}

function slotFitsFor(roster, incoming) {
  return roster
    .filter((s) => s.position === incoming.position && rankFits(fitRank(s), fitRank(incoming)))
    .map((s) => ({ slot: s, cost: Math.abs(fitRank(s) - fitRank(incoming)) }))
    .sort((a, b) => a.cost - b.cost);
}

function combinations(arr, k) {
  const out = [];
  const rec = (start, cur) => {
    if (cur.length === k) {
      out.push(cur.slice());
      return;
    }
    for (let i = start; i < arr.length; i += 1) {
      cur.push(arr[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

function applyGroup(players, groups, nWanted, board, rng) {
  const destacked = destackRoster(players, board, groups, rng);
  if (!destacked) return null;
  const roster = clonePlayers(destacked);
  const cands = [];
  for (const [team, g] of groups.entries()) {
    if (g.members.length < nWanted) continue;
    for (const pack of combinations(g.members, nWanted)) {
      const fitLists = pack.map((p) => slotFitsFor(roster, p));
      if (fitLists.some((lst) => !lst.length)) continue;
      const cost = fitLists.reduce((s, lst) => s + lst[0].cost, 0);
      cands.push({ team, pack, fitLists, cost });
    }
  }
  cands.sort((a, b) => a.cost - b.cost);

  for (const cand of cands) {
    const usedSlots = new Set();
    const usedIncoming = new Set(roster.map((p) => p.sleeperId));
    const picks = [];
    let ok = true;
    for (let i = 0; i < cand.pack.length; i += 1) {
      const incoming = cand.pack[i];
      const already = roster.find((p) => p.sleeperId === incoming.sleeperId);
      if (already && !usedSlots.has(already.slotIdx)) {
        usedSlots.add(already.slotIdx);
        usedIncoming.add(incoming.sleeperId);
        picks.push({ slotIdx: already.slotIdx, incoming });
        continue;
      }
      const pick = cand.fitLists[i].find((f) => !usedSlots.has(f.slot.slotIdx)
        && !usedIncoming.has(incoming.sleeperId));
      if (!pick) {
        ok = false;
        break;
      }
      usedSlots.add(pick.slot.slotIdx);
      usedIncoming.delete(roster.find((p) => p.slotIdx === pick.slot.slotIdx)?.sleeperId);
      usedIncoming.add(incoming.sleeperId);
      picks.push({ slotIdx: pick.slot.slotIdx, incoming });
    }
    if (!ok) continue;
    const trial = clonePlayers(roster);
    for (const pick of picks) swapPlayer(trial, pick.slotIdx, pick.incoming);
    const cleaned = destackRoster(trial, board, groups, rng, cand.team);
    if (!cleaned) continue;
    const cls = classifyGroups(cleaned, groups);
    const wantedClass = nWanted >= 3 ? 'triple' : 'double';
    if (cls.stackClass === wantedClass && cls.nGroups === 1) return cleaned;
  }
  return null;
}

function rosterValue(players) {
  return players.reduce((s, p) => s + (p.value || 0), 0);
}

function histogram(values, lo = 1800, hi = 3400, step = 100) {
  const bins = [];
  for (let x = lo; x < hi; x += step) {
    bins.push({ lo: x, hi: x + step, label: `${x}–${x + step - 1}`, n: 0 });
  }
  for (const v of values) {
    if (v < lo) {
      bins[0].n += 1;
      continue;
    }
    if (v >= hi) {
      bins[bins.length - 1].n += 1;
      continue;
    }
    bins[Math.floor((v - lo) / step)].n += 1;
  }
  return bins;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`Pass-catcher double/triple study  seed=${SEED}  builds=${BUILDS}  overall ADP ≤ ${OVERALL_ADP_MAX}`);
console.log('Loading inputs…');

const archetypeRows = parseCsv(fs.readFileSync(path.join(ROOT, 'site/public/data/archetype_rosters.csv'), 'utf8'));
const finalKtcRows = parseCsv(fs.readFileSync(path.join(ROOT, 'site/public/data/final_ktc_values.csv'), 'utf8'));
const compRows = parseCsv(fs.readFileSync(
  path.join(ROOT, 'site/public/data/final_ktc_redraft_value_index.csv'), 'utf8',
));
const scoringConfig = applyReceptionScoring(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'site/public/data/score_format.json'), 'utf8')),
  0,
  0.5,
);
const playersDump = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/public/data/players.txt'), 'utf8'));
const archetypes = buildArchetypes(archetypeRows);
const constructionRows = joinCompRows(finalKtcRows, compRows);
const seasonBoards = buildSeasonBoards(constructionRows);

console.log('Mapping historical NFL teams and top-200 pass-catcher groups…');
const teamMap = loadTeamBySleeperYear(playersDump, finalKtcRows);
const adpMap = loadAdpBySleeperYear();
const { groupsByYear, listed } = enrichBoards(seasonBoards, teamMap, adpMap);

const buildRows = [];
const variantCounts = { natural: 0, none: 0, double: 0, triple: 0 };
const naturalClassCounts = { none: 0, double: 0, triple: 0 };

for (const year of YEARS) {
  const board = seasonBoards.get(year);
  const groups = groupsByYear.get(year);
  if (!board || !groups) continue;

  const positionsById = new Map();
  for (const pos of Object.keys(board)) {
    for (const entry of board[pos]) {
      if (entry.sleeperId) positionsById.set(entry.sleeperId, pos);
    }
  }
  console.log(`\n${year}: scoring ${positionsById.size} players from weekly cache…`);
  const t0 = Date.now();
  const ptsById = loadWeeklyPoints(year, scoringConfig, positionsById);
  console.log(`  weekly points ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  for (let ai = 0; ai < archetypes.length; ai += 1) {
    const archetype = archetypes[ai];
    let nNone = 0;
    let nDouble = 0;
    let nTriple = 0;
    for (let b = 0; b < BUILDS; b += 1) {
      const rng = mulberry32((SEED >>> 0) + year * 1009 + ai * 9176 + b * 524287 + 31);
      const results = instantiateArchetype({
        slots: archetype.slots, board, jitterPct: JITTER, rng,
      });
      const natural = resultsToPlayers(results);
      if (natural.length < 20) continue;

      const push = (variant, roster) => {
        if (!roster) return false;
        const cls = classifyGroups(roster, groups);
        const scored = scoreRoster(roster, ptsById, SLOT_COUNTS);
        const primary = cls.hits[0];
        buildRows.push([
          year,
          archetype.archetypeId,
          archetype.label,
          b + 1,
          variant,
          cls.stackClass,
          cls.maxN,
          cls.nGroups,
          Math.round(scored.total * 10) / 10,
          scored.weeklyStd,
          Math.round(rosterValue(roster)),
          primary?.team || '',
          primary?.shape || '',
          primary?.names || '',
          cls.hits.map((h) => `${h.team}:${h.shape}`).join('|'),
        ]);
        variantCounts[variant] += 1;
        return true;
      };

      const natCls = classifyGroups(natural, groups);
      naturalClassCounts[natCls.stackClass] += 1;
      push('natural', natural);

      const destacked = destackRoster(natural, board, groups, rng);
      if (push('none', destacked)) nNone += 1;

      const doubled = applyGroup(destacked || natural, groups, 2, board, rng);
      if (push('double', doubled)) nDouble += 1;

      const tripled = applyGroup(destacked || natural, groups, 3, board, rng);
      if (push('triple', tripled)) nTriple += 1;
    }
    console.log(
      `  ${archetype.archetypeId}: none ${nNone}/${BUILDS}  double ${nDouble}/${BUILDS}  triple ${nTriple}/${BUILDS}`,
    );
  }
}

writeCsv(
  'builds.csv',
  [
    'year', 'archetype_id', 'archetype_label', 'build_index', 'variant',
    'stack_class', 'max_n', 'n_groups',
    'season_total', 'weekly_std', 'roster_value',
    'primary_team', 'shape', 'names', 'all_groups',
  ],
  buildRows,
);

function rowsOf(pred) {
  return buildRows.filter(pred).map((r) => r[8]);
}

const overall = {};
for (const v of ['none', 'double', 'triple', 'natural']) {
  overall[v] = summarize(rowsOf((r) => r[4] === v));
}

const byYear = {};
for (const year of YEARS) {
  byYear[year] = {};
  for (const v of ['none', 'double', 'triple']) {
    byYear[year][v] = summarize(rowsOf((r) => r[0] === year && r[4] === v));
  }
}

const byArchetype = {};
for (const a of archetypes) {
  byArchetype[a.archetypeId] = { label: a.label };
  for (const v of ['none', 'double', 'triple']) {
    byArchetype[a.archetypeId][v] = summarize(
      rowsOf((r) => r[1] === a.archetypeId && r[4] === v),
    );
  }
}

const hist = {};
for (const v of ['none', 'double', 'triple']) {
  hist[v] = histogram(rowsOf((r) => r[4] === v));
}

const weeklyStd = {};
for (const v of ['none', 'double', 'triple']) {
  weeklyStd[v] = summarize(buildRows.filter((r) => r[4] === v).map((r) => r[9]));
}

function mean(xs) {
  if (!xs.length) return null;
  return Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 10) / 10;
}

function pairedFor(variant) {
  const byKey = new Map();
  for (const r of buildRows) {
    const key = `${r[0]}|${r[1]}|${r[3]}`;
    if (!byKey.has(key)) byKey.set(key, {});
    byKey.get(key)[r[4]] = r;
  }
  const stacked = [];
  const twins = [];
  const deltas = [];
  const stackedStd = [];
  const twinStd = [];
  const byYearPaired = {};
  for (const year of YEARS) {
    byYearPaired[year] = { stacked: [], twins: [], deltas: [] };
  }
  for (const rec of byKey.values()) {
    if (!rec.none || !rec[variant]) continue;
    const a = rec[variant][8];
    const b = rec.none[8];
    stacked.push(a);
    twins.push(b);
    deltas.push(a - b);
    stackedStd.push(rec[variant][9]);
    twinStd.push(rec.none[9]);
    const y = rec.none[0];
    byYearPaired[y].stacked.push(a);
    byYearPaired[y].twins.push(b);
    byYearPaired[y].deltas.push(a - b);
  }
  const yearOut = {};
  for (const year of YEARS) {
    const y = byYearPaired[year];
    yearOut[year] = {
      n: y.stacked.length,
      stacked: summarize(y.stacked),
      twin: summarize(y.twins),
      deltaMean: mean(y.deltas),
      deltaMedian: y.deltas.length ? summarize(y.deltas).median : null,
      stackedWins: y.deltas.length
        ? Math.round((1000 * y.deltas.filter((d) => d > 0).length) / y.deltas.length) / 10
        : null,
    };
  }
  return {
    n: stacked.length,
    stacked: summarize(stacked),
    twin: summarize(twins),
    deltaMean: mean(deltas),
    deltaMedian: deltas.length ? summarize(deltas).median : null,
    stackedWins: deltas.length
      ? Math.round((1000 * deltas.filter((d) => d > 0).length) / deltas.length) / 10
      : null,
    weeklyStdStacked: summarize(stackedStd),
    weeklyStdTwin: summarize(twinStd),
    byYear: yearOut,
  };
}

function byShape(variant) {
  const buckets = new Map();
  for (const r of buildRows) {
    if (r[4] !== variant) continue;
    const shape = r[12] || 'unknown';
    if (!buckets.has(shape)) buckets.set(shape, []);
    buckets.get(shape).push(r[8]);
  }
  const out = {};
  for (const [shape, vals] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out[shape] = summarize(vals);
  }
  return out;
}

const paired = {
  double: pairedFor('double'),
  triple: pairedFor('triple'),
};
const shapes = {
  double: byShape('double'),
  triple: byShape('triple'),
};

const summary = {
  config: {
    seed: SEED,
    buildsPerArchetypeYear: BUILDS,
    jitterPct: JITTER,
    windowPct: WINDOW_PCT,
    minWindow: MIN_WINDOW,
    overallAdpMax: OVERALL_ADP_MAX,
    years: YEARS,
    archetypeCount: archetypes.length,
    constructionBasis: 'comp',
    format: 'hwang 1QB/3RB/3WR/1TE/2FLEX/1SF · 0 PPR · TE +0.5',
    leagueWin: LEAGUE_WIN,
    leagueWinStrict: LEAGUE_WIN_STRICT,
    scoring: 'optimal weekly starters, 17 weeks',
  },
  groups: listed,
  variantCounts,
  naturalClassCounts,
  overall,
  byYear,
  byArchetype,
  weeklyStd,
  hist,
  paired,
  shapes,
};

fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('\n=== Overall ===');
for (const v of ['none', 'double', 'triple']) {
  const s = overall[v];
  if (!s.n) {
    console.log(`${v.padEnd(10)} n=0`);
    continue;
  }
  console.log(
    `${v.padEnd(10)} n=${s.n.toString().padStart(5)}  `
    + `median ${s.median}  mean ${s.mean}  std ${s.std}  `
    + `p10 ${s.p10}  p90 ${s.p90}  ≥2500 ${s.win2500}%  ≥2700 ${s.win2700}%`,
  );
}
console.log('natural class', naturalClassCounts, 'variant counts', variantCounts);
for (const v of ['double', 'triple']) {
  const p = paired[v];
  if (!p.n) {
    console.log(`paired ${v}: n=0`);
    continue;
  }
  console.log(
    `paired ${v.padEnd(6)} n=${p.n}  stacked median ${p.stacked.median}  twin ${p.twin.median}`
    + `  Δmean ${p.deltaMean}  Δmedian ${p.deltaMedian}  stacked-wins ${p.stackedWins}%`
    + `  ≥2500 ${p.twin.win2500}% → ${p.stacked.win2500}%`,
  );
}
console.log('double shapes', shapes.double);
console.log('triple shapes', shapes.triple);
console.log(`\nDone. ${path.relative(ROOT, OUT_DIR)}/summary.json`);
