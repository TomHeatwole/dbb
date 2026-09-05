/**
 * Residual quantiles around each HProj variance bucket.
 *
 * residual = week − player-season PPG. Outcome at percentile p is
 *   projection + residual_p
 * so the mean stays on the projection and the bucket's skew/tails move with it.
 *
 * Usage:
 *   npx tsx scripts/build_hproj_residual_quantiles.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YEARS = [2021, 2022, 2023, 2024, 2025];
const NUM_WEEKS = 17;
const MIN_GAMES = 6;
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const CACHE_DIR = path.join(ROOT, 'tmp/jaml_bb_sim_cache');
const PCTS = [0.10, 0.20, 0.25, 0.50, 0.75, 0.80, 0.90, 0.95];

const { calculateFantasyPoints } = await import(
  path.join(ROOT, 'site/src/data_parse/fantasyCalculator.js')
);
const { mapSleeperStats } = await import(
  path.join(ROOT, 'site/src/scenarios/sleeperScoring.js')
);
const { HPROJ_VARIANCE_BUCKETS } = await import(
  path.join(ROOT, 'site/src/scores/hprojVarianceBuckets.js')
);

const scoringConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'site/public/data/score_format.json'), 'utf8'),
);
const playersDump = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'site/public/data/players.txt'), 'utf8'),
);

function fantasyPosition(player) {
  if (!player) return null;
  const skill = new Set(POSITIONS);
  const raw = player.position === 'FB' ? 'RB' : player.position;
  if (skill.has(raw)) return raw;
  for (const p of player.fantasy_positions || []) {
    const mapped = p === 'FB' ? 'RB' : p;
    if (skill.has(mapped)) return mapped;
  }
  return null;
}

function playedWeek(stats) {
  if (!stats || typeof stats !== 'object') return false;
  const n = (k) => Number(stats[k]) || 0;
  if (n('off_snp') > 0 || n('pass_att') > 0 || n('rush_att') > 0 || n('rec') > 0 || n('rec_tgt') > 0) {
    return true;
  }
  return n('gp') >= 1;
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function r2(n) { return Math.round(n * 100) / 100; }

function bandIndex(bands, ppg) {
  let idx = 0;
  for (let i = 0; i < bands.length; i += 1) {
    if (ppg >= bands[i].lo) idx = i;
    else break;
  }
  return idx;
}

const positionById = new Map();
for (const [pid, player] of Object.entries(playersDump)) {
  const pos = fantasyPosition(player);
  if (pos) positionById.set(String(pid), pos);
}

const seasons = { QB: [], RB: [], WR: [], TE: [] };
for (const year of YEARS) {
  const weeks = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `sleeper_weeks_${year}.json`), 'utf8'));
  const seasonWeeks = new Map();
  for (let w = 0; w < NUM_WEEKS; w += 1) {
    const weekly = weeks[w] || {};
    for (const [pid, stats] of Object.entries(weekly)) {
      const pos = positionById.get(pid);
      if (!pos || !playedWeek(stats)) continue;
      const pts = calculateFantasyPoints(mapSleeperStats(stats, pos), scoringConfig);
      if (!seasonWeeks.has(pid)) seasonWeeks.set(pid, { pos, weeks: [] });
      seasonWeeks.get(pid).weeks.push(pts);
    }
  }
  for (const { pos, weeks: played } of seasonWeeks.values()) {
    if (played.length < MIN_GAMES) continue;
    const ppg = played.reduce((s, v) => s + v, 0) / played.length;
    seasons[pos].push({ ppg, weeks: played });
  }
}

const result = { positions: {} };

for (const pos of POSITIONS) {
  const bands = HPROJ_VARIANCE_BUCKETS[pos];
  const residuals = bands.map(() => []);
  for (const s of seasons[pos]) {
    const i = bandIndex(bands, s.ppg);
    for (const week of s.weeks) residuals[i].push(week - s.ppg);
  }

  result.positions[pos] = bands.map((band, i) => {
    const vals = residuals[i].sort((a, b) => a - b);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const q = {};
    for (const p of PCTS) q[`p${Math.round(p * 100)}`] = r2(quantile(vals, p));
    console.log(
      `${pos.padEnd(3)} ${band.label.padEnd(6)}  n=${String(vals.length).padStart(5)}  ` +
      `μ=${r2(mean).toFixed(2)}  P20=${q.p20}  P50=${q.p50}  P80=${q.p80}  P90=${q.p90}`,
    );
    return { ...band, resid: q, residMean: r2(mean), residN: vals.length };
  });
}

const examples = [
  ['WR', 13], ['WR', 8], ['WR', 5],
  ['RB', 14], ['RB', 8],
  ['TE', 9], ['TE', 5],
  ['QB', 18], ['QB', 12], ['QB', 22],
];
console.log('\nExample outcomes (proj + residual quantile)');
for (const [pos, proj] of examples) {
  const bands = result.positions[pos];
  let band = bands[0];
  for (const b of bands) {
    if (proj >= b.lo) band = b;
    else break;
  }
  const p20 = r2(proj + band.resid.p20);
  const p50 = r2(proj + band.resid.p50);
  const p80 = r2(proj + band.resid.p80);
  const p90 = r2(proj + band.resid.p90);
  console.log(`  ${pos} ${String(proj).padStart(2)}  ${band.label.padEnd(6)}  P20=${p20}  P50=${p50}  P80=${p80}  P90=${p90}`);
}

fs.writeFileSync(
  path.join(ROOT, 'tmp/hproj_residual_quantiles.json'),
  JSON.stringify(result, null, 2),
);
