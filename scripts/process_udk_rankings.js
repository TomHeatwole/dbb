#!/usr/bin/env node
/**
 * process_udk_rankings.js
 *
 * Fetches the Fantasy Footballers Ultimate Draft Kit rankings and converts
 * them to CSV. Reuses the saved curl command (scripts/ffbcurl.txt) — the same
 * session cookie used by process_ffb_rankings.js — with the URL swapped to a
 * UDK page.
 *
 * How the UDK pages work (unlike the dynasty startup rankings page, which
 * embeds a pre-ranked list): every UDK rankings page embeds the same
 * `window.udk.data` blob containing raw analyst projections (Andy / Jason /
 * Mike) plus tier multipliers. Rankings are computed client-side by the
 * UdkRankings class in the site's ffb-udk.js plugin bundle, using the
 * account's scoring system setting. All six pages (position rankings QB/RB/
 * WR/TE, top-200, superflex) embed identical data, so we fetch ONE page,
 * download the site's own UdkRankings class, and run the exact same
 * computation the browser does:
 *
 *   - QB/RB/WR/TE position rankings -> getPositionRankings(pos)
 *   - top 200                       -> getTierMultiplierRankings('top200')
 *   - superflex                     -> getTierMultiplierRankings('2qb')
 *
 * Outputs (dbbp/ffb-udk/ — the private companion repo; this is paywalled
 * content and must not ship with the public dbb repo):
 *   ffb_udk_qb.csv, ffb_udk_rb.csv, ffb_udk_wr.csv, ffb_udk_te.csv,
 *   ffb_udk_top200.csv, ffb_udk_superflex.csv
 *
 * Columns: rank, name, position, team, bye_week, tier, score, risk, upside,
 *          adp, andy_rank, jason_rank, mike_rank, sleeper_id
 * (tier is only present in the position rankings files)
 *
 * Usage (run from project root):
 *   node scripts/process_udk_rankings.js
 *
 * If the cookie has expired, refresh scripts/ffbcurl.txt the same way as for
 * process_ffb_rankings.js (Chrome DevTools -> Copy as cURL on any logged-in
 * FFB page).
 */

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const PLAYERS_FILE = path.join(__dirname, '../site/public/data/players.txt');
const OUT_DIR      = path.join(__dirname, '../dbbp/ffb-udk');
const CURL_FILE    = path.join(__dirname, 'ffbcurl.txt');

const UDK_PAGE_URL = 'https://www.thefantasyfootballers.com/2026-ultimate-draft-kit/udk-top-200-list/';

const RELEVANT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

// ── Fetch HTML via the saved curl command (URL swapped to the UDK page) ───────

function buildCurlCommand(url) {
  if (!fs.existsSync(CURL_FILE)) {
    console.error(`ERROR: curl command file not found: ${CURL_FILE}`);
    console.error('Create it by copying a "Copy as cURL" request from Chrome DevTools on any logged-in FFB page.');
    process.exit(1);
  }

  const raw = fs.readFileSync(CURL_FILE, 'utf8');

  return raw
    .split('\n')
    .map((line) => line.replace(/\\\s*$/, ' '))
    .join('')
    .replace(/^curl '[^']+'/, `curl '${url}'`)
    .replace(/^curl /, 'curl -s --max-time 30 ');
}

function fetchUrl(cmd, label) {
  try {
    return execSync(cmd, { maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' });
  } catch (err) {
    console.error(`ERROR: curl failed while fetching ${label}.`);
    console.error(err.message);
    console.error(`\nUpdate ${CURL_FILE} with a fresh "Copy as cURL" from Chrome DevTools.`);
    process.exit(1);
  }
}

function checkForPaywall(html) {
  if (html.includes('footclan--locked')) {
    console.error('ERROR: The page returned a locked/paywall view.');
    console.error('Your session cookie has most likely expired.');
    console.error(`\nUpdate ${CURL_FILE} with a fresh "Copy as cURL" from Chrome DevTools (see process_ffb_rankings.js header for steps).`);
    process.exit(1);
  }
}

// ── Balanced-bracket extraction of JS object/array literals ──────────────────

function extractBlock(src, marker, { last = false } = {}) {
  const idx = last ? src.lastIndexOf(marker) : src.indexOf(marker);
  if (idx === -1) return null;
  let i = idx + marker.length;
  while (i < src.length && src[i] !== '{' && src[i] !== '[') i++;
  if (i >= src.length) return null;
  const open  = src[i];
  const close = open === '{' ? '}' : ']';
  const start = i;
  let depth = 0;
  let quote = null;
  let esc   = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (quote) {
      if (c === '\\') esc = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

function evalLiteral(text) {
  return new Function('return (' + text + ')')();
}

function extractOrDie(src, marker, opts) {
  const block = extractBlock(src, marker, opts);
  if (!block) {
    console.error(`ERROR: Could not find "${marker}" in the page HTML.`);
    console.error('The page structure may have changed, or the session cookie may have expired.');
    process.exit(1);
  }
  return block;
}

// ── Reproduce the site's ranking computation ──────────────────────────────────

function computeRankings(html) {
  // window.udk.data appears 3 times; the last occurrence holds the real data
  const udkData         = JSON.parse(extractOrDie(html, 'window.udk.data = ', { last: true }));
  const scoringSystems  = evalLiteral(extractOrDie(html, 'window.udk.defaultScoringSystems = '));
  const teamComposition = evalLiteral(extractOrDie(html, 'window.udk.defaultTeamComposition = '));
  const userSettings    = JSON.parse(extractOrDie(html, 'window.udk.userSettings = '));

  const leagueSize = Number((html.match(/window\.udk\.defaultLeagueSize = (\d+);/) || [])[1] || 12);

  let selectedSystem = (html.match(/window\.udk\.defaultScoringSystem = '([^']+)';/) || [])[1];
  if (userSettings.scoringSystem && scoringSystems[userSettings.scoringSystem]) {
    selectedSystem = userSettings.scoringSystem;
  }
  if (!selectedSystem || !scoringSystems[selectedSystem]) {
    console.error('ERROR: Could not determine the scoring system from the page.');
    process.exit(1);
  }

  // Download the site's own UdkRankings class so our computation always
  // matches what the browser renders
  const pluginSrcMatch = html.match(/src="(https:\/\/[^"]*\/ffb-master\/js\/build\/ffb-udk\.js[^"]*)"/);
  if (!pluginSrcMatch) {
    console.error('ERROR: Could not find the ffb-udk.js plugin script URL in the page.');
    process.exit(1);
  }
  console.log(`Fetching UdkRankings class from ${pluginSrcMatch[1]}…`);
  const pluginJs  = fetchUrl(`curl -s --max-time 30 '${pluginSrcMatch[1]}'`, 'ffb-udk.js');
  const classBody = extractBlock(pluginJs, 'class UdkRankings');
  if (!classBody) {
    console.error('ERROR: Could not find the UdkRankings class in ffb-udk.js.');
    process.exit(1);
  }
  const UdkRankings = new Function('return (class UdkRankings' + classBody + ')')();

  console.log(`Scoring system: ${selectedSystem}`);
  console.log(`Projections: ${udkData.projections.length} rows (${udkData.previous_projections.length} previous-season rows)`);

  // Mirrors window.udk.getRankings() in the page's inline script
  const rankings = new UdkRankings(scoringSystems[selectedSystem], {
    tiers:                  udkData.tiers,
    defaultTeamComposition: teamComposition,
    leagueSize,
    top200:                 udkData.top200_multipliers,
    '2qb':                  udkData['2qb_multipliers'],
  });
  for (const p of udkData.projections)          rankings.addProjection(p);
  for (const p of udkData.previous_projections) rankings.addPreviousProjection(p);
  rankings.calculate();

  return rankings;
}

// ── Name normalisation + smart matching (mirrors process_ffb_rankings.js) ────

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

function findBestPlayerMatch(searchName, candidates, hints) {
  const normSearch     = normalise(searchName);
  const lastNameSearch = normSearch.split(' ').pop();

  function hintScore(c) {
    let score = 0;
    if (hints.position && c.position && c.position.toUpperCase() === hints.position.toUpperCase()) score += 4;
    if (hints.team && c.team && c.team.toUpperCase() === hints.team.toUpperCase()) score += 2;
    return score;
  }

  function pickBest(pool) {
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0];
    if (!hints.position && !hints.team) return null;
    const scored = pool
      .map((c) => ({ c, score: hintScore(c) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score > 0 && scored[0].score > scored[1].score) return scored[0].c;
    return null;
  }

  // 1. Exact
  const exactPool = candidates.filter((c) => c.fullName === searchName);
  if (exactPool.length === 1) return { candidate: exactPool[0], ambiguous: [] };
  if (exactPool.length > 1) {
    const best = pickBest(exactPool);
    if (best) return { candidate: best, ambiguous: [] };
    return { candidate: null, ambiguous: exactPool };
  }

  // 2. Normalised
  const normPool = candidates.filter((c) => normalise(c.fullName) === normSearch);
  if (normPool.length === 1) return { candidate: normPool[0], ambiguous: [] };
  if (normPool.length > 1) {
    const best = pickBest(normPool);
    if (best) return { candidate: best, ambiguous: [] };
    return { candidate: null, ambiguous: normPool };
  }

  // 3. Last-name fallback — requires at least one hint to guard false positives
  if (hints.position || hints.team) {
    const lastNamePool = candidates.filter((c) => {
      const normCand = normalise(c.fullName);
      if (normCand.split(' ').pop() !== lastNameSearch) return false;
      if (hints.position && c.position.toUpperCase() !== hints.position.toUpperCase()) return false;
      if (hints.team && c.team.toUpperCase() !== hints.team.toUpperCase()) return false;
      return true;
    });
    if (lastNamePool.length === 1) return { candidate: lastNamePool[0], ambiguous: [] };
    if (lastNamePool.length > 1) {
      const best = pickBest(lastNamePool);
      if (best) return { candidate: best, ambiguous: [] };
      return { candidate: null, ambiguous: lastNamePool };
    }
  }

  return { candidate: null, ambiguous: [] };
}

function loadSleeperCandidates() {
  if (!fs.existsSync(PLAYERS_FILE)) {
    console.error(`ERROR: players.txt not found at ${PLAYERS_FILE}`);
    process.exit(1);
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

// ── CSV output ────────────────────────────────────────────────────────────────

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const HEADER_ALIASES = {
  fantasy_position: 'position',
  scoreFormatted:   'score',
  riskFormatted:    'risk',
  upsideFormatted:  'upside',
};

function writeCsv(filename, rows, columns, sleeperPool, unmatchedLog) {
  const outPath = path.join(OUT_DIR, filename);
  const header  = [...columns.map((c) => HEADER_ALIASES[c] || c), 'sleeper_id'].join(',');
  const lines   = [header];

  for (const row of rows) {
    const hints = { position: row.fantasy_position, team: row.team || undefined };
    const { candidate, ambiguous } = findBestPlayerMatch(row.name, sleeperPool, hints);
    if (!candidate) {
      unmatchedLog.set(`${row.fantasy_position} ${row.name} (${row.team})`, ambiguous.length > 0);
    }
    const values = columns.map((c) => csvEscape(row[c]));
    values.push(candidate ? candidate.sleeperId : '');
    lines.push(values.join(','));
  }

  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Output: ${outPath} (${rows.length} rows)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const BASE_COLS = ['rank', 'name', 'fantasy_position', 'team', 'bye_week',
  'scoreFormatted', 'riskFormatted', 'upsideFormatted', 'adp',
  'andy_rank', 'jason_rank', 'mike_rank'];

function run() {
  console.log(`Fetching UDK page via curl (${CURL_FILE})…`);
  const html = fetchUrl(buildCurlCommand(UDK_PAGE_URL), 'UDK page');
  checkForPaywall(html);

  const rankings    = computeRankings(html);
  const sleeperPool = loadSleeperCandidates();
  const unmatched   = new Map();

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Position rankings (what the udk-position-rankings/?position=X pages show)
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const rows = rankings.getAnalystRankings(pos); // adds andy/jason/mike per-analyst ranks
    rows.sort((a, b) => a.rank - b.rank);
    writeCsv(`ffb_udk_${pos.toLowerCase()}.csv`, rows, [...BASE_COLS, 'tier'], sleeperPool, unmatched);
  }

  // Top-200 and superflex (tier-multiplier-weighted cross-position lists)
  for (const [type, name] of [['top200', 'top200'], ['2qb', 'superflex']]) {
    const rows = rankings.getTierMultiplierRankings(type);
    rows.sort((a, b) => a.rank - b.rank);
    writeCsv(`ffb_udk_${name}.csv`, rows, BASE_COLS, sleeperPool, unmatched);
  }

  if (unmatched.size > 0) {
    console.warn(`\nWARNING: ${unmatched.size} player(s) could not be matched to Sleeper IDs:`);
    for (const [desc, wasAmbiguous] of unmatched) {
      console.warn(`  [${wasAmbiguous ? 'AMBIGUOUS' : 'NO_MATCH'}] ${desc}`);
    }
  }
}

run();
