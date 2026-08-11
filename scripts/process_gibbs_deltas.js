#!/usr/bin/env node
/**
 * process_gibbs_deltas.js
 *
 * Fetches Jacob Gibbs' "vs Expert Consensus" rankings page on FantasyPros and
 * extracts his rank deltas against ECR as an indicator CSV.
 *
 * The page needs no cookies — it server-renders two tables of players whose
 * Gibbs rank differs from ECR by at least RANGE spots:
 *   1. "Gibbs likes him more":  gibbs_rank | player | ecr_rank | diff
 *   2. "Consensus likes more":  ecr_rank   | player | gibbs_rank | diff
 * Players Gibbs agrees with consensus on (|diff| < RANGE) do not appear.
 *
 * Output columns: player, team, position, gibbs_rank, ecr_rank, diff, sleeper_id
 *   diff = ecr_rank - gibbs_rank  (positive → Gibbs is higher on the player)
 *
 * Usage (run from project root):
 *   node scripts/process_gibbs_deltas.js
 */

const fs   = require('fs');
const path = require('path');

const YEAR    = 2026;
const SCORING = 'HALF';
const RANGE   = 2; // minimum |diff| the page will include

const URL =
  'https://www.fantasypros.com/nfl/rankings/jacob-gibbs-consensus-rankings.php' +
  `?scoring=${SCORING}&type=draft&position=ALL&year=${YEAR}&range=${RANGE}`;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const OUT_CSV      = path.join(__dirname, '../site/public/data/gibbs_deltas.csv');
const PLAYERS_FILE = path.join(__dirname, '../site/public/data/players.txt');
const RELEVANT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

// ── Parse the two delta tables ────────────────────────────────────────────────

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/**
 * @returns {Array<{name, team, position, gibbsRank, ecrRank}>}
 */
function parseDeltaTables(html) {
  const tables = html.match(/<table[^>]*player-table[^>]*>[\s\S]*?<\/table>/g) || [];
  if (tables.length < 2) {
    console.error(`ERROR: expected 2 player-table tables, found ${tables.length}.`);
    console.error('The page structure may have changed.');
    process.exit(1);
  }

  const players = [];
  for (const table of tables) {
    const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    const headerCells = (rows[0].match(/<th[^>]*>[\s\S]*?<\/th>/g) || []).map(stripTags);
    // Table 1 leads with Gibbs' rank; table 2 leads with ECR's rank
    const gibbsFirst = /jacob gibbs/i.test(headerCells[0] || '');

    for (const row of rows.slice(1)) {
      const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []);
      if (cells.length < 4) continue;

      const rankA = Number(stripTags(cells[0]));
      const rankB = Number(stripTags(cells[2]));
      if (!Number.isFinite(rankA) || !Number.isFinite(rankB)) continue;

      const playerCell = cells[1];
      const nameMatch = playerCell.match(/class="player-name[^"]*"[^>]*>([^<]+)</);
      const teamPosMatch = stripTags(playerCell).match(/([A-Z]{2,3})\s*-\s*(QB|RB|WR|TE|K|DST)\s*$/);
      if (!nameMatch) continue;

      players.push({
        name:      nameMatch[1].trim(),
        team:      teamPosMatch ? teamPosMatch[1] : '',
        position:  teamPosMatch ? teamPosMatch[2] : '',
        gibbsRank: gibbsFirst ? rankA : rankB,
        ecrRank:   gibbsFirst ? rankB : rankA,
      });
    }
  }
  return players;
}

// ── Name normalisation + Sleeper matching (same approach as siblings) ────────

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

function findSleeperId(searchName, candidates, hints) {
  const normSearch = normalise(searchName);

  const exact = candidates.filter((c) => c.fullName === searchName);
  const norm  = exact.length ? exact
    : candidates.filter((c) => normalise(c.fullName) === normSearch);

  let pool = norm;
  if (pool.length === 0 && (hints.position || hints.team)) {
    const lastName = normSearch.split(' ').pop();
    pool = candidates.filter((c) => {
      if (normalise(c.fullName).split(' ').pop() !== lastName) return false;
      if (hints.position && c.position !== hints.position) return false;
      if (hints.team && c.team !== hints.team) return false;
      return true;
    });
  }
  if (pool.length === 1) return pool[0].sleeperId;
  if (pool.length > 1) {
    const scored = pool
      .map((c) => ({
        c,
        score: (hints.position && c.position === hints.position ? 4 : 0) +
               (hints.team && c.team === hints.team ? 2 : 0),
      }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score > 0 && (scored.length === 1 || scored[0].score > scored[1].score)) {
      return scored[0].c.sleeperId;
    }
  }
  return null;
}

function loadSleeperCandidates() {
  if (!fs.existsSync(PLAYERS_FILE)) {
    console.warn(`  WARNING: players.txt not found — sleeper_id column will be empty.`);
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
        position:  pos,
        team:      (p.team || p.team_abbr || '').toUpperCase(),
      };
    })
    .filter(Boolean);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`Fetching Gibbs vs ECR deltas (year=${YEAR} scoring=${SCORING} range=${RANGE})…`);
  const res = await fetch(URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    console.error(`ERROR: fetch failed with HTTP ${res.status}`);
    process.exit(1);
  }
  const html = await res.text();

  const players = parseDeltaTables(html);
  if (players.length === 0) {
    console.error('ERROR: no players parsed from delta tables.');
    process.exit(1);
  }

  const sleeperPool = loadSleeperCandidates();
  let matched = 0;

  const rows = players
    .map((p) => {
      const sleeperId = findSleeperId(p.name, sleeperPool, { position: p.position, team: p.team });
      if (sleeperId) matched += 1;
      return { ...p, diff: p.ecrRank - p.gibbsRank, sleeperId };
    })
    .sort((a, b) => a.ecrRank - b.ecrRank);

  const lines = ['player,team,position,gibbs_rank,ecr_rank,diff,sleeper_id'];
  for (const r of rows) {
    const safeName = r.name.includes(',') ? `"${r.name}"` : r.name;
    lines.push(`${safeName},${r.team},${r.position},${r.gibbsRank},${r.ecrRank},${r.diff},${r.sleeperId ?? ''}`);
  }
  fs.writeFileSync(OUT_CSV, lines.join('\n') + '\n', 'utf8');

  console.log(`  Output: ${OUT_CSV}`);
  console.log(`  ${rows.length} players with |diff| >= ${RANGE} (matched ${matched} to Sleeper IDs)`);
  const up = rows.filter((r) => r.diff > 0).length;
  console.log(`  Gibbs higher on ${up}, lower on ${rows.length - up}`);
}

run().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
