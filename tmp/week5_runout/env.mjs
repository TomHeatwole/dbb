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
const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];

function involved(st) {
  if (!st) return false;
  return (st.pass_att || 0) + (st.rush_att || 0) + (st.rec_tgt || 0) + (st.off_snp || 0) > 0;
}

async function yearWeeks(year) {
  return Promise.all([1, 2, 3, 4, 5].map(async (week) => {
    const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${year}/${week}`);
    if (!res.ok) return null;
    return res.json();
  }));
}

const byYear = {};
for (const year of YEARS) byYear[year] = await yearWeeks(year);

console.log('Weeks 1–5, league scoring, skill players who had a snap/target/carry that week');
console.log('year   mean/week   sum5   vs 2021-25');
const hist = [];
for (const year of YEARS) {
  let opp = 0;
  let pts = 0;
  const weekMeans = [];
  for (let w = 0; w < 5; w++) {
    const stats = byYear[year][w] || {};
    let wOpp = 0;
    let wPts = 0;
    for (const [pid, st] of Object.entries(stats)) {
      const pos = players?.[pid]?.position;
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
      if (!involved(st)) continue;
      wOpp += 1;
      wPts += computePointsFromSleeperStats(st, pos, config);
    }
    opp += wOpp;
    pts += wPts;
    weekMeans.push(wOpp ? wPts / wOpp : 0);
  }
  const mean = opp ? pts / opp : 0;
  if (year < 2026) hist.push(mean);
  console.log(`${year}  ${mean.toFixed(3)}  weeks ${weekMeans.map((m) => m.toFixed(2)).join(' ')}`);
}
const histMean = hist.reduce((a, b) => a + b, 0) / hist.length;
const y2026 = (() => {
  let opp = 0; let pts = 0;
  for (let w = 0; w < 5; w++) {
    const stats = byYear[2026][w] || {};
    for (const [pid, st] of Object.entries(stats)) {
      const pos = players?.[pid]?.position;
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
      if (!involved(st)) continue;
      opp += 1;
      pts += computePointsFromSleeperStats(st, pos, config);
    }
  }
  return pts / opp;
})();
console.log(`2021-25 mean ${histMean.toFixed(3)}  2026 ${y2026.toFixed(3)}  ratio ${(y2026 / histMean).toFixed(3)}`);
