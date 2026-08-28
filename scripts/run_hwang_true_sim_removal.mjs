/**
 * Hwang-only leave-one-out (removal) HVORP grid.
 *
 * Same clubs as v3b, both Hwang and Regular scoring, but instead of adding a
 * 27th man from a large same-priced board pool, instantiate many more jittered
 * 26-mans and leave-one-out the players already on the roster. Cross-position
 * pairs are those same-roster players whose KTC values sit within ±5%.
 * Format factor is Hwang ÷ Regular from this same removal experiment — do not
 * mix with add-on format factors.
 *
 * Usage:
 *   npx tsx scripts/run_hwang_true_sim_removal.mjs [seed] [builds] [outDir]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.argv[4]
  ? path.resolve(process.argv[4])
  : path.join(ROOT, 'example_data', 'hwang_true_sim_removal');
const SEED = Number(process.argv[2]) || 1;
const BUILDS = Number(process.argv[3]) || 1000;
const JITTER = 10;
const BASES = (process.env.REMOVAL_BASES || 'ktc,comp').split(',').map((s) => s.trim()).filter(Boolean);
const FORMAT_NAMES = (process.env.REMOVAL_FORMATS || 'hwang,regular').split(',').map((s) => s.trim()).filter(Boolean);

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

const FORMAT_DEFS = {
  hwang: {
    name: 'hwang',
    slotCounts: { QB: 1, RB: 3, WR: 3, TE: 1, FLEX: 2, SUPER: 1 },
    ppr: 0,
    tePremium: 0.5,
  },
  regular: {
    name: 'regular',
    slotCounts: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPER: 1 },
    ppr: 0.5,
    tePremium: 0.5,
  },
};
const FORMATS = FORMAT_NAMES.map((name) => {
  const format = FORMAT_DEFS[name];
  if (!format) throw new Error(`Unknown format "${name}"`);
  return format;
});

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

fs.mkdirSync(OUT_DIR, { recursive: true });
const runs = [];
for (const basis of BASES) {
  for (const format of FORMATS) {
    console.log(`\nRunning basis="${basis}" format="${format.name}" removal-mode (${BUILDS} builds, seed ${SEED})…`);
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
      hvorpMode: 'removal',
      onProgress: (p) => {
        const pct = Math.floor(p.fraction * 100);
        if (pct >= lastPct + 5) {
          lastPct = pct;
          console.log(`  ${pct}% ${p.label}`);
        }
      },
    });
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    const pairs = results.years.reduce((s, y) => s + (y.removalPairs || y.pairCount || 0), 0);
    const appeared = results.years.reduce((s, y) => s + (y.candidateCount || 0), 0);
    console.log(`  same-roster comparable-KTC pairs: ${pairs.toLocaleString()}  `
      + `(unique rostered players across years: ${appeared.toLocaleString()})`);
    console.log(`  multipliers:`, results.overall.multipliers);
    runs.push({ basis, format, results });
  }
}

console.log(`\nWriting CSVs to ${path.relative(ROOT, OUT_DIR)}/`);

writeCsv(
  'config.csv',
  ['value_basis', 'format', 'qb', 'rb', 'wr', 'te', 'flex', 'superflex', 'ppr', 'te_premium',
    'builds_per_archetype', 'jitter_pct', 'seed', 'years', 'archetype_count',
    'grounding', 'value_weight_pairs', 'points_weight_builds',
    'pair_tolerance_pct', 'top_rank', 'ktc_as_of', 'hvorp_method', 'hvorp_mode'],
  runs.map(({ basis, format, results }) => {
    const c = results.config;
    return [basis, format.name, c.slotCounts.QB, c.slotCounts.RB, c.slotCounts.WR, c.slotCounts.TE,
      c.slotCounts.FLEX, c.slotCounts.SUPER, c.ppr, c.tePremium,
      c.buildsPerArchetype, c.jitterPct, c.seed, c.years.join('|'), c.archetypeCount,
      c.grounding, c.valueWeightPairs ? 1 : 0, c.pointsWeightBuilds ? 1 : 0,
      c.tolerancePct, c.topKtcRank, c.ktcAsOf, c.hvorpMethod, c.hvorpMode];
  }),
);

writeCsv(
  'years.csv',
  ['value_basis', 'format', 'year', 'candidate_count', 'excluded_zero_point', 'pool_size', 'pair_count',
    'removal_pairs'],
  runs.flatMap(({ basis, format, results }) => results.years.map((y) => (
    [basis, format.name, y.year, y.candidateCount, y.excludedZeroPoint, y.poolSize, y.pairCount,
      y.removalPairs || y.pairCount || 0]
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

const hvorpRows = [];
for (const { basis, format, results } of runs) {
  for (const y of results.years) {
    for (const a of y.archetypes) {
      for (const [pid, avg] of Object.entries(a.hvorpAvgById)) {
        hvorpRows.push([basis, format.name, y.year, a.archetypeId, pid, avg,
          a.hvorpWeightedAvgById[pid], a.buildCount, a.avgBaseTotal, a.removalPairs || 0]);
      }
    }
  }
}
writeCsv(
  'archetype_player_hvorp.csv',
  ['value_basis', 'format', 'year', 'archetype_id', 'player_id', 'avg_hvorp',
    'avg_hvorp_weighted', 'build_count', 'avg_base_total', 'removal_pairs'],
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

const archPairRows = [];
for (const { basis, format, results } of runs) {
  for (const y of results.years) {
    for (const a of y.archetypes) {
      archPairRows.push([basis, format.name, y.year, a.archetypeId, a.label,
        a.buildCount, a.removalPairs || 0]);
    }
  }
}
writeCsv(
  'archetype_removal_pairs.csv',
  ['value_basis', 'format', 'year', 'archetype_id', 'archetype_label', 'build_count', 'removal_pairs'],
  archPairRows,
);

console.log('\n=== Multipliers (mean-grounded, weighted, same-roster leave-one-out) ===');
for (const { basis, format, results } of runs) {
  console.log(`${basis} / ${format.name} removal:`, results.overall.multipliers);
}
const POS4 = ['QB', 'RB', 'WR', 'TE'];
for (const basis of BASES) {
  const h = runs.find((r) => r.basis === basis && r.format.name === 'hwang');
  const g = runs.find((r) => r.basis === basis && r.format.name === 'regular');
  if (!h || !g) continue;
  console.log(`\n=== ${basis}: format factors (hwang ÷ regular, removal HVORP) ===`);
  for (const pos of POS4) {
    const fa = h.results.overall.multipliers[pos];
    const fb = g.results.overall.multipliers[pos];
    console.log(`  ${pos}: ${(fa / fb).toFixed(3)}   (Hwang ${fa.toFixed(3)} / Regular ${fb.toFixed(3)})`);
  }
}
console.log('\nDone.');
