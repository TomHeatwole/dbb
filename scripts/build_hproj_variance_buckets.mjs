/**
 * Build monotonic weekly-variance buckets for HProj.
 *
 * Starts from 1-pt (skill) / 2-pt (QB) PPG cuts, absorbs thin cells, then
 * PAVA-merges any inversion so stddev is strictly increasing in projection.
 *
 * Usage:
 *   npx tsx scripts/build_hproj_variance_buckets.mjs
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
const MIN_SEASONS = { QB: 6, RB: 8, WR: 8, TE: 8 };
const MIN_WEEKS = { QB: 80, RB: 100, WR: 100, TE: 100 };
const MIN_STEP = 0.1; // std must rise by this much or we merge

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
  const std = Math.sqrt(m2 / (n - 1));
  const sorted = [...values].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const g1 = n >= 3 && std > 0
    ? (n / ((n - 1) * (n - 2))) * (m3 / (std ** 3))
    : null;
  const p10 = quantile(sorted, 0.10);
  const p90 = quantile(sorted, 0.90);
  const left = median - p10;
  return {
    n,
    mean: r2(mean),
    median: r2(median),
    std: r2(std),
    cv: mean > 0 ? r3(std / mean) : null,
    skew: g1 == null ? null : r3(g1),
    meanMinusMedian: r2(mean - median),
    p10: r2(p10),
    p90: r2(p90),
    tailRatio: left > 0.25 ? r3((p90 - median) / left) : null,
  };
}

function r2(n) { return Math.round(n * 100) / 100; }
function r3(n) { return Math.round(n * 1000) / 1000; }

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

function pool(seasonsInBand) {
  const weeks = [];
  for (const s of seasonsInBand) weeks.push(...s.weeks);
  const stats = summarize(weeks);
  if (!stats) return null;
  return { seasons: seasonsInBand.length, ...stats };
}

function cutsFor(pos, mode) {
  if (mode === 'fine') {
    if (pos === 'QB') return [0, 6, 10, 14, 18, 22, 28];
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 28];
  }
  if (pos === 'QB') return [0, 8, 12, 16, 20, 28];
  return [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 28];
}

function assignBands(posSeasons, cuts) {
  const bands = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const lo = cuts[i];
    const hi = cuts[i + 1];
    const members = posSeasons.filter((s) => s.ppg >= lo && s.ppg < hi);
    const stats = pool(members);
    if (!stats) continue;
    bands.push({ lo, hi, members, ...stats });
  }
  return bands;
}

function mergeBand(a, b) {
  const members = [...a.members, ...b.members];
  const stats = pool(members);
  return { lo: a.lo, hi: b.hi, members, ...stats };
}

function absorbThin(bands, pos) {
  const minS = MIN_SEASONS[pos];
  const minW = MIN_WEEKS[pos];
  let out = bands.map((b) => ({ ...b }));
  let changed = true;
  while (changed && out.length > 1) {
    changed = false;
    for (let i = 0; i < out.length; i += 1) {
      const thin = out[i].seasons < minS || out[i].n < minW;
      if (!thin) continue;
      if (i === out.length - 1) {
        out.splice(i - 1, 2, mergeBand(out[i - 1], out[i]));
      } else {
        out.splice(i, 2, mergeBand(out[i], out[i + 1]));
      }
      changed = true;
      break;
    }
  }
  return out;
}

function pava(bands) {
  let out = bands.map((b) => ({ ...b }));
  let changed = true;
  while (changed && out.length > 1) {
    changed = false;
    for (let i = 1; i < out.length; i += 1) {
      if (out[i].std <= out[i - 1].std + MIN_STEP) {
        out.splice(i - 1, 2, mergeBand(out[i - 1], out[i]));
        changed = true;
        break;
      }
    }
  }
  return out;
}

const MODE = process.argv[2] === 'fine' ? 'fine' : 'coarse';
console.log(`mode=${MODE}`);

const result = {
  meta: {
    years: YEARS,
    scoring: 'Hwang 0 PPR / TE +0.5',
    minGames: MIN_GAMES,
    minStep: MIN_STEP,
    rule: MODE === 'fine'
      ? '1-pt skill / 4-pt QB starts → absorb thin → PAVA until std rises by ≥0.1'
      : '2-pt skill / 4-pt QB starts → absorb thin → PAVA until std rises by ≥0.1',
    lookup: 'first band where lo <= projection < hi; last band is open-ended',
  },
  positions: {},
};

for (const pos of POSITIONS) {
  const raw = assignBands(seasons[pos], cutsFor(pos, MODE));
  const afterThin = absorbThin(raw, pos);
  const final = pava(afterThin);
  const last = final.length - 1;
  result.positions[pos] = final.map((b, i) => {
    const open = i === last || b.hi >= 28;
    return {
      lo: b.lo,
      hi: open ? null : b.hi,
      label: open ? `${b.lo}+` : `${b.lo}–${b.hi}`,
      seasons: b.seasons,
      weeks: b.n,
      mean: b.mean,
      median: b.median,
      std: b.std,
      cv: b.cv,
      skew: b.skew,
      meanMinusMedian: b.meanMinusMedian,
      tailRatio: b.tailRatio,
      p10: b.p10,
      p90: b.p90,
    };
  });

  console.log(`\n=== ${pos}  (${seasons[pos].length} player-seasons) ===`);
  console.log('band       nS    nW    mean   med    std   skew  μ-med');
  for (const b of result.positions[pos]) {
    const band = String(b.label).padEnd(8);
    console.log(
      `${band} ${String(b.seasons).padStart(4)} ${String(b.weeks).padStart(5)}  ${b.mean.toFixed(2)}  ${b.median.toFixed(2)}  ${b.std.toFixed(2)}  ${String(b.skew).padStart(5)}  ${String(b.meanMinusMedian).padStart(5)}`,
    );
  }
  const stds = result.positions[pos].map((b) => b.std);
  const mono = stds.every((s, i) => i === 0 || s > stds[i - 1]);
  console.log(`strictly increasing: ${mono}`);
}

const outPath = path.join(ROOT, 'tmp/hproj_variance_buckets.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`\nWrote ${outPath}`);
