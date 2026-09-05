/**
 * Weekly score stddev + skew by position and integer PPG bucket.
 *
 * Last 5 complete seasons (2021–2025), Hwang scoring (0 PPR, TE +0.5).
 * A player-season is bucketed by round(mean of weeks they actually played).
 *
 * Usage:
 *   npx tsx scripts/analyze_weekly_score_stddev.mjs
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

const { calculateFantasyPoints } = await import(
  path.join(ROOT, 'site/src/data_parse/fantasyCalculator.js')
);
const { mapSleeperStats } = await import(
  path.join(ROOT, 'site/src/scenarios/sleeperScoring.js')
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
  const fantasy = player.fantasy_positions || [];
  for (const p of fantasy) {
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

function summarize(values) {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  let m2 = 0;
  let m3 = 0;
  for (const v of values) {
    const d = v - mean;
    m2 += d * d;
    m3 += d * d * d;
  }
  const variance = m2 / (n - 1);
  const std = Math.sqrt(variance);
  const sorted = [...values].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  // Bias-corrected Fisher-Pearson skewness (G1)
  const g1 = n >= 3 && std > 0
    ? (n / ((n - 1) * (n - 2))) * (m3 / (std ** 3))
    : null;
  const p10 = quantile(sorted, 0.10);
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);
  const p90 = quantile(sorted, 0.90);
  const leftTail = median - p10;
  const rightTail = p90 - median;
  return {
    n,
    mean: round2(mean),
    median: round2(median),
    std: round2(std),
    cv: mean > 0 ? round3(std / mean) : null,
    skew: g1 == null ? null : round3(g1),
    meanMinusMedian: round2(mean - median),
    p10: round2(p10),
    p25: round2(p25),
    p75: round2(p75),
    p90: round2(p90),
    tailRatio: leftTail > 0.25 ? round3(rightTail / leftTail) : null,
  };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }

const positionById = new Map();
for (const [pid, player] of Object.entries(playersDump)) {
  const pos = fantasyPosition(player);
  if (pos) positionById.set(String(pid), pos);
}

const buckets = {};
for (const pos of POSITIONS) buckets[pos] = new Map();

const diagnostics = {
  years: YEARS,
  minGames: MIN_GAMES,
  scoring: 'Hwang 0 PPR / TE +0.5',
  playerSeasons: 0,
  skippedFewGames: 0,
  weeksPlayed: 0,
  snapFieldCoverage: { withOffSnp: 0, gpOnly: 0 },
};

for (const year of YEARS) {
  const cachePath = path.join(CACHE_DIR, `sleeper_weeks_${year}.json`);
  if (!fs.existsSync(cachePath)) {
    throw new Error(`Missing weekly cache ${cachePath}`);
  }
  const weeks = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  if (!Array.isArray(weeks) || weeks.length < NUM_WEEKS) {
    throw new Error(`Weekly cache for ${year} has ${weeks?.length} weeks, need ${NUM_WEEKS}`);
  }

  const seasonWeeks = new Map(); // pid → number[]
  for (let w = 0; w < NUM_WEEKS; w += 1) {
    const weekly = weeks[w] || {};
    for (const [pid, stats] of Object.entries(weekly)) {
      const pos = positionById.get(pid);
      if (!pos) continue;
      if (!playedWeek(stats)) continue;
      const n = (k) => Number(stats[k]) || 0;
      if (n('off_snp') > 0) diagnostics.snapFieldCoverage.withOffSnp += 1;
      else if (n('gp') >= 1) diagnostics.snapFieldCoverage.gpOnly += 1;
      const pts = calculateFantasyPoints(mapSleeperStats(stats, pos), scoringConfig);
      if (!seasonWeeks.has(pid)) seasonWeeks.set(pid, { pos, weeks: [] });
      seasonWeeks.get(pid).weeks.push(pts);
    }
  }

  for (const { pos, weeks: played } of seasonWeeks.values()) {
    if (played.length < MIN_GAMES) {
      diagnostics.skippedFewGames += 1;
      continue;
    }
    diagnostics.playerSeasons += 1;
    diagnostics.weeksPlayed += played.length;
    const avg = played.reduce((s, v) => s + v, 0) / played.length;
    const bucket = Math.round(avg);
    if (!buckets[pos].has(bucket)) buckets[pos].set(bucket, { seasons: 0, weeks: [] });
    const rec = buckets[pos].get(bucket);
    rec.seasons += 1;
    rec.weeks.push(...played);
  }
  console.log(`${year}: ${seasonWeeks.size} skill player-seasons in weekly files`);
}

const result = {
  meta: diagnostics,
  positions: {},
};

for (const pos of POSITIONS) {
  const rows = [];
  const keys = [...buckets[pos].keys()].sort((a, b) => a - b);
  for (const bucket of keys) {
    const rec = buckets[pos].get(bucket);
    const stats = summarize(rec.weeks);
    if (!stats) continue;
    rows.push({
      bucket,
      seasons: rec.seasons,
      ...stats,
    });
  }
  result.positions[pos] = rows;
}

const outPath = path.join(ROOT, 'tmp/weekly_score_stddev_buckets.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`\nWrote ${outPath}`);
console.log(JSON.stringify(diagnostics, null, 2));
for (const pos of POSITIONS) {
  const rows = result.positions[pos];
  console.log(`\n=== ${pos} (${rows.length} buckets) ===`);
  console.log('avg  nS   nW    mean   med    std   cv    skew  μ-med  tailR');
  for (const r of rows) {
    if (r.seasons < 3 && r.n < 30) continue;
    const pad = (v, w) => String(v ?? '—').padStart(w);
    console.log(
      `${pad(r.bucket, 3)} ${pad(r.seasons, 4)} ${pad(r.n, 5)} ${pad(r.mean, 6)} ${pad(r.median, 6)} ${pad(r.std, 5)} ${pad(r.cv, 6)} ${pad(r.skew, 6)} ${pad(r.meanMinusMedian, 6)} ${pad(r.tailRatio, 6)}`,
    );
  }
}
