/**
 * run_hwang_true_sim_example.mjs
 *
 * Runs the Hwang True Simulator engine headlessly in compare mode (Hwang format
 * vs Generic SF format, identical roster builds/seed) and dumps 100% of the
 * results to CSVs under example_data/hwang_true_sim/ for offline analytics.
 *
 * Usage (tsx handles the engine's CRA-style extensionless imports):
 *   npx tsx scripts/run_hwang_true_sim_example.mjs [seed]
 *
 * Output files (all long/tidy format, joined by format/year/archetype_id/player_id):
 *   config.csv             one row per format run (lineup, scoring, jitter, seed…)
 *   years.csv              per format × year: candidate/pair pool sizes
 *   matchups.csv           every matchup aggregate at overall / year / archetype scope
 *   candidates.csv         per format × year: the paired candidate pool w/ season pts
 *   pairs.csv              every value-matched pair (±5% KTC) per format × year
 *   archetype_player_hvorp.csv  avg HVORP of every evaluated player on every archetype
 *   build_players.csv      every player of every stored jittered build (27 × builds)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'example_data', 'hwang_true_sim');
const SEED = Number(process.argv[2]) || 1;
const BUILDS = 10;
const JITTER = 10;

process.env.REACT_APP_SITE_SETTINGS = fs.readFileSync(
  path.join(ROOT, 'settings/settings.json'), 'utf8',
);

// The engine fetches /data/... paths; serve them from site/public.
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

const FORMATS = [
  {
    name: 'hwang',
    slotCounts: { QB: 1, RB: 3, WR: 3, TE: 1, FLEX: 2, SUPER: 1 },
    ppr: 0,
    tePremium: 0.5,
  },
  {
    name: 'generic_sf',
    slotCounts: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPER: 1 },
    ppr: 1,
    tePremium: 0,
  },
];

// ── CSV helpers ───────────────────────────────────────────────────────────────

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
  const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`  wrote ${filename}: ${rows.length.toLocaleString()} rows (${mb} MB)`);
}

// ── Run both formats ──────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });
const runs = [];
for (const format of FORMATS) {
  console.log(`\nRunning format "${format.name}"…`);
  const t0 = Date.now();
  let lastPct = -10;
  // eslint-disable-next-line no-await-in-loop
  const results = await runHwangTrueSimulation({
    jitterPct: JITTER,
    seed: SEED,
    buildsPerArchetype: BUILDS,
    slotCounts: format.slotCounts,
    ppr: format.ppr,
    tePremium: format.tePremium,
    onProgress: (p) => {
      const pct = Math.floor(p.fraction * 100);
      if (pct >= lastPct + 10) {
        lastPct = pct;
        console.log(`  ${pct}% ${p.label}`);
      }
    },
  });
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  runs.push({ format, results });
}

// ── Dump CSVs ─────────────────────────────────────────────────────────────────

console.log(`\nWriting CSVs to ${path.relative(ROOT, OUT_DIR)}/`);

writeCsv(
  'config.csv',
  ['format', 'qb', 'rb', 'wr', 'te', 'flex', 'superflex', 'ppr', 'te_premium',
    'builds_per_archetype', 'jitter_pct', 'seed', 'years', 'archetype_count',
    'pair_tolerance_pct', 'top_ktc_rank', 'ktc_as_of', 'hvorp_method'],
  runs.map(({ format, results }) => {
    const c = results.config;
    return [format.name, c.slotCounts.QB, c.slotCounts.RB, c.slotCounts.WR, c.slotCounts.TE,
      c.slotCounts.FLEX, c.slotCounts.SUPER, c.ppr, c.tePremium,
      c.buildsPerArchetype, c.jitterPct, c.seed, c.years.join('|'), c.archetypeCount,
      c.tolerancePct, c.topKtcRank, c.ktcAsOf, c.hvorpMethod];
  }),
);

writeCsv(
  'years.csv',
  ['format', 'year', 'candidate_count', 'excluded_zero_point', 'pool_size', 'pair_count'],
  runs.flatMap(({ format, results }) => results.years.map((y) => (
    [format.name, y.year, y.candidateCount, y.excludedZeroPoint, y.poolSize, y.pairCount]
  ))),
);

const matchupRows = [];
for (const { format, results } of runs) {
  const push = (scope, year, archetypeId, matchups) => {
    for (const m of Object.values(matchups)) {
      matchupRows.push([format.name, scope, year, archetypeId, m.pairKey, m.posA, m.posB,
        m.count, m.totalA, m.totalB, m.relDiffPct]);
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
  ['format', 'scope', 'year', 'archetype_id', 'pair_key', 'pos_a', 'pos_b',
    'pair_plugs', 'total_hvorp_a', 'total_hvorp_b', 'rel_diff_pct'],
  matchupRows,
);

writeCsv(
  'candidates.csv',
  ['format', 'year', 'player_id', 'name', 'position', 'ktc_value', 'season_pts'],
  runs.flatMap(({ format, results }) => results.years.flatMap((y) => y.candidates.map((c) => (
    [format.name, y.year, c.playerId, c.name, c.position, c.value, c.seasonPts]
  )))),
);

writeCsv(
  'pairs.csv',
  ['format', 'year', 'pair_key', 'player_id_a', 'player_id_b'],
  runs.flatMap(({ format, results }) => results.years.flatMap((y) => y.pairs.map((p) => (
    [format.name, y.year, p.pairKey, p.aId, p.bId]
  )))),
);

const hvorpRows = [];
for (const { format, results } of runs) {
  for (const y of results.years) {
    for (const a of y.archetypes) {
      for (const [pid, avg] of Object.entries(a.hvorpAvgById)) {
        hvorpRows.push([format.name, y.year, a.archetypeId, pid, avg, a.buildCount]);
      }
    }
  }
}
writeCsv(
  'archetype_player_hvorp.csv',
  ['format', 'year', 'archetype_id', 'player_id', 'avg_hvorp', 'build_count'],
  hvorpRows,
);

const buildRows = [];
for (const { format, results } of runs) {
  for (const y of results.years) {
    for (const a of y.archetypes) {
      for (const b of a.builds) {
        for (const p of b.players) {
          buildRows.push([format.name, y.year, a.archetypeId, a.label, b.buildIndex,
            b.totalKtc, p.sleeperId, p.name, p.position, p.posRank, p.ktcValue,
            p.sourcePlayer, p.seasonPts, p.hvorp, p.dropped ? 1 : 0, p.offBoard ? 1 : 0]);
        }
      }
    }
  }
}
writeCsv(
  'build_players.csv',
  ['format', 'year', 'archetype_id', 'archetype_label', 'build_index', 'build_total_ktc',
    'player_id', 'name', 'position', 'pos_rank', 'ktc_value', 'source_player',
    'season_pts', 'hvorp', 'dropped', 'off_board'],
  buildRows,
);

// ── Sanity summary ────────────────────────────────────────────────────────────

console.log('\n=== Multipliers (QB-grounded) ===');
for (const { format, results } of runs) {
  console.log(`${format.name}:`, results.overall.multipliers);
}
const [a, b] = runs;
console.log('\n=== Format factors (hwang ÷ generic_sf) ===');
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  const fa = a.results.overall.multipliers[pos];
  const fb = b.results.overall.multipliers[pos];
  console.log(`  ${pos}: ${(fa / fb).toFixed(3)}`);
}
console.log('\nDone.');
