#!/usr/bin/env node
/**
 * process_fantasypros_rankings.js
 *
 * Fetches a FantasyPros rankings page using a saved curl command file,
 * extracts the embedded `var ecrData` JSON, matches each player to a
 * Sleeper ID, and writes a CSV.
 *
 * Output columns:  rank, name, team, position, sleeper_id
 *
 * Usage (run from project root):
 *   node scripts/process_fantasypros_rankings.js <curl_file> <output_csv>
 *
 *   curl_file   — path to a .sh file containing a "Copy as cURL" command,
 *                 e.g. fantasypros_scrape/wr_std.sh
 *   output_csv  — destination path, e.g. site/public/data/fantasypros_wr_std.csv
 *
 * To refresh the curl cookie:
 *   1. Navigate to the target FantasyPros rankings page in Chrome
 *   2. DevTools → Network tab → find the page request → right-click →
 *      Copy → Copy as cURL (bash)
 *   3. Replace the contents of the corresponding .sh file
 */

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const PLAYERS_FILE      = path.join(__dirname, '../site/public/data/players.txt');
const RELEVANT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

// ── Args ──────────────────────────────────────────────────────────────────────

const [,, curlFile, outCsv] = process.argv;

if (!curlFile || !outCsv) {
  console.error('Usage: node process_fantasypros_rankings.js <curl_file> <output_csv>');
  process.exit(1);
}

if (!fs.existsSync(curlFile)) {
  console.error(`ERROR: curl file not found: ${curlFile}`);
  process.exit(1);
}

// ── Fetch HTML ────────────────────────────────────────────────────────────────

function fetchHtml(curlFilePath) {
  const raw = fs.readFileSync(curlFilePath, 'utf8');

  // Join continuation lines into a single command and add -s / timeout flags
  const curlCmd = raw
    .split('\n')
    .map((line) => line.replace(/\\\s*$/, ' '))
    .join('')
    .replace(/^curl /, 'curl -s --max-time 30 ');

  let html;
  try {
    html = execSync(curlCmd, {
      maxBuffer: 25 * 1024 * 1024,
      encoding:  'utf8',
    });
  } catch (err) {
    console.error('ERROR: curl command failed.');
    console.error(err.message);
    console.error(`\nUpdate ${curlFilePath} with a fresh "Copy as cURL" from Chrome DevTools.`);
    process.exit(1);
  }

  return html;
}

// ── Extract ecrData JSON from the page ───────────────────────────────────────

function extractEcrData(html) {
  const MARKER = 'var ecrData = ';
  const markerIdx = html.indexOf(MARKER);
  if (markerIdx === -1) return null;

  let i = markerIdx + MARKER.length;
  while (i < html.length && html[i] !== '{') i++;
  if (i >= html.length) return null;

  const jsonStart = i;
  let depth    = 0;
  let inString = false;
  let escape   = false;

  for (; i < html.length; i++) {
    const ch = html[i];
    if (escape)                  { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true;  continue; }
    if (ch === '"')              { inString = !inString; continue; }
    if (inString)                { continue; }
    if (ch === '{')              { depth++; }
    else if (ch === '}')         { depth--; if (depth === 0) return html.slice(jsonStart, i + 1); }
  }

  return null;
}

function loadRankings(html) {
  const jsonStr = extractEcrData(html);
  if (!jsonStr) {
    console.error('ERROR: Could not find "var ecrData" in the page HTML.');
    console.error('The page structure may have changed, or the session cookie may have expired.');
    console.error(`\nUpdate ${curlFile} with a fresh "Copy as cURL" from Chrome DevTools.`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (err) {
    console.error(`ERROR: Failed to parse ecrData JSON: ${err.message}`);
    process.exit(1);
  }

  const players = data.players;
  if (!Array.isArray(players) || players.length === 0) {
    console.error('ERROR: ecrData.players is missing or empty.');
    console.error('The page structure may have changed.');
    process.exit(1);
  }

  const scoring  = data.scoring  || '';
  const position = data.position_id || '';
  console.log(`  Source: position=${position} scoring=${scoring} players=${players.length} last_updated=${data.last_updated || 'unknown'}`);

  return players
    .sort((a, b) => (a.rank_ecr ?? 9999) - (b.rank_ecr ?? 9999))
    .map((p) => ({
      rank:    p.rank_ecr,
      rawName: (p.player_name || '').trim(),
      team:    (p.player_team_id || '').trim().toUpperCase(),
      pos:     (p.player_position_id || '').trim().toUpperCase(),
      tier:    p.tier ?? null,
    }))
    .filter((p) => p.rawName && p.rank != null);
}

// ── Name normalisation ────────────────────────────────────────────────────────

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

// ── Smart player matching ─────────────────────────────────────────────────────

function findBestPlayerMatch(searchName, candidates, hints) {
  const normSearch     = normalise(searchName);
  const lastNameSearch = normSearch.split(' ').pop();

  function hintScore(c) {
    let score = 0;
    if (hints.position && c.position) {
      if (c.position.toUpperCase() === hints.position.toUpperCase()) score += 4;
    }
    if (hints.team && c.team) {
      if (c.team.toUpperCase() === hints.team.toUpperCase()) score += 2;
    }
    return score;
  }

  function pickBest(pool) {
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0];
    const hasHints = hints.position || hints.team;
    if (!hasHints) return null;
    const scored = pool
      .map((c) => ({ c, score: hintScore(c) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score > 0 && scored[0].score > scored[1].score) return scored[0].c;
    return null;
  }

  // 1. Exact
  const exactPool = candidates.filter((c) => c.fullName === searchName);
  if (exactPool.length === 1) return { candidate: exactPool[0], strategy: 'exact', ambiguous: [] };
  if (exactPool.length > 1) {
    const best = pickBest(exactPool);
    if (best) return { candidate: best, strategy: 'exact', ambiguous: [] };
    return { candidate: null, strategy: null, ambiguous: exactPool };
  }

  // 2. Normalised
  const normPool = candidates.filter((c) => normalise(c.fullName) === normSearch);
  if (normPool.length === 1) return { candidate: normPool[0], strategy: 'normalised', ambiguous: [] };
  if (normPool.length > 1) {
    const best = pickBest(normPool);
    if (best) return { candidate: best, strategy: 'normalised', ambiguous: [] };
    return { candidate: null, strategy: null, ambiguous: normPool };
  }

  // 3. Last-name fallback — requires at least one hint to guard false positives
  if (hints.position || hints.team) {
    const lastNamePool = candidates.filter((c) => {
      const normCand = normalise(c.fullName);
      if (normCand.split(' ').pop() !== lastNameSearch) return false;
      if (hints.position && c.position.toUpperCase() !== hints.position.toUpperCase()) return false;
      if (hints.team    && c.team.toUpperCase()     !== hints.team.toUpperCase())     return false;
      return true;
    });
    if (lastNamePool.length === 1) return { candidate: lastNamePool[0], strategy: 'last_name', ambiguous: [] };
    if (lastNamePool.length > 1) {
      const best = pickBest(lastNamePool);
      if (best) return { candidate: best, strategy: 'last_name', ambiguous: [] };
      return { candidate: null, strategy: null, ambiguous: lastNamePool };
    }
  }

  return { candidate: null, strategy: null, ambiguous: [] };
}

// ── Load Sleeper players ──────────────────────────────────────────────────────

function loadSleeperCandidates() {
  if (!fs.existsSync(PLAYERS_FILE)) {
    throw new Error(`players.txt not found at ${PLAYERS_FILE}\nRun update_players first.`);
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

// ── Write CSV ─────────────────────────────────────────────────────────────────

function writeCsv(rows) {
  const outDir = path.dirname(outCsv);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const lines = ['rank,name,team,position,tier,sleeper_id'];
  for (const { rank, name, team, position, tier, sleeperId } of rows) {
    const safeName = name.includes(',') ? `"${name}"` : name;
    lines.push(`${rank},${safeName},${team},${position},${tier ?? ''},${sleeperId ?? ''}`);
  }
  fs.writeFileSync(outCsv, lines.join('\n') + '\n', 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function run() {
  console.log(`Fetching rankings via curl (${curlFile})…`);
  const html = fetchHtml(curlFile);

  const players     = loadRankings(html);
  const sleeperPool = loadSleeperCandidates();

  const outputRows = [];
  const unmatched  = [];

  for (const { rank, rawName, team, pos, tier } of players) {
    const hints = { position: pos, team: team || undefined };
    const { candidate, ambiguous } = findBestPlayerMatch(rawName, sleeperPool, hints);

    if (candidate) {
      outputRows.push({ rank, name: rawName, team, position: pos, tier, sleeperId: candidate.sleeperId });
    } else {
      outputRows.push({ rank, name: rawName, team, position: pos, tier, sleeperId: null });
      unmatched.push({ rank, rawName, pos, team, ambiguous });
    }
  }

  writeCsv(outputRows);

  const matched = outputRows.filter((r) => r.sleeperId).length;
  console.log(`  Output: ${outCsv}`);
  console.log(`  Matched ${matched} / ${outputRows.length} players to Sleeper IDs`);

  if (unmatched.length > 0) {
    console.warn(`\n  WARNING: ${unmatched.length} player(s) could not be matched:`);
    for (const { rank, rawName, pos, team, ambiguous } of unmatched) {
      if (ambiguous.length > 0) {
        console.warn(`    #${rank} [AMBIGUOUS] ${pos} "${rawName}" (${team}) — ${ambiguous.length} candidates`);
      } else {
        console.warn(`    #${rank} [NO_MATCH]  ${pos} "${rawName}" (${team})`);
      }
    }
  }
}

run();
