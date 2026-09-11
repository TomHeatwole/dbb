/**
 * Independent best-ball oracle vs the UI lineup function.
 * Greedy 1QB/3RB/3WR/1TE/2FLEX/1SF is optimal for this slot set.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.env.REACT_APP_SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const href = typeof url === 'string' ? url : url?.url;
  if (typeof href === 'string' && href.startsWith('/')) {
    const filePath = join(ROOT, 'site', 'public', href);
    if (!existsSync(filePath)) {
      return { ok: false, status: 404, text: async () => '', json: async () => null };
    }
    const text = readFileSync(filePath, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  }
  return realFetch(url, opts);
};

const { computeOptimalWeekStarterTotal } = await import('../site/src/scenarios/simulatorLineup.js');
const { loadPlayersData } = await import('../site/lib/mcp/dataLoader.mjs');
const { fetchRosters } = await import('../site/lib/mcp/sleeperApi.mjs');

function oracleTotal(playerList, weekPts, playerPositions) {
  const players = [];
  for (const id of playerList) {
    if (!id || id === '0') continue;
    const pos = playerPositions[id];
    if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
    players.push({ id, pos, pts: weekPts[id] ?? 0 });
  }
  const take = (pos, n) => {
    const pool = players
      .filter((p) => p.pos === pos)
      .sort((a, b) => b.pts - a.pts || String(a.id).localeCompare(String(b.id)));
    const picked = pool.slice(0, n);
    const used = new Set(picked.map((p) => p.id));
    return { pts: picked.reduce((s, p) => s + p.pts, 0), used };
  };
  const qb = take('QB', 1);
  const rb = take('RB', 3);
  const wr = take('WR', 3);
  const te = take('TE', 1);
  const used = new Set([...qb.used, ...rb.used, ...wr.used, ...te.used]);
  const rest = players
    .filter((p) => !used.has(p.id))
    .sort((a, b) => b.pts - a.pts || String(a.id).localeCompare(String(b.id)));
  let flex = 0;
  let flexN = 0;
  const afterFlex = [];
  for (const p of rest) {
    if (flexN < 2 && (p.pos === 'RB' || p.pos === 'WR' || p.pos === 'TE')) {
      flex += p.pts;
      flexN += 1;
    } else {
      afterFlex.push(p);
    }
  }
  const superPts = afterFlex[0]?.pts || 0;
  return qb.pts + rb.pts + wr.pts + te.pts + flex + superPts;
}

const rosters = await fetchRosters();
const playersData = loadPlayersData();
const rosterMap = {};
const positions = {};
for (const r of rosters) {
  const ids = [...(r.players || [])];
  rosterMap[r.roster_id] = ids;
  for (const id of ids) positions[id] = playersData[id]?.position || null;
}

let mismatches = 0;
let checked = 0;
let maxAbs = 0;
for (let trial = 0; trial < 2000; trial++) {
  const weekPts = {};
  for (const id of Object.keys(positions)) {
    // mix of zeros, typical weeks, and spike weeks
    const u = Math.random();
    weekPts[id] = u < 0.12 ? 0 : u < 0.85 ? Math.round(Math.random() * 250) / 10 : Math.round((20 + Math.random() * 40) * 10) / 10;
  }
  for (const ids of Object.values(rosterMap)) {
    const got = computeOptimalWeekStarterTotal(ids, weekPts, positions, {});
    const exp = oracleTotal(ids, weekPts, positions);
    checked += 1;
    const abs = Math.abs(got - exp);
    if (abs > 1e-9) {
      mismatches += 1;
      maxAbs = Math.max(maxAbs, abs);
    }
  }
}

console.log(`lineup oracle: ${checked} team-weeks, mismatches=${mismatches}, maxAbs=${maxAbs}`);
if (mismatches) process.exit(1);
