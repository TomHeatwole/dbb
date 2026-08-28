/**
 * Same-team RB1 + RB2 committee study on the 19 Hwang archetypes.
 *
 * A committee is an NFL team's ADP RB1 and RB2, with the RB2 still inside
 * top-50 RB ADP (real committees / timeshares — not dart handcuffs).
 *
 * Same construction as the QB+WR1 stack study: jitter instantiate each
 * archetype onto 2021–2025 competitor-adjusted boards, then from each
 * natural roster try paired variants that keep QBs/WRs/TEs fixed and only
 * swap RBs inside a positional-rank window:
 *
 *   none    destack so no qualifying committee is on the roster
 *   single  exactly one team's RB1+RB2
 *   multi   two teams' RB1+RB2 (where ADP allows)
 *
 * Usage:
 *   npx tsx scripts/run_hwang_rb_committee_study.mjs [seed] [builds] [outDir]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.argv[4]
  ? path.resolve(process.argv[4])
  : path.join(ROOT, 'example_data', 'hwang_rb_committee_study');
const SEED = Number(process.argv[2]) || 1;
const BUILDS = Number(process.argv[3]) || 60;
const JITTER = 10;
const WINDOW_PCT = 0.22;
const MIN_WINDOW = 4;
const NUM_WEEKS = 17;
const YEARS = [2021, 2022, 2023, 2024, 2025];
const LEAGUE_WIN = 2500;
const LEAGUE_WIN_STRICT = 2700;
const RB2_ADP_MAX = 50;

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
  return p.adpPosRank || p.slotRank || p.rank;
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
      out.set(`${year}|${sid}`, {
        adp: Number.isFinite(adp) ? adp : null,
        posRank: Number.isFinite(posRank) ? posRank : null,
        position: (row.position || '').toUpperCase(),
      });
    }
  }
  return out;
}

function enrichBoards(seasonBoards, teamMap, adpMap) {
  const committees = new Map();
  const listed = {};
  for (const year of YEARS) {
    const board = seasonBoards.get(year);
    if (!board) continue;
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      for (const p of board[pos] || []) {
        p.team = teamMap.get(`${year}|${p.sleeperId}`) || '';
        const adp = adpMap.get(`${year}|${p.sleeperId}`);
        p.adp = adp?.adp ?? null;
        p.adpPosRank = adp?.posRank ?? null;
      }
    }
    const byTeam = new Map();
    for (const p of board.RB || []) {
      if (!p.team || !p.sleeperId) continue;
      const list = byTeam.get(p.team) || [];
      list.push(p);
      byTeam.set(p.team, list);
    }
    const yearCommittees = new Map();
    const yearList = [];
    for (const [team, rbs] of byTeam) {
      const ranked = rbs.slice().sort((a, b) => {
        const aa = a.adpPosRank == null ? 999 : a.adpPosRank;
        const bb = b.adpPosRank == null ? 999 : b.adpPosRank;
        if (aa !== bb) return aa - bb;
        return a.rank - b.rank;
      });
      if (ranked.length < 2) continue;
      const rb1 = ranked[0];
      const rb2 = ranked[1];
      if (rb2.adpPosRank == null || rb2.adpPosRank > RB2_ADP_MAX) continue;
      yearCommittees.set(team, { rb1, rb2 });
      yearList.push({
        team,
        rb1: rb1.name,
        rb1Adp: rb1.adpPosRank,
        rb2: rb2.name,
        rb2Adp: rb2.adpPosRank,
      });
    }
    yearList.sort((a, b) => a.rb2Adp - b.rb2Adp);
    listed[year] = yearList;
    committees.set(year, yearCommittees);
    console.log(`  ${year}: ${yearCommittees.size} committees with RB2 ADP ≤ ${RB2_ADP_MAX}`);
    for (const c of yearList) {
      console.log(`    ${c.team}  ${c.rb1} (RB${c.rb1Adp}) / ${c.rb2} (RB${c.rb2Adp})`);
    }
  }
  return { committees, listed };
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
        slotRank: r.targetRank,
      };
    })
    .filter(Boolean);
}

function classifyCommittees(players, committees) {
  const ids = new Set(players.map((p) => p.sleeperId));
  const stackTeams = [];
  for (const [team, pair] of committees.entries()) {
    if (ids.has(pair.rb1.sleeperId) && ids.has(pair.rb2.sleeperId)) {
      stackTeams.push(team);
    }
  }
  const rbs = players.filter((p) => p.position === 'RB').sort((a, b) => (
    (a.adpPosRank || a.rank) - (b.adpPosRank || b.rank)
  ));
  const rb1 = rbs[0];
  const rb2 = rbs[1];
  const rosterRb1Rb2SameTeam = !!(rb1?.team && rb2?.team && rb1.team === rb2.team);
  return {
    stackCount: stackTeams.length,
    stackTeams,
    rosterRb1Rb2SameTeam,
    rb1Name: rb1?.name || '',
    rb2Name: rb2?.name || '',
    rb2Adp: rb2?.adpPosRank ?? null,
  };
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
  };
  return true;
}

function committeeIds(committees) {
  const ids = new Set();
  for (const pair of committees.values()) {
    ids.add(pair.rb1.sleeperId);
    ids.add(pair.rb2.sleeperId);
  }
  return ids;
}

function replacementRb(roster, slot, board, committees, rng) {
  const taken = new Set(roster.map((p) => p.sleeperId));
  taken.delete(slot.sleeperId);
  const partnerIds = new Set();
  for (const pair of committees.values()) {
    if (taken.has(pair.rb1.sleeperId)) partnerIds.add(pair.rb2.sleeperId);
    if (taken.has(pair.rb2.sleeperId)) partnerIds.add(pair.rb1.sleeperId);
  }
  const slotKey = fitRank(slot);
  const pool = (board.RB || []).filter((p) => (
    p.sleeperId
    && !taken.has(p.sleeperId)
    && p.team !== slot.team
    && !partnerIds.has(p.sleeperId)
    && rankFits(slotKey, fitRank(p))
  ));
  if (!pool.length) return null;
  pool.sort((a, b) => Math.abs(fitRank(a) - slotKey) - Math.abs(fitRank(b) - slotKey));
  const top = pool.slice(0, Math.min(6, pool.length));
  return top[Math.floor(rng() * top.length)];
}

function destackRoster(players, board, committees, rng) {
  const roster = clonePlayers(players);
  for (let guard = 0; guard < 8; guard += 1) {
    const cls = classifyCommittees(roster, committees);
    if (cls.stackCount === 0) return roster;
    let swapped = false;
    for (const team of cls.stackTeams) {
      const pair = committees.get(team);
      const rb2 = roster.find((p) => p.sleeperId === pair.rb2.sleeperId);
      if (!rb2) continue;
      const alt = replacementRb(roster, rb2, board, committees, rng);
      if (alt && swapPlayer(roster, rb2.slotIdx, alt)) swapped = true;
    }
    if (!swapped) break;
    if (classifyCommittees(roster, committees).stackCount === 0) return roster;
  }
  return classifyCommittees(roster, committees).stackCount === 0 ? roster : null;
}

function viableCommittees(roster, committees) {
  const rbSlots = roster.filter((p) => p.position === 'RB');
  const out = [];
  for (const [team, pair] of committees.entries()) {
    const rb1Fits = rbSlots
      .filter((s) => rankFits(fitRank(s), fitRank(pair.rb1)))
      .map((s) => ({ slot: s, cost: Math.abs(fitRank(s) - fitRank(pair.rb1)) }))
      .sort((a, b) => a.cost - b.cost);
    const rb2Fits = rbSlots
      .filter((s) => rankFits(fitRank(s), fitRank(pair.rb2)))
      .map((s) => ({ slot: s, cost: Math.abs(fitRank(s) - fitRank(pair.rb2)) }))
      .sort((a, b) => a.cost - b.cost);
    if (!rb1Fits.length || !rb2Fits.length) continue;
    out.push({
      team,
      pair,
      rb1Fits,
      rb2Fits,
      cost: rb1Fits[0].cost + rb2Fits[0].cost,
    });
  }
  out.sort((a, b) => a.cost - b.cost);
  return out;
}

function applyNCommittees(players, committees, nWanted) {
  const roster = clonePlayers(players);
  const list = viableCommittees(roster, committees);
  const usedSlots = new Set();
  const usedIncoming = new Set(roster.map((p) => p.sleeperId));
  const chosen = [];
  for (const cand of list) {
    if (chosen.length >= nWanted) break;
    const id1 = cand.pair.rb1.sleeperId;
    const id2 = cand.pair.rb2.sleeperId;
    if (id1 === id2) continue;
    const pick1 = cand.rb1Fits.find((f) => !usedSlots.has(f.slot.slotIdx)
      && (roster.find((p) => p.slotIdx === f.slot.slotIdx)?.sleeperId === id1
        || !usedIncoming.has(id1)));
    if (!pick1) continue;
    const pick2 = cand.rb2Fits.find((f) => !usedSlots.has(f.slot.slotIdx)
      && f.slot.slotIdx !== pick1.slot.slotIdx
      && (roster.find((p) => p.slotIdx === f.slot.slotIdx)?.sleeperId === id2
        || !usedIncoming.has(id2)));
    if (!pick2) continue;
    usedSlots.add(pick1.slot.slotIdx);
    usedSlots.add(pick2.slot.slotIdx);
    usedIncoming.delete(roster.find((p) => p.slotIdx === pick1.slot.slotIdx)?.sleeperId);
    usedIncoming.delete(roster.find((p) => p.slotIdx === pick2.slot.slotIdx)?.sleeperId);
    usedIncoming.add(id1);
    usedIncoming.add(id2);
    swapPlayer(roster, pick1.slot.slotIdx, cand.pair.rb1);
    swapPlayer(roster, pick2.slot.slotIdx, cand.pair.rb2);
    chosen.push(cand.team);
  }
  if (chosen.length < nWanted) return null;
  const cls = classifyCommittees(roster, committees);
  if (nWanted === 1 && cls.stackCount !== 1) return null;
  if (nWanted >= 2 && cls.stackCount < 2) return null;
  return roster;
}

function rosterValue(players) {
  return players.reduce((s, p) => s + (p.value || 0), 0);
}

function stackNames(committees, teams) {
  return teams.map((team) => {
    const p = committees.get(team);
    return `${p.rb1.name}/${p.rb2.name} (${team})`;
  }).join('; ');
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
console.log(`RB1+RB2 committee study  seed=${SEED}  builds/archetype/year=${BUILDS}  RB2 ADP ≤ ${RB2_ADP_MAX}`);
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

console.log('Mapping historical NFL teams and ADP committees…');
const teamMap = loadTeamBySleeperYear(playersDump, finalKtcRows);
const adpMap = loadAdpBySleeperYear();
const { committees: committeesByYear, listed: committeeList } = enrichBoards(seasonBoards, teamMap, adpMap);

const buildRows = [];
const variantCounts = { natural: 0, none: 0, single: 0, multi: 0 };
const naturalClassCounts = { 0: 0, 1: 0, 2: 0 };

for (const year of YEARS) {
  const board = seasonBoards.get(year);
  const committees = committeesByYear.get(year);
  if (!board || !committees) continue;

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
    let nSingle = 0;
    let nMulti = 0;
    for (let b = 0; b < BUILDS; b += 1) {
      const rng = mulberry32((SEED >>> 0) + year * 1009 + ai * 9176 + b * 524287 + 17);
      const results = instantiateArchetype({
        slots: archetype.slots, board, jitterPct: JITTER, rng,
      });
      const natural = resultsToPlayers(results);
      if (natural.length < 20) continue;

      const push = (variant, roster) => {
        if (!roster) return false;
        const cls = classifyCommittees(roster, committees);
        const scored = scoreRoster(roster, ptsById, SLOT_COUNTS);
        const stackClass = cls.stackCount >= 2 ? 'multi' : cls.stackCount === 1 ? 'single' : 'none';
        buildRows.push([
          year,
          archetype.archetypeId,
          archetype.label,
          b + 1,
          variant,
          stackClass,
          cls.stackCount,
          cls.rosterRb1Rb2SameTeam ? 1 : 0,
          Math.round(scored.total * 10) / 10,
          scored.weeklyStd,
          Math.round(rosterValue(roster)),
          cls.stackTeams.join('|'),
          stackNames(committees, cls.stackTeams),
          cls.rb1Name,
          cls.rb2Name,
          cls.rb2Adp ?? '',
        ]);
        variantCounts[variant] += 1;
        return true;
      };

      const natCls = classifyCommittees(natural, committees);
      naturalClassCounts[Math.min(natCls.stackCount, 2)] += 1;
      push('natural', natural);

      const destacked = destackRoster(natural, board, committees, rng);
      if (push('none', destacked)) nNone += 1;

      const single = destacked
        ? applyNCommittees(destacked, committees, 1)
        : applyNCommittees(natural, committees, 1);
      if (push('single', single)) nSingle += 1;

      const multi = applyNCommittees(destacked || natural, committees, 2);
      if (push('multi', multi)) nMulti += 1;
    }
    console.log(
      `  ${archetype.archetypeId}: none ${nNone}/${BUILDS}  single ${nSingle}/${BUILDS}  multi ${nMulti}/${BUILDS}`,
    );
  }
}

writeCsv(
  'builds.csv',
  [
    'year', 'archetype_id', 'archetype_label', 'build_index', 'variant',
    'stack_class', 'stack_count', 'roster_rb1_rb2_same_team',
    'season_total', 'weekly_std', 'roster_value', 'stack_teams', 'stack_names',
    'roster_rb1_name', 'roster_rb2_name', 'roster_rb2_adp',
  ],
  buildRows,
);

function rowsOf(pred) {
  return buildRows.filter(pred).map((r) => r[8]);
}

const VARIANT_LABEL = {
  natural: 'Natural jitter',
  none: 'Forced no committee',
  single: 'Forced 1 committee',
  multi: 'Forced 2 committees',
};

const overall = {};
for (const v of ['none', 'single', 'multi', 'natural']) {
  overall[v] = summarize(rowsOf((r) => r[4] === v));
}

const byYear = {};
for (const year of YEARS) {
  byYear[year] = {};
  for (const v of ['none', 'single', 'multi']) {
    byYear[year][v] = summarize(rowsOf((r) => r[0] === year && r[4] === v));
  }
}

const byArchetype = {};
for (const a of archetypes) {
  byArchetype[a.archetypeId] = { label: a.label };
  for (const v of ['none', 'single', 'multi']) {
    byArchetype[a.archetypeId][v] = summarize(
      rowsOf((r) => r[1] === a.archetypeId && r[4] === v),
    );
  }
}

const rosterPairSplit = {
  sameTeam: summarize(rowsOf((r) => r[4] === 'natural' && r[7] === 1)),
  notSame: summarize(rowsOf((r) => r[4] === 'natural' && r[7] === 0)),
};

const hist = {};
for (const v of ['none', 'single', 'multi']) {
  hist[v] = histogram(rowsOf((r) => r[4] === v));
}

const weeklyStd = {};
for (const v of ['none', 'single', 'multi']) {
  weeklyStd[v] = summarize(buildRows.filter((r) => r[4] === v).map((r) => r[9]));
}

const summary = {
  config: {
    seed: SEED,
    buildsPerArchetypeYear: BUILDS,
    jitterPct: JITTER,
    windowPct: WINDOW_PCT,
    minWindow: MIN_WINDOW,
    rb2AdpMax: RB2_ADP_MAX,
    years: YEARS,
    archetypeCount: archetypes.length,
    constructionBasis: 'comp',
    format: 'hwang 1QB/3RB/3WR/1TE/2FLEX/1SF · 0 PPR · TE +0.5',
    leagueWin: LEAGUE_WIN,
    leagueWinStrict: LEAGUE_WIN_STRICT,
    scoring: 'optimal weekly starters, 17 weeks',
  },
  committees: committeeList,
  variantCounts,
  naturalClassCounts,
  overall,
  byYear,
  byArchetype,
  rosterPairSplit,
  weeklyStd,
  hist,
};

fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('\n=== Overall (paired variants, QBs/WRs/TEs held fixed) ===');
for (const v of ['none', 'single', 'multi']) {
  const s = overall[v];
  if (!s.n) {
    console.log(`${VARIANT_LABEL[v].padEnd(24)} n=0`);
    continue;
  }
  console.log(
    `${VARIANT_LABEL[v].padEnd(24)} n=${s.n.toString().padStart(5)}  `
    + `median ${s.median}  mean ${s.mean}  std ${s.std}  `
    + `p10 ${s.p10}  p90 ${s.p90}  ≥2500 ${s.win2500}%  ≥2700 ${s.win2700}%`,
  );
}
console.log('\nNatural jitter:');
const nat = overall.natural;
console.log(
  `  all natural n=${nat.n} median ${nat.median} std ${nat.std} ≥2500 ${nat.win2500}%`,
);
console.log(
  `  natural class counts: none=${naturalClassCounts[0]} single=${naturalClassCounts[1]} multi+=${naturalClassCounts[2]}`,
);
console.log(`\nDone. Summary at ${path.relative(ROOT, OUT_DIR)}/summary.json`);
