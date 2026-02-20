#!/usr/bin/env node
/**
 * process_ffb_rankings.js
 *
 * Reads the most recent (or a specified) Fantasy Footballers Podcast dynasty
 * startup rankings CSV from ~/Downloads, matches each player to a Sleeper ID,
 * and writes site/public/data/ffb.csv.
 *
 * Output columns:  rank, name, sleeper_id
 * Players that cannot be matched are included with an empty sleeper_id and
 * a warning is printed to stderr so the operator knows to add a manual fix.
 *
 * Expected input CSV columns (quoted):
 *   Rank, Name, Team, Pos, Age, Andy, Jason, Mike
 *
 * Usage (run from project root):
 *   node scripts/process_ffb_rankings.js
 *   node scripts/process_ffb_rankings.js path/to/rankings.csv
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PLAYERS_FILE   = path.join(__dirname, '../site/public/data/players.txt');
const OUT_CSV        = path.join(__dirname, '../site/public/data/ffb.csv');
const DOWNLOADS_DIR  = path.join(os.homedir(), 'Downloads');
const FILE_PREFIX    = 'Dynasty Startup Rankings';

const RELEVANT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

// ── Find most-recent matching file in ~/Downloads ─────────────────────────────

function findLatestDownload() {
  let entries;
  try {
    entries = fs.readdirSync(DOWNLOADS_DIR);
  } catch {
    return null;
  }

  const matches = entries
    .filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith('.csv'))
    .map((f) => {
      const full = path.join(DOWNLOADS_DIR, f);
      const { mtimeMs } = fs.statSync(full);
      return { full, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return matches.length > 0 ? matches[0].full : null;
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

// ── CSV parser (handles double-quoted fields) ─────────────────────────────────

function parseCsvLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Load Fantasy Footballers rankings CSV ─────────────────────────────────────

function loadRankings(csvPath) {
  const lines   = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());

  const nameIdx = headers.indexOf('name');
  const teamIdx = headers.indexOf('team');
  const posIdx  = headers.indexOf('pos');
  const ageIdx  = headers.indexOf('age');
  const rankIdx = headers.indexOf('rank');

  if (nameIdx < 0) throw new Error(`CSV missing "Name" column (found: ${headers.join(', ')})`);

  return lines.slice(1)
    .map((line) => {
      const cols = parseCsvLine(line);
      const pos  = (cols[posIdx] || '').trim().toUpperCase();
      const age  = ageIdx >= 0 ? parseFloat(cols[ageIdx]) : null;
      return {
        rank:    rankIdx >= 0 ? parseInt(cols[rankIdx], 10) : null,
        rawName: (cols[nameIdx] || '').trim(),
        team:    (cols[teamIdx] || '').trim().toUpperCase(),
        pos,
        age:     Number.isFinite(age) ? Math.floor(age) : null,
      };
    })
    .filter((p) => p.rawName && RELEVANT_POSITIONS.has(p.pos));
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
  const csvArg = process.argv[2];
  let csvPath;

  if (csvArg) {
    csvPath = path.resolve(csvArg);
  } else {
    csvPath = findLatestDownload();
    if (!csvPath) {
      console.error(`ERROR: No file matching "${FILE_PREFIX}*.csv" found in ${DOWNLOADS_DIR}`);
      process.exit(1);
    }
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`ERROR: File not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`Input : ${csvPath}`);

  const players     = loadRankings(csvPath);
  const sleeperPool = loadSleeperCandidates();

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
