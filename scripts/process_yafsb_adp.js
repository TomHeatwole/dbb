#!/usr/bin/env node
/**
 * process_yafsb_adp.js
 *
 * Fetches YAFSB's Sleeper-based redraft ADP chart for half-PPR superflex
 * (12-team) and converts it to CSV.
 *
 * YAFSB embeds a Bokeh scatter of every pick (x = pick number, y = player
 * index with name labels). We average the pick numbers per player to get ADP.
 *
 * Output: site/public/data/yafsb_adp_half_superflex.csv
 *   rank,player,position,team,adp,samples,sleeper_id
 *   (rank == adp, rounded to 1 decimal — Redraft Dash reads the rank column)
 *
 * Usage (run from project root):
 *   node scripts/process_yafsb_adp.js
 */

const fs   = require('fs');
const path = require('path');

const SCORING     = 'half_ppr';
const LEAGUE_SIZE = 12;
const SUPERFLEX   = true;
const DYNASTY     = false;
const ROOKIES     = false;

const URL =
  'https://yafsb.com/fantasy-football/adp-rankings/' +
  `?scoring_type=${SCORING}` +
  `&league_size=${LEAGUE_SIZE}` +
  `&is_superflex=${SUPERFLEX ? 'True' : 'False'}` +
  `&is_dynasty=${DYNASTY ? 'True' : 'False'}` +
  `&is_rookies=${ROOKIES ? 'True' : 'False'}`;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const OUT_CSV      = path.join(__dirname, '../site/public/data/yafsb_adp_half_superflex.csv');
const PLAYERS_FILE = path.join(__dirname, '../site/public/data/players.txt');
const RELEVANT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

// ── Bokeh docs_json walkers ───────────────────────────────────────────────────

function walk(obj, pred, acc = []) {
  if (!obj || typeof obj !== 'object') return acc;
  if (pred(obj)) acc.push(obj);
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) v.forEach((x) => walk(x, pred, acc));
    else if (v && typeof v === 'object') walk(v, pred, acc);
  }
  return acc;
}

function decodeLabel(s) {
  return String(s || '')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Parse the embedded Bokeh chart into per-player ADP rows.
 * @returns {{ players: Array<{name, adp, samples, min, max}>, updatedAt: string|null, draftCount: number|null }}
 */
function parseBokehAdp(html) {
  const m = html.match(/const docs_json = '(\{[\s\S]*?\})';\s*\n\s*const render_items/);
  if (!m) {
    console.error('ERROR: could not find Bokeh docs_json in the YAFSB page.');
    process.exit(1);
  }

  let docs;
  try {
    docs = JSON.parse(m[1]);
  } catch (err) {
    console.error(`ERROR: failed to parse docs_json: ${err.message}`);
    process.exit(1);
  }

  const root = Object.values(docs)[0]?.roots?.[0];
  if (!root) {
    console.error('ERROR: docs_json has no root figure.');
    process.exit(1);
  }

  const titles = walk(root, (o) => o.name === 'Title')
    .map((t) => t.attributes?.text)
    .filter(Boolean);
  const updatedAt = (titles.find((t) => /Last updated:/i.test(t)) || '')
    .replace(/^Last updated:\s*/i, '') || null;
  const draftCountMatch = (titles.find((t) => /most recent \d+ drafts/i.test(t)) || '')
    .match(/most recent (\d+) drafts/i);
  const draftCount = draftCountMatch ? Number(draftCountMatch[1]) : null;

  const cds = walk(
    root,
    (o) => o.name === 'ColumnDataSource' && o.attributes?.data?.entries,
  )[0];
  if (!cds) {
    console.error('ERROR: no ColumnDataSource with data found.');
    process.exit(1);
  }
  const data = Object.fromEntries(cds.attributes.data.entries);
  const xs = data.x;
  const ys = data.y;
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length) {
    console.error('ERROR: unexpected CDS x/y shape.');
    process.exit(1);
  }

  const labelNode = walk(root, (o) => o.attributes?.major_label_overrides?.entries)[0];
  if (!labelNode) {
    console.error('ERROR: no player-name major_label_overrides found.');
    process.exit(1);
  }
  const labels = Object.fromEntries(labelNode.attributes.major_label_overrides.entries);

  const byPlayer = new Map();
  for (let i = 0; i < xs.length; i += 1) {
    const y = ys[i];
    const x = xs[i];
    if (y == null || !Number.isFinite(x)) continue;
    const name = decodeLabel(labels[y]);
    if (!name) continue;
    if (!byPlayer.has(name)) byPlayer.set(name, []);
    byPlayer.get(name).push(x);
  }

  const players = [...byPlayer.entries()].map(([name, picks]) => {
    const sum = picks.reduce((a, b) => a + b, 0);
    const sorted = [...picks].sort((a, b) => a - b);
    return {
      name,
      adp: sum / picks.length,
      samples: picks.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
  }).sort((a, b) => a.adp - b.adp);

  return { players, updatedAt, draftCount };
}

// ── Name normalisation + Sleeper matching ─────────────────────────────────────

function normalise(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findSleeperMatch(searchName, candidates) {
  const normSearch = normalise(searchName);
  const exact = candidates.filter((c) => c.fullName === searchName);
  const pool = exact.length
    ? exact
    : candidates.filter((c) => normalise(c.fullName) === normSearch);

  if (pool.length === 1) return pool[0];
  if (pool.length > 1) {
    // Prefer active/team'd players when names collide
    const withTeam = pool.filter((c) => c.team);
    if (withTeam.length === 1) return withTeam[0];
  }
  // Last-name + unique fallback
  if (pool.length === 0) {
    const last = normSearch.split(' ').pop();
    const lastMatches = candidates.filter(
      (c) => normalise(c.fullName).split(' ').pop() === last,
    );
    if (lastMatches.length === 1) return lastMatches[0];
  }
  return pool[0] || null;
}

function loadSleeperCandidates() {
  if (!fs.existsSync(PLAYERS_FILE)) {
    console.warn('  WARNING: players.txt not found — position/team/sleeper_id will be empty.');
    return [];
  }
  const data = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
  return Object.entries(data)
    .map(([id, p]) => {
      const pos = p.position || (p.fantasy_positions && p.fantasy_positions[0]) || '';
      if (!RELEVANT_POSITIONS.has(pos)) return null;
      const fullName = (p.full_name || '').trim();
      if (!fullName) return null;
      return {
        sleeperId: id,
        fullName,
        position: pos,
        team: (p.team || p.team_abbr || '').toUpperCase(),
      };
    })
    .filter(Boolean);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function csvEscape(value) {
  const s = String(value ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`Fetching YAFSB ADP (${SCORING}, ${LEAGUE_SIZE}-team, SF=${SUPERFLEX}, dynasty=${DYNASTY})…`);
  console.log(`  ${URL}`);
  const res = await fetch(URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    console.error(`ERROR: fetch failed with HTTP ${res.status}`);
    process.exit(1);
  }
  const html = await res.text();
  if (/Server Error|<!doctype html>[\s\S]*Not Found/i.test(html) && !html.includes('docs_json')) {
    console.error('ERROR: YAFSB returned an error page.');
    process.exit(1);
  }

  const { players, updatedAt, draftCount } = parseBokehAdp(html);
  if (players.length === 0) {
    console.error('ERROR: no players parsed from Bokeh chart.');
    process.exit(1);
  }

  const sleeperPool = loadSleeperCandidates();
  let matched = 0;
  const rows = players.map((p) => {
    const match = findSleeperMatch(p.name, sleeperPool);
    if (match) matched += 1;
    return {
      rank: round1(p.adp),
      name: p.name,
      position: match?.position || '',
      team: match?.team || '',
      adp: round1(p.adp),
      samples: p.samples,
      sleeperId: match?.sleeperId || '',
    };
  });

  // Keep only rows matched to a QB/RB/WR/TE — drops K/DST abbreviations and
  // unmatched college/noise names that YAFSB's chart sometimes includes.
  const skillRows = rows.filter(
    (r) => r.sleeperId && RELEVANT_POSITIONS.has(r.position),
  );

  const lines = ['rank,player,position,team,adp,samples,sleeper_id'];
  for (const r of skillRows) {
    lines.push([
      r.rank,
      csvEscape(r.name),
      r.position,
      r.team,
      r.adp,
      r.samples,
      r.sleeperId,
    ].join(','));
  }
  fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
  fs.writeFileSync(OUT_CSV, `${lines.join('\n')}\n`, 'utf8');

  console.log(`  Output: ${OUT_CSV}`);
  console.log(`  ${skillRows.length} players (matched ${matched}/${players.length} to Sleeper)`);
  if (updatedAt) console.log(`  YAFSB last updated: ${updatedAt}`);
  if (draftCount != null) console.log(`  Sample: ${draftCount} recent drafts`);
  console.log('  Top 10:');
  skillRows.slice(0, 10).forEach((r, i) => {
    console.log(`    ${String(i + 1).padStart(2)}. ${String(r.adp).padStart(5)}  ${r.name} (${r.position || '?'})`);
  });
}

run().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
