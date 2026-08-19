/**
 * Are "extra" Hwang QBs actually unused backups?
 *
 *   npx tsx scripts/diagnose_replace_qb_usefulness.mjs [builds=3]
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const {
  buildSeasonBoards,
  instantiateArchetype,
  mulberry32,
  parseCsv,
} = require('../site/src/archetypeRosterBuilder/archetypeRosterGenerator.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DUMP = path.join(ROOT, 'example_data', 'hwang_true_sim_replace');
const BUILDS = Number(process.argv[2]) || 3;
const SEED = 1;
const JITTER = 10;
const TOL = 0.05;
const YEARS = [2021, 2022, 2023, 2024, 2025];

function readCsv(p) {
  return parseCsv(fs.readFileSync(p, 'utf8'));
}

function findSwapTarget(basePlayers, pair) {
  const idA = pair.a.playerId;
  const idB = pair.b.playerId;
  const onA = basePlayers.some((p) => p.sleeperId === idA);
  const onB = basePlayers.some((p) => p.sleeperId === idB);
  if (onA && onB) return { target: null, reason: 'both_on_roster' };
  if (onA) return { target: basePlayers.find((p) => p.sleeperId === idA), reason: 'pair_on_roster' };
  if (onB) return { target: basePlayers.find((p) => p.sleeperId === idB), reason: 'pair_on_roster' };
  const mid = (pair.a.value + pair.b.value) / 2;
  if (!(mid > 0)) return { target: null, reason: 'no_target' };
  const maxDist = TOL * mid;
  let best = null;
  let bestDist = Infinity;
  for (const p of basePlayers) {
    if (!p.sleeperId || p.sleeperId === idA || p.sleeperId === idB) continue;
    const value = Number(p.ktcValue);
    if (!(value > 0)) continue;
    const dist = Math.abs(value - mid);
    if (dist <= maxDist && dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return { target: best, reason: best ? 'similar_value' : 'no_target' };
}

function buildArchetypes(archetypeRows) {
  const byId = new Map();
  for (const row of archetypeRows) {
    if (!byId.has(row.archetype_id)) {
      byId.set(row.archetype_id, { archetypeId: row.archetype_id, slots: [] });
    }
    byId.get(row.archetype_id).slots.push({
      playerName: row.player_name,
      position: row.position,
      posRank: row.ktc_pos_rank ? Number(row.ktc_pos_rank) : null,
      ktcValue: row.ktc_value ? Number(row.ktc_value) : null,
    });
  }
  return Array.from(byId.values());
}

function loadAdp(year) {
  const p = path.join(ROOT, 'site/public/data/adp', `fantasypros_adp_bestball_${year}.csv`);
  const map = new Map();
  if (!fs.existsSync(p)) return map;
  for (const r of readCsv(p)) {
    const id = String(r.sleeper_id || '').trim();
    if (!id) continue;
    const adp = Number(r.avg);
    const rank = Number(r.rank);
    map.set(id, {
      adp: Number.isFinite(adp) ? adp : rank,
      rank: Number.isFinite(rank) ? rank : null,
      posRank: Number(r.pos_rank) || null,
    });
  }
  return map;
}

const archRows = readCsv(path.join(ROOT, 'site/public/data/archetype_rosters.csv'));
const ktcRows = readCsv(path.join(ROOT, 'site/public/data/final_ktc_values.csv'));
const archetypes = buildArchetypes(archRows);
const boards = buildSeasonBoards(ktcRows);

const ptsByYearId = new Map();
const pairsByYear = new Map();
const candByYear = new Map();
for (const r of readCsv(path.join(DUMP, 'candidates.csv'))) {
  if (r.value_basis !== 'ktc' || r.format !== 'hwang') continue;
  const y = Number(r.year);
  ptsByYearId.set(`${y}:${r.player_id}`, Number(r.season_pts) || 0);
  if (!candByYear.has(y)) candByYear.set(y, new Map());
  candByYear.get(y).set(r.player_id, {
    playerId: r.player_id, position: r.position, value: Number(r.value),
  });
}
for (const r of readCsv(path.join(DUMP, 'pairs.csv'))) {
  if (r.value_basis !== 'ktc' || r.format !== 'hwang') continue;
  const y = Number(r.year);
  const cands = candByYear.get(y);
  const a = cands?.get(r.player_id_a);
  const b = cands?.get(r.player_id_b);
  if (!a || !b) continue;
  if (!pairsByYear.has(y)) pairsByYear.set(y, []);
  pairsByYear.get(y).push({ pairKey: r.pair_key, a, b });
}

function qbMeta(year, p, adpMap) {
  const pts = ptsByYearId.has(`${year}:${p.sleeperId}`)
    ? ptsByYearId.get(`${year}:${p.sleeperId}`)
    : null;
  const adp = adpMap.get(p.sleeperId) || {};
  return {
    pts: pts,
    adp: adp.adp ?? null,
    qbPosAdp: adp.posRank ?? null,
    livePts: pts != null && pts >= 150,
    anyPts: pts != null && pts > 0,
    earlyAdp: adp.adp != null && adp.adp <= 32,
    starterAdp: adp.posRank != null && adp.posRank <= 24,
  };
}

const slotAgg = {}; // slot → { n, livePts, anyPts, earlyAdp, starterAdp, sumPts, sumAdp, adpN }
const usefulCount = { 0: 0, 1: 0, 2: 0, 3: 0, '4+': 0 };
const usefulDefs = { livePts: 0, starterAdp: 0, earlyAdp: 0, n: 0 };
const cQb = {
  n: 0,
  livePts: 0,
  anyPts: 0,
  earlyAdp: 0,
  starterAdp: 0,
  slot1: 0,
  slot2: 0,
  slot3plus: 0,
  dead: 0, // not livePts
};
let rbwrHits = 0;
let rbwrQbHoles = 0;
let rbwrQbHolesDead = 0;
let rbwrQbHolesLiveAndOnlyTwoLive = 0;

for (const year of YEARS) {
  const board = boards.get(year);
  const adpMap = loadAdp(year);
  const pairs = pairsByYear.get(year) || [];
  for (let ai = 0; ai < archetypes.length; ai += 1) {
    const archetype = archetypes[ai];
    for (let b = 0; b < BUILDS; b += 1) {
      const rng = mulberry32((SEED >>> 0) + year * 1009 + ai * 9176 + b * 524287);
      const results = instantiateArchetype({
        slots: archetype.slots, board, jitterPct: JITTER, rng,
      });
      const basePlayers = results.map((r) => {
        const g = r.generated;
        if (!g) return null;
        return { sleeperId: g.sleeperId, position: r.slot.position, ktcValue: g.value, rank: g.rank };
      }).filter(Boolean);

      const qbs = basePlayers.filter((p) => p.position === 'QB')
        .sort((a, b) => (b.ktcValue || 0) - (a.ktcValue || 0))
        .map((p, i) => ({ ...p, slot: i + 1, ...qbMeta(year, p, adpMap) }));

      usefulDefs.n += 1;
      const nLive = qbs.filter((q) => q.livePts).length;
      const nStarter = qbs.filter((q) => q.starterAdp).length;
      const nEarly = qbs.filter((q) => q.earlyAdp).length;
      usefulDefs.livePts += nLive;
      usefulDefs.starterAdp += nStarter;
      usefulDefs.earlyAdp += nEarly;
      const bucket = nLive >= 4 ? '4+' : String(nLive);
      usefulCount[bucket] += 1;

      for (const q of qbs) {
        const s = slotAgg[q.slot] || {
          n: 0, livePts: 0, anyPts: 0, earlyAdp: 0, starterAdp: 0, sumPts: 0, ptsN: 0, sumAdp: 0, adpN: 0,
        };
        s.n += 1;
        if (q.livePts) s.livePts += 1;
        if (q.anyPts) s.anyPts += 1;
        if (q.earlyAdp) s.earlyAdp += 1;
        if (q.starterAdp) s.starterAdp += 1;
        if (q.pts != null) { s.sumPts += q.pts; s.ptsN += 1; }
        if (q.adp != null) { s.sumAdp += q.adp; s.adpN += 1; }
        slotAgg[q.slot] = s;
      }

      for (const pair of pairs) {
        const { target } = findSwapTarget(basePlayers, pair);
        if (!target) continue;
        if (pair.pairKey === 'RB_vs_WR') {
          rbwrHits += 1;
          if (target.position === 'QB') {
            rbwrQbHoles += 1;
            const meta = qbs.find((q) => q.sleeperId === target.sleeperId);
            const live = meta?.livePts;
            if (!live) rbwrQbHolesDead += 1;
            if (live && nLive <= 2) rbwrQbHolesLiveAndOnlyTwoLive += 1;
          }
        }
        if (target.position !== 'QB') continue;
        const meta = qbs.find((q) => q.sleeperId === target.sleeperId);
        if (!meta) continue;
        cQb.n += 1;
        if (meta.livePts) cQb.livePts += 1;
        else cQb.dead += 1;
        if (meta.anyPts) cQb.anyPts += 1;
        if (meta.earlyAdp) cQb.earlyAdp += 1;
        if (meta.starterAdp) cQb.starterAdp += 1;
        if (meta.slot === 1) cQb.slot1 += 1;
        else if (meta.slot === 2) cQb.slot2 += 1;
        else cQb.slot3plus += 1;
      }
    }
  }
}

function pct(n, d) {
  return d ? `${((100 * n) / d).toFixed(1)}%` : '—';
}

console.log(`KTC Hwang instantiations: ${YEARS.join('-')}, ${BUILDS} builds × ${archetypes.length} archetypes`);
console.log(`mean "live" QBs (season ≥150 Hwang pts): ${(usefulDefs.livePts / usefulDefs.n).toFixed(2)}`);
console.log(`mean QBs with BB ADP positional rank ≤24 (rough starter set): ${(usefulDefs.starterAdp / usefulDefs.n).toFixed(2)}`);
console.log(`mean QBs with overall BB ADP ≤32: ${(usefulDefs.earlyAdp / usefulDefs.n).toFixed(2)}`);
console.log('builds by # of live (≥150 pt) QBs:', usefulCount);
console.log();
console.log('Roster QBs ranked by KTC (QB1 = most expensive on that club):');
console.log(`${'slot'.padEnd(8)}${'n'.padStart(6)}  ≥150pt  any pts  ADP≤32  QB ADP≤24  mean pts  mean ADP`);
for (const slot of Object.keys(slotAgg).map(Number).sort((a, b) => a - b)) {
  const s = slotAgg[slot];
  console.log(
    `QB${slot}`.padEnd(8)
    + String(s.n).padStart(6)
    + `  ${pct(s.livePts, s.n).padStart(6)}  ${pct(s.anyPts, s.n).padStart(6)}  ${pct(s.earlyAdp, s.n).padStart(6)}  ${pct(s.starterAdp, s.n).padStart(8)}  `
    + `${(s.ptsN ? s.sumPts / s.ptsN : 0).toFixed(0).padStart(8)}  ${(s.adpN ? s.sumAdp / s.adpN : 0).toFixed(0).padStart(8)}`,
  );
}
console.log();
console.log('When C (the removed player) is a QB, across all pair types:');
console.log(`  n=${cQb.n.toLocaleString()}  live≥150pt ${pct(cQb.livePts, cQb.n)}  dead ${pct(cQb.dead, cQb.n)}`);
console.log(`  any season pts ${pct(cQb.anyPts, cQb.n)}  overall ADP≤32 ${pct(cQb.earlyAdp, cQb.n)}  QB ADP≤24 ${pct(cQb.starterAdp, cQb.n)}`);
console.log(`  hole is club QB1 ${pct(cQb.slot1, cQb.n)}  QB2 ${pct(cQb.slot2, cQb.n)}  QB3+ ${pct(cQb.slot3plus, cQb.n)}`);
console.log();
console.log(`RB vs WR: C is QB ${pct(rbwrQbHoles, rbwrHits)} of hits`);
console.log(`  of those QB holes, C is dead (<150pt) ${pct(rbwrQbHolesDead, rbwrQbHoles)}`);
console.log(`  C is live AND club has only ≤2 live QBs ${pct(rbwrQbHolesLiveAndOnlyTwoLive, rbwrHits)} of all RB/WR hits`);
