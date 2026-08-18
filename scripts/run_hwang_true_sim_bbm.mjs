/**
 * run_hwang_true_sim_bbm.mjs
 *
 * HVORP grid on Underdog Best Ball Mania construction archetypes
 * (example_data/underdog_bbm_archetype_rosters.csv):
 *
 *   value basis  × format
 *   {ktc, comp}  × {hwang, regular}
 *
 * Roster construction is always the BBM rank ladder instantiated onto the
 * competitor-adjusted (redraft) board — so the KTC pairing run does not
 * rebuild teams as dynasty clubs. Pair prices / value-weights follow
 * valueBasis.
 *
 * Formats:
 *   hwang    1QB/3RB/3WR/1TE/2FLEX/1SF · 0 PPR · TE +0.5
 *   regular  true Underdog: 1QB/2RB/3WR/1TE/1FLEX · 0.5 PPR · no TEP · no SF
 *
 * Usage:
 *   npx tsx scripts/run_hwang_true_sim_bbm.mjs [seed] [builds] [outDir]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.argv[4]
  ? path.resolve(process.argv[4])
  : path.join(ROOT, 'example_data', 'hwang_true_sim_bbm_50');
const SEED = Number(process.argv[2]) || 1;
const BUILDS = Number(process.argv[3]) || 50;
const JITTER = 10;
const ARCH_CSV = path.join(ROOT, 'example_data', 'underdog_bbm_archetype_rosters.csv');
const ARCH_META = JSON.stringify({
  generatedAt: new Date().toISOString(),
  ktcAsOf: null,
  selection: { note: 'synthetic Underdog BBM rank ladders; constructionBasis=comp' },
});

process.env.REACT_APP_SITE_SETTINGS = fs.readFileSync(
  path.join(ROOT, 'settings/settings.json'), 'utf8',
);

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/')) {
    if (url === '/data/archetype_rosters.csv') {
      const text = fs.readFileSync(ARCH_CSV, 'utf8');
      return { ok: true, status: 200, text: async () => text, json: async () => null };
    }
    if (url === '/data/archetype_rosters_meta.json') {
      return { ok: true, status: 200, text: async () => ARCH_META, json: async () => JSON.parse(ARCH_META) };
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

const FORMATS = [
  {
    name: 'hwang',
    slotCounts: { QB: 1, RB: 3, WR: 3, TE: 1, FLEX: 2, SUPER: 1 },
    ppr: 0,
    tePremium: 0.5,
  },
  {
    name: 'regular',
    slotCounts: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPER: 0 },
    ppr: 0.5,
    tePremium: 0,
  },
];
const BASES = ['ktc', 'comp'];

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

if (!fs.existsSync(ARCH_CSV)) {
  throw new Error(`Missing ${ARCH_CSV} — run scripts/write_underdog_bbm_archetypes.py`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const runs = [];
for (const basis of BASES) {
  for (const format of FORMATS) {
    console.log(`\nRunning basis="${basis}" format="${format.name}" (${BUILDS} builds, seed ${SEED})…`);
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
      valueBasis: basis,
      constructionBasis: 'comp',
      onProgress: (p) => {
        const pct = Math.floor(p.fraction * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          console.log(`  ${pct}% ${p.label}`);
        }
      },
    });
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    runs.push({ basis, format, results });
  }
}

console.log(`\nWriting CSVs to ${path.relative(ROOT, OUT_DIR)}/`);

writeCsv(
  'config.csv',
  ['value_basis', 'construction_basis', 'format', 'qb', 'rb', 'wr', 'te', 'flex', 'superflex',
    'ppr', 'te_premium', 'builds_per_archetype', 'jitter_pct', 'seed', 'years',
    'archetype_count', 'grounding', 'value_weight_pairs', 'points_weight_builds',
    'pair_tolerance_pct', 'top_rank', 'ktc_as_of', 'hvorp_method'],
  runs.map(({ basis, format, results }) => {
    const c = results.config;
    return [basis, c.constructionBasis, format.name, c.slotCounts.QB, c.slotCounts.RB,
      c.slotCounts.WR, c.slotCounts.TE, c.slotCounts.FLEX, c.slotCounts.SUPER, c.ppr, c.tePremium,
      c.buildsPerArchetype, c.jitterPct, c.seed, c.years.join('|'), c.archetypeCount,
      c.grounding, c.valueWeightPairs ? 1 : 0, c.pointsWeightBuilds ? 1 : 0,
      c.tolerancePct, c.topKtcRank, c.ktcAsOf, c.hvorpMethod];
  }),
);

writeCsv(
  'years.csv',
  ['value_basis', 'format', 'year', 'candidate_count', 'excluded_zero_point', 'pool_size', 'pair_count'],
  runs.flatMap(({ basis, format, results }) => results.years.map((y) => (
    [basis, format.name, y.year, y.candidateCount, y.excludedZeroPoint, y.poolSize, y.pairCount]
  ))),
);

const matchupRows = [];
for (const { basis, format, results } of runs) {
  const push = (scope, year, archetypeId, matchups) => {
    for (const m of Object.values(matchups)) {
      matchupRows.push([basis, format.name, scope, year, archetypeId, m.pairKey, m.posA, m.posB,
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

writeCsv(
  'candidates.csv',
  ['value_basis', 'format', 'year', 'player_id', 'name', 'position', 'value', 'season_pts'],
  runs.flatMap(({ basis, format, results }) => results.years.flatMap((y) => y.candidates.map((c) => (
    [basis, format.name, y.year, c.playerId, c.name, c.position, c.value, c.seasonPts]
  )))),
);

writeCsv(
  'pairs.csv',
  ['value_basis', 'format', 'year', 'pair_key', 'player_id_a', 'player_id_b'],
  runs.flatMap(({ basis, format, results }) => results.years.flatMap((y) => y.pairs.map((p) => (
    [basis, format.name, y.year, p.pairKey, p.aId, p.bId]
  )))),
);

const hvorpRows = [];
for (const { basis, format, results } of runs) {
  for (const y of results.years) {
    for (const a of y.archetypes) {
      for (const [pid, avg] of Object.entries(a.hvorpAvgById)) {
        hvorpRows.push([basis, format.name, y.year, a.archetypeId, pid, avg,
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

const buildRows = [];
for (const { basis, format, results } of runs) {
  for (const y of results.years) {
    for (const a of y.archetypes) {
      for (const b of a.builds) {
        for (const p of b.players) {
          buildRows.push([basis, format.name, y.year, a.archetypeId, a.label, b.buildIndex,
            b.totalKtc, p.sleeperId, p.name, p.position, p.posRank, p.ktcValue,
            p.sourcePlayer, p.seasonPts, p.hvorp, p.dropped ? 1 : 0, p.offBoard ? 1 : 0]);
        }
      }
    }
  }
}
writeCsv(
  'build_players.csv',
  ['value_basis', 'format', 'year', 'archetype_id', 'archetype_label', 'build_index', 'build_total_value',
    'player_id', 'name', 'position', 'pos_rank', 'value', 'source_player',
    'season_pts', 'hvorp', 'dropped', 'off_board'],
  buildRows,
);

console.log('\n=== Multipliers (mean-grounded, weighted, full comparison network) ===');
for (const { basis, format, results } of runs) {
  console.log(`${basis} / ${format.name}:`, results.overall.multipliers);
}
for (const basis of BASES) {
  const h = runs.find((r) => r.basis === basis && r.format.name === 'hwang');
  const g = runs.find((r) => r.basis === basis && r.format.name === 'regular');
  console.log(`\n=== ${basis}: format factors (hwang ÷ regular) ===`);
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const fa = h.results.overall.multipliers[pos];
    const fb = g.results.overall.multipliers[pos];
    console.log(`  ${pos}: ${(fa / fb).toFixed(3)}`);
  }
}
console.log('\nDone.');
