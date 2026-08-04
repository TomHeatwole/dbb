/**
 * run_hwang_true_sim_flex_study.mjs
 *
 * FLEX study: runs the "Regular" league format with 2 FLEX instead of 1
 * (1QB/2RB/3WR/1TE/2FLEX/1SF · 0.5 PPR · TE +0.5) for both value bases, and
 * dumps the analyzer CSVs. Compare against the v3b dump's `regular` format
 * (1 FLEX) to isolate what an extra FLEX slot does to RB/TE value.
 *
 * Usage: npx tsx scripts/run_hwang_true_sim_flex_study.mjs <outDir> [seed] [builds]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.resolve(process.argv[2]);
const SEED = Number(process.argv[3]) || 1;
const BUILDS = Number(process.argv[4]) || 200;
const JITTER = 10;

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

const { runHwangTrueSimulation } = await import(
  path.join(ROOT, 'site/src/hwangTrueSimulator/hwangTrueSimulatorEngine.js')
);

const FORMAT = {
  name: 'regular2',
  slotCounts: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPER: 1 },
  ppr: 0.5,
  tePremium: 0.5,
};
const BASES = ['ktc', 'comp'];

function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(filename, headerRow, rows) {
  const lines = [headerRow.join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  fs.writeFileSync(path.join(OUT_DIR, filename), `${lines.join('\n')}\n`);
  console.log(`  wrote ${filename}: ${rows.length.toLocaleString()} rows`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const runs = [];
for (const basis of BASES) {
  console.log(`\nRunning basis="${basis}" format="${FORMAT.name}" (${BUILDS} builds, seed ${SEED})…`);
  const t0 = Date.now();
  let lastPct = -10;
  // eslint-disable-next-line no-await-in-loop
  const results = await runHwangTrueSimulation({
    jitterPct: JITTER,
    seed: SEED,
    buildsPerArchetype: BUILDS,
    slotCounts: FORMAT.slotCounts,
    ppr: FORMAT.ppr,
    tePremium: FORMAT.tePremium,
    valueBasis: basis,
    onProgress: (p) => {
      const pct = Math.floor(p.fraction * 100);
      if (pct >= lastPct + 20) {
        lastPct = pct;
        console.log(`  ${pct}% ${p.label}`);
      }
    },
  });
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  runs.push({ basis, results });
}

writeCsv(
  'candidates.csv',
  ['value_basis', 'format', 'year', 'player_id', 'name', 'position', 'value', 'season_pts'],
  runs.flatMap(({ basis, results }) => results.years.flatMap((y) => y.candidates.map((c) => (
    [basis, FORMAT.name, y.year, c.playerId, c.name, c.position, c.value, c.seasonPts]
  )))),
);

writeCsv(
  'pairs.csv',
  ['value_basis', 'format', 'year', 'pair_key', 'player_id_a', 'player_id_b'],
  runs.flatMap(({ basis, results }) => results.years.flatMap((y) => y.pairs.map((p) => (
    [basis, FORMAT.name, y.year, p.pairKey, p.aId, p.bId]
  )))),
);

const hvorpRows = [];
for (const { basis, results } of runs) {
  for (const y of results.years) {
    for (const a of y.archetypes) {
      for (const [pid, avg] of Object.entries(a.hvorpAvgById)) {
        hvorpRows.push([basis, FORMAT.name, y.year, a.archetypeId, pid, avg,
          a.hvorpWeightedAvgById[pid], a.buildCount, a.avgBaseTotal]);
      }
    }
  }
}
writeCsv(
  'archetype_player_hvorp.csv',
  ['value_basis', 'format', 'year', 'archetype_id', 'player_id', 'avg_hvorp',
    'avg_hvorp_weighted', 'build_count', 'avg_base_total'],
  hvorpRows,
);

const matchupRows = [];
for (const { basis, results } of runs) {
  const push = (scope, year, archetypeId, matchups) => {
    for (const m of Object.values(matchups)) {
      matchupRows.push([basis, FORMAT.name, scope, year, archetypeId, m.pairKey, m.posA, m.posB,
        m.count, m.weightSum, m.totalA, m.totalB, m.relDiffPct]);
    }
  };
  push('overall', '', '', results.overall.matchups);
  for (const y of results.years) {
    push('year', y.year, '', y.matchups);
    for (const a of y.archetypes) push('archetype', y.year, a.archetypeId, a.matchups);
  }
}
writeCsv(
  'matchups.csv',
  ['value_basis', 'format', 'scope', 'year', 'archetype_id', 'pair_key', 'pos_a', 'pos_b',
    'pair_plugs', 'weight_sum', 'total_hvorp_a', 'total_hvorp_b', 'rel_diff_pct'],
  matchupRows,
);

console.log('\n=== regular2 multipliers (mean-grounded) ===');
for (const { basis, results } of runs) {
  console.log(`${basis}:`, results.overall.multipliers);
}
console.log('\nDone.');
