/**
 * Count who actually gets removed in replace-mode (no weekly stats / HVORP).
 * Uses the replace dump's candidate pairs + the same roster instantiation.
 *
 *   npx tsx scripts/diagnose_replace_swap_targets.mjs [builds=5]
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
const BUILDS = Number(process.argv[2]) || 5;
const YEAR = 2024;
const BASIS = 'ktc';
const JITTER = 10;
const SEED = 1;
const TOL = 0.05;

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

function buildArchetypes(archetypeRows, rankBasis = 'ktc') {
  const rankField = rankBasis === 'comp' ? 'comp_adj_pos_rank' : 'ktc_pos_rank';
  const valueField = rankBasis === 'comp' ? 'comp_adj_value' : 'ktc_value';
  const byId = new Map();
  for (const row of archetypeRows) {
    if (!byId.has(row.archetype_id)) {
      byId.set(row.archetype_id, {
        archetypeId: row.archetype_id,
        label: `${row.season} #${row.finish_rank} — ${row.team_name}`,
        slots: [],
      });
    }
    byId.get(row.archetype_id).slots.push({
      playerName: row.player_name,
      position: row.position,
      posRank: row[rankField] ? Number(row[rankField]) : null,
      ktcValue: row[valueField] ? Number(row[valueField]) : null,
    });
  }
  return Array.from(byId.values());
}

const archRows = readCsv(path.join(ROOT, 'site/public/data/archetype_rosters.csv'));
const ktcRows = readCsv(path.join(ROOT, 'site/public/data/final_ktc_values.csv'));
const archetypes = buildArchetypes(archRows, BASIS);
const board = buildSeasonBoards(ktcRows).get(YEAR);

const candRows = readCsv(path.join(DUMP, 'candidates.csv')).filter(
  (r) => r.value_basis === BASIS && r.format === 'hwang' && Number(r.year) === YEAR,
);
const byId = new Map(candRows.map((r) => [r.player_id, {
  playerId: r.player_id, position: r.position, value: Number(r.value), name: r.name,
}]));
const pairs = readCsv(path.join(DUMP, 'pairs.csv'))
  .filter((r) => r.value_basis === BASIS && r.format === 'hwang' && Number(r.year) === YEAR)
  .map((r) => ({
    pairKey: r.pair_key,
    a: byId.get(r.player_id_a),
    b: byId.get(r.player_id_b),
  }))
  .filter((p) => p.a && p.b);

const posTally = {}; // pairKey → { QB: n, RB: n, ... }
const qbCountTally = { 0: 0, 1: 0, 2: 0, 3: 0, '4+': 0 };
const skillIntoQbHole = { hits: 0, qbHoles: 0, qbHolesOn2qb: 0 };
let rosterQbSum = 0;
let rosterN = 0;

for (let ai = 0; ai < archetypes.length; ai += 1) {
  const archetype = archetypes[ai];
  for (let b = 0; b < BUILDS; b += 1) {
    const rng = mulberry32((SEED >>> 0) + YEAR * 1009 + ai * 9176 + b * 524287);
    const results = instantiateArchetype({ slots: archetype.slots, board, jitterPct: JITTER, rng });
    const basePlayers = results.map((r, idx) => {
      const g = r.generated;
      if (!g) return null;
      return {
        sleeperId: g.sleeperId,
        position: r.slot.position,
        ktcValue: g.value,
      };
    }).filter(Boolean);
    const nQb = basePlayers.filter((p) => p.position === 'QB').length;
    rosterQbSum += nQb;
    rosterN += 1;
    const bucket = nQb >= 4 ? '4+' : String(nQb);
    qbCountTally[bucket] += 1;

    for (const pair of pairs) {
      const { target } = findSwapTarget(basePlayers, pair);
      if (!target) continue;
      const key = pair.pairKey;
      if (!posTally[key]) posTally[key] = { QB: 0, RB: 0, WR: 0, TE: 0 };
      posTally[key][target.position] += 1;
      if (key === 'RB_vs_WR') {
        skillIntoQbHole.hits += 1;
        if (target.position === 'QB') {
          skillIntoQbHole.qbHoles += 1;
          if (nQb <= 2) skillIntoQbHole.qbHolesOn2qb += 1;
        }
      }
    }
  }
}

function pct(n, d) {
  return d ? `${((100 * n) / d).toFixed(1)}%` : '—';
}

console.log(`2024 KTC, ${BUILDS} builds × ${archetypes.length} archetypes, ${pairs.length} pairs`);
console.log(`mean QBs on built roster: ${(rosterQbSum / rosterN).toFixed(2)}`);
console.log('QB count distribution (builds):', qbCountTally);
console.log();
console.log('Swap target position by pair type:');
console.log(`${'pair'.padEnd(12)}${'n'.padStart(10)}  QB     RB     WR     TE`);
for (const key of Object.keys(posTally).sort()) {
  const t = posTally[key];
  const n = t.QB + t.RB + t.WR + t.TE;
  console.log(
    `${key.padEnd(12)}${String(n).padStart(10)}  ${pct(t.QB, n).padStart(6)} ${pct(t.RB, n).padStart(6)} ${pct(t.WR, n).padStart(6)} ${pct(t.TE, n).padStart(6)}`,
  );
}
console.log();
console.log(`RB vs WR hits: ${skillIntoQbHole.hits.toLocaleString()}`);
console.log(`  C is a QB: ${skillIntoQbHole.qbHoles.toLocaleString()} (${pct(skillIntoQbHole.qbHoles, skillIntoQbHole.hits)})`);
console.log(`  C is a QB on a ≤2-QB roster: ${skillIntoQbHole.qbHolesOn2qb.toLocaleString()} (${pct(skillIntoQbHole.qbHolesOn2qb, skillIntoQbHole.hits)})`);
