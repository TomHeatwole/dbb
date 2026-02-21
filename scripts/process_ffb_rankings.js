#!/usr/bin/env node
/**
 * process_ffb_rankings.js
 *
 * Fetches the Fantasy Footballers Podcast dynasty startup rankings page using
 * a saved curl command (scripts/ffbcurl.txt), extracts the embedded JSON data,
 * matches each player to a Sleeper ID, and writes site/public/data/ffb.csv.
 *
 * Output columns:  rank, name, sleeper_id
 * Players that cannot be matched are included with an empty sleeper_id and
 * a warning is printed to stderr so the operator knows to add a manual fix.
 *
 * If the curl fails, the cookie has expired, or the page returns the paywall,
 * the script will exit with a clear message explaining how to fix it.
 *
 * Usage (run from project root):
 *   node scripts/process_ffb_rankings.js
 *
 * To refresh the cookie:
 *   1. Log into thefantasyfootballers.com in Chrome
 *   2. Navigate to the Dynasty Startup Rankings page
 *   3. Open DevTools → Network tab, find the page request, right-click →
 *      Copy → Copy as cURL, and replace the contents of scripts/ffbcurl.txt
 */

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

const PLAYERS_FILE = path.join(__dirname, '../site/public/data/players.txt');
const OUT_CSV      = path.join(__dirname, '../site/public/data/ffb.csv');
const CURL_FILE    = path.join(__dirname, 'ffbcurl.txt');

const RELEVANT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

// ── Fetch HTML via the saved curl command ─────────────────────────────────────

function fetchHtml() {
  if (!fs.existsSync(CURL_FILE)) {
    console.error(`ERROR: curl command file not found: ${CURL_FILE}`);
    console.error('Create it by copying a "Copy as cURL" request from Chrome DevTools on the FFB rankings page.');
    process.exit(1);
  }

  const raw = fs.readFileSync(CURL_FILE, 'utf8');

  // Join continuation lines into a single command and add -s (silent) flag
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
    console.error(`\nUpdate ${CURL_FILE} with a fresh "Copy as cURL" from Chrome DevTools.`);
    process.exit(1);
  }

  return html;
}

// ── Detect paywall / session expiry ──────────────────────────────────────────

function checkForPaywall(html) {
  if (html.includes('footclan--locked') || html.includes('footclan--locked--content')) {
    console.error('ERROR: The page returned a locked/paywall view.');
    console.error('Your session cookie has most likely expired.');
    console.error(`\nTo fix:\n  1. Log into thefantasyfootballers.com in Chrome`);
    console.error(`  2. Navigate to the Dynasty Startup Rankings page`);
    console.error(`  3. DevTools → Network tab → find the page request → right-click → Copy → Copy as cURL`);
    console.error(`  4. Replace the contents of ${CURL_FILE} with the copied command`);
    process.exit(1);
  }
}

// ── Extract rankings JSON embedded in the page script ────────────────────────

function extractJsonFromHtml(html, startMarker) {
  // Use lastIndexOf so we skip the early `const data = await response.json()` occurrence
  // and land on the actual rankings data block
  const markerIdx = html.lastIndexOf(startMarker);
  if (markerIdx === -1) return null;

  let i = markerIdx + startMarker.length;
  while (i < html.length && html[i] !== '{') i++;
  if (i >= html.length) return null;

  const jsonStart = i;
  let depth    = 0;
  let inString = false;
  let escape   = false;

  for (; i < html.length; i++) {
    const ch = html[i];
    if (escape)              { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true;  continue; }
    if (ch === '"')          { inString = !inString; continue; }
    if (inString)            { continue; }
    if (ch === '{')          { depth++; }
    else if (ch === '}')     { depth--; if (depth === 0) return html.slice(jsonStart, i + 1); }
  }

  return null;
}

function loadRankings(html) {
  checkForPaywall(html);

  const jsonStr = extractJsonFromHtml(html, 'const data = ');
  if (!jsonStr) {
    console.error('ERROR: Could not find the rankings data block in the page HTML.');
    console.error('The page structure may have changed, or the session cookie may have expired.');
    console.error(`\nUpdate ${CURL_FILE} with a fresh "Copy as cURL" from Chrome DevTools.`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (err) {
    console.error(`ERROR: Failed to parse rankings JSON: ${err.message}`);
    process.exit(1);
  }

  const rankingsList = data['2QB'] || data['ALL'];
  if (!rankingsList || !Array.isArray(rankingsList)) {
    console.error('ERROR: Rankings JSON is missing expected "2QB" or "ALL" array.');
    console.error('The page structure may have changed.');
    process.exit(1);
  }

  console.log(`Using ranking set: ${data['2QB'] ? '2QB' : 'ALL'}`);

  // Sort by avg (arithmetic mean of each ranker's individual rank) — this is exactly
  // what the browser does to produce the displayed overall order.
  const sorted = [...rankingsList].sort((a, b) => parseFloat(a.avg) - parseFloat(b.avg));

  return sorted
    .map((p, idx) => {
      const age = parseFloat(p.age);
      return {
        rank:    idx + 1,          // overall rank = position in avg-sorted array
        rawName: (p.name || '').trim(),
        team:    (p.team || '').trim().toUpperCase(),
        pos:     (p.fantasy_position || '').trim().toUpperCase(),
        age:     Number.isFinite(age) ? Math.floor(age) : null,
      };
    })
    .filter((p) => p.rawName && RELEVANT_POSITIONS.has(p.pos));
}

// ── Name normalisation (mirrors playerNameMatcher.js) ─────────────────────────

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

// ── Smart matching (mirrors findBestPlayerMatch in playerNameMatcher.js) ──────

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
    if (hints.age != null && c.age != null) {
      if (Math.abs(Number(c.age) - Number(hints.age)) === 0) score += 1;
    }
    return score;
  }

  function pickBest(pool) {
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0];
    const hasHints = hints.position || hints.team || hints.age != null;
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

// ── Load Sleeper players into a flat array ────────────────────────────────────

function loadSleeperCandidates() {
  if (!fs.existsSync(PLAYERS_FILE)) {
    throw new Error(`players.txt not found at ${PLAYERS_FILE}\nRun: node scripts/update_players.js (or equivalent) first.`);
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
        age:       p.age ?? null,
      };
    })
    .filter(Boolean);
}

// ── Write output CSV ──────────────────────────────────────────────────────────

function writeCsv(rows) {
  const lines = ['rank,name,sleeper_id'];
  for (const { rank, name, sleeperId } of rows) {
    const safeName = name.includes(',') ? `"${name}"` : name;
    lines.push(`${rank},${safeName},${sleeperId ?? ''}`);
  }
  fs.writeFileSync(OUT_CSV, lines.join('\n') + '\n', 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function run() {
  console.log(`Fetching rankings via curl (${CURL_FILE})…`);
  const html = fetchHtml();

  const players     = loadRankings(html);
  const sleeperPool = loadSleeperCandidates();

  console.log(`Loaded ${players.length} ranked players from FFB.`);

  const outputRows = [];
  const unmatched  = [];

  for (const { rank, rawName, team, pos, age } of players) {
    const hints = { position: pos, team: team || undefined, age };
    const { candidate, ambiguous } = findBestPlayerMatch(rawName, sleeperPool, hints);

    if (candidate) {
      outputRows.push({ rank, name: rawName, sleeperId: candidate.sleeperId });
    } else {
      outputRows.push({ rank, name: rawName, sleeperId: null });
      unmatched.push({ rank, rawName, pos, team, ambiguous });
    }
  }

  writeCsv(outputRows);

  const matched = outputRows.filter((r) => r.sleeperId).length;
  console.log(`Output: ${OUT_CSV}`);
  console.log(`Matched ${matched} / ${outputRows.length} players to Sleeper IDs`);

  if (unmatched.length > 0) {
    console.warn(`\nWARNING: ${unmatched.length} player(s) could not be matched:`);
    for (const { rank, rawName, pos, team, ambiguous } of unmatched) {
      if (ambiguous.length > 0) {
        console.warn(`  #${rank} [AMBIGUOUS] ${pos} "${rawName}" (${team}) — ${ambiguous.length} candidates unresolved`);
      } else {
        console.warn(`  #${rank} [NO_MATCH]  ${pos} "${rawName}" (${team})`);
      }
    }
  }
}

run();
