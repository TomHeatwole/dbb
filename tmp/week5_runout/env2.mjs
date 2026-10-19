import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.REACT_APP_SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');
process.env.DATA_DIR = join(ROOT, 'site', 'public', 'data');

const { loadPlayersData } = await import('../../site/lib/mcp/dataLoader.mjs');
const { loadScoringConfig } = await import('../../site/lib/mcp/simData.mjs');
const { computePointsFromSleeperStats } = await import('../../site/lib/mcp/simEngine.mjs');

const players = loadPlayersData();
const config = loadScoringConfig();

function involved(st) {
  if (!st) return false;
  return (st.pass_att || 0) + (st.rush_att || 0) + (st.rec_tgt || 0) + (st.off_snp || 0) > 0;
}

async function totals(year) {
  const weeks = await Promise.all([1, 2, 3, 4, 5].map(async (week) => {
    const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${year}/${week}`);
    return res.ok ? res.json() : {};
  }));
  const by = {};
  for (const stats of weeks) {
    for (const [pid, st] of Object.entries(stats)) {
      const pos = players?.[pid]?.position;
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
      if (!involved(st)) continue;
      by[pid] = (by[pid] || 0) + computePointsFromSleeperStats(st, pos, config);
    }
  }
  return Object.values(by).sort((a, b) => b - a);
}

function cut(arr, n) {
  return arr.slice(0, n).reduce((s, v) => s + v, 0) / n;
}

console.log('Mean weeks 1–5 total of the top N skill players (league scoring)');
console.log('year    top24    top60    top120   all-used');
const rows = {};
for (const year of [2021, 2022, 2023, 2024, 2025, 2026]) {
  const arr = await totals(year);
  rows[year] = {
    n: arr.length,
    top24: cut(arr, 24),
    top60: cut(arr, 60),
    top120: cut(arr, 120),
    all: arr.reduce((s, v) => s + v, 0) / arr.length,
  };
  const r = rows[year];
  console.log(`${year}  ${r.top24.toFixed(1)}  ${r.top60.toFixed(1)}  ${r.top120.toFixed(1)}  ${r.all.toFixed(1)}  (n=${r.n})`);
}
function avg(key) {
  return [2021, 2022, 2023, 2024, 2025].reduce((s, y) => s + rows[y][key], 0) / 5;
}
console.log('2026 / 2021-25 avg');
for (const key of ['top24', 'top60', 'top120', 'all']) {
  console.log(`  ${key}  ${(rows[2026][key] / avg(key)).toFixed(3)}`);
}
