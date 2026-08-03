/**
 * run_hwang_true_sim_equilibrium.mjs
 *
 * Equilibrium iteration for the Hwang True Simulator: reprices the
 * competitor-adjusted value board with the fitted v3 power-law curves
 * (v' = v · c · (v/5000)^k), then re-runs the Hwang-format simulation on the
 * corrected board. If the curves are right, the corrected prices should show
 * ~flat multipliers (~1.0 everywhere) — there is no residual edge left.
 *
 * Within-position order is preserved by the correction (k > -1 for every
 * position), so roster builds are identical to the uncorrected comp run;
 * only cross-position pairing and value weighting change.
 *
 * Usage:
 *   npx tsx scripts/run_hwang_true_sim_equilibrium.mjs <paramsJson> <outDir> [seed] [builds]
 *
 * paramsJson: {"QB": {"c": 0.9, "k": 0.17}, "RB": ..., "WR": ..., "TE": ...}
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARAMS = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
const OUT_DIR = path.resolve(process.argv[3]);
const SEED = Number(process.argv[4]) || 1;
const BUILDS = Number(process.argv[5]) || 200;
const JITTER = 10;
const VREF = 5000;

process.env.REACT_APP_SITE_SETTINGS = fs.readFileSync(
  path.join(ROOT, 'settings/settings.json'), 'utf8',
);

// ── Build the corrected comp CSV in memory ────────────────────────────────────

function multiplierAt(pos, value) {
  const p = PARAMS[pos];
  if (!p) return 1;
  const v = Math.max(value, 100);
  return p.c * ((v / VREF) ** p.k);
}

const COMP_PATH = '/data/final_ktc_redraft_value_index.csv';
const rawComp = fs.readFileSync(path.join(ROOT, 'site/public', COMP_PATH), 'utf8');
const compLines = rawComp.trim().split('\n');
const header = compLines[0].split(',');
const posIdx = header.indexOf('position');
const valIdx = header.indexOf('competitor_adjusted_value');
const corrected = [compLines[0]];
for (let i = 1; i < compLines.length; i++) {
  // Comp CSV has no quoted fields; simple split is safe.
  const cols = compLines[i].split(',');
  const value = Number(cols[valIdx]);
  if (Number.isFinite(value) && value > 0) {
    cols[valIdx] = String(Math.round(value * multiplierAt((cols[posIdx] || '').toUpperCase(), value)));
  }
  corrected.push(cols.join(','));
}
const correctedCsv = `${corrected.join('\n')}\n`;
console.log(`Corrected ${corrected.length - 1} comp rows with`, PARAMS);

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/')) {
    if (url === COMP_PATH) {
      return { ok: true, status: 200, text: async () => correctedCsv, json: async () => null };
    }
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

// ── Run (Hwang format, corrected comp basis) ──────────────────────────────────

console.log(`\nRunning corrected-comp / hwang (${BUILDS} builds, seed ${SEED})…`);
const t0 = Date.now();
let lastPct = -10;
const results = await runHwangTrueSimulation({
  jitterPct: JITTER,
  seed: SEED,
  buildsPerArchetype: BUILDS,
  slotCounts: { QB: 1, RB: 3, WR: 3, TE: 1, FLEX: 2, SUPER: 1 },
  ppr: 0,
  tePremium: 0.5,
  valueBasis: 'comp',
  onProgress: (p) => {
    const pct = Math.floor(p.fraction * 100);
    if (pct >= lastPct + 10) {
      lastPct = pct;
      console.log(`  ${pct}% ${p.label}`);
    }
  },
});
console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ── Dump the CSVs the validation analyzer needs ───────────────────────────────

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
const basis = 'comp';
const fmtName = 'hwang';

writeCsv(
  'candidates.csv',
  ['value_basis', 'format', 'year', 'player_id', 'name', 'position', 'value', 'season_pts'],
  results.years.flatMap((y) => y.candidates.map((c) => (
    [basis, fmtName, y.year, c.playerId, c.name, c.position, c.value, c.seasonPts]
  ))),
);

writeCsv(
  'pairs.csv',
  ['value_basis', 'format', 'year', 'pair_key', 'player_id_a', 'player_id_b'],
  results.years.flatMap((y) => y.pairs.map((p) => (
    [basis, fmtName, y.year, p.pairKey, p.aId, p.bId]
  ))),
);

const hvorpRows = [];
for (const y of results.years) {
  for (const a of y.archetypes) {
    for (const [pid, avg] of Object.entries(a.hvorpAvgById)) {
      hvorpRows.push([basis, fmtName, y.year, a.archetypeId, pid, avg,
        a.hvorpWeightedAvgById[pid], a.buildCount, a.avgBaseTotal]);
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
const push = (scope, year, archetypeId, matchups) => {
  for (const m of Object.values(matchups)) {
    matchupRows.push([basis, fmtName, scope, year, archetypeId, m.pairKey, m.posA, m.posB,
      m.count, m.weightSum, m.totalA, m.totalB, m.relDiffPct]);
  }
};
push('overall', '', '', results.overall.matchups);
for (const y of results.years) {
  push('year', y.year, '', y.matchups);
  for (const a of y.archetypes) push('archetype', y.year, a.archetypeId, a.matchups);
}
writeCsv(
  'matchups.csv',
  ['value_basis', 'format', 'scope', 'year', 'archetype_id', 'pair_key', 'pos_a', 'pos_b',
    'pair_plugs', 'weight_sum', 'total_hvorp_a', 'total_hvorp_b', 'rel_diff_pct'],
  matchupRows,
);

console.log('\n=== Corrected-board multipliers (mean-grounded) ===');
console.log(results.overall.multipliers);
console.log('\nDone.');
