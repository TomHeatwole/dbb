#!/usr/bin/env node
/**
 * build_ktc_historical_name_map.js
 *
 * Builds a one-time name → ID lookup for KTC historical value rows.
 * Matches every unique name in sf_non_tep_ktc_values_historical.csv against:
 *   - KTC playersArray (playerID, slug, position, team)
 *   - Sleeper players.txt (sleeper_id) via the same fuzzy logic as audit_ktc_name_matches.js
 *
 * Output: site/public/data/ktc_historical_name_ids.csv
 *
 * Usage (from project root):
 *   node scripts/build_ktc_historical_name_map.js
 *   node scripts/build_ktc_historical_name_map.js --ktc-html /tmp/ktc_rankings.html
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR       = path.join(__dirname, '../site/public/data');
const HISTORICAL_CSV = path.join(DATA_DIR, 'sf_non_tep_ktc_values_historical.csv');
const KTC_VALUES_CSV = path.join(DATA_DIR, 'ktc_values.csv');
const PLAYERS_FILE   = path.join(DATA_DIR, 'players.txt');
const OUT_FILE       = path.join(DATA_DIR, 'ktc_historical_name_ids.csv');
const DEFAULT_KTC_HTML = '/tmp/ktc_rankings.html';

const RELEVANT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);
const PICK_RE = /^\d{4}\s+(Early|Mid|Late)\s+[1234](?:st|nd|rd|th)$/i;

function parseCsvRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
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

  const exactPool = candidates.filter((c) => c.fullName === searchName);
  if (exactPool.length === 1) return { candidate: exactPool[0], strategy: 'exact', ambiguous: [] };
  if (exactPool.length > 1) {
    const best = pickBest(exactPool);
    if (best) return { candidate: best, strategy: 'exact', ambiguous: [] };
    return { candidate: null, strategy: null, ambiguous: exactPool };
  }

  const normPool = candidates.filter((c) => normalise(c.fullName) === normSearch);
  if (normPool.length === 1) return { candidate: normPool[0], strategy: 'normalised', ambiguous: [] };
  if (normPool.length > 1) {
    const best = pickBest(normPool);
    if (best) return { candidate: best, strategy: 'normalised', ambiguous: [] };
    return { candidate: null, strategy: null, ambiguous: normPool };
  }

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

// ── Loaders ───────────────────────────────────────────────────────────────────

function loadUniqueNames(wideCsvPath) {
  const sourcePath = wideCsvPath || HISTORICAL_CSV;
  if (!fs.existsSync(sourcePath)) {
    console.error(`ERROR: source CSV not found: ${sourcePath}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(sourcePath, 'utf8').trim().split('\n');
  if (wideCsvPath) {
    const header = parseCsvRow(lines[0]);
    const names = header.slice(1).map((h) => h.trim()).filter(Boolean);
    return [...new Set(names)].sort();
  }
  const nameIdx = parseCsvRow(lines[0]).indexOf('name');
  const names = new Set();
  for (const line of lines.slice(1)) {
    const cols = parseCsvRow(line);
    const name = (cols[nameIdx] || '').trim();
    if (name) names.add(name);
  }
  return [...names].sort();
}

function loadKtcValueHints() {
  const hints = new Map();
  if (!fs.existsSync(KTC_VALUES_CSV)) return hints;
  const lines = fs.readFileSync(KTC_VALUES_CSV, 'utf8').trim().split('\n');
  const headers = lines[0].split(',');
  const nameIdx = headers.indexOf('name');
  const posIdx  = headers.indexOf('position');
  const teamIdx = headers.indexOf('team');
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const name = (cols[nameIdx] || '').trim();
    if (!name) continue;
    hints.set(name, {
      position: (cols[posIdx]  || '').trim(),
      team:     (cols[teamIdx] || '').trim(),
    });
  }
  return hints;
}

function loadKtcPlayersArray(ktcHtmlPath) {
  if (!fs.existsSync(ktcHtmlPath)) {
    console.error(`ERROR: KTC rankings HTML not found: ${ktcHtmlPath}`);
    process.exit(1);
  }
  const html = fs.readFileSync(ktcHtmlPath, 'utf8');
  const m = html.match(/var playersArray\s*=\s*(\[.*?\]);/s);
  if (!m) {
    console.error('ERROR: could not find playersArray in KTC rankings HTML');
    process.exit(1);
  }
  return JSON.parse(m[1]);
}

function loadSleeperCandidates() {
  const raw  = fs.readFileSync(PLAYERS_FILE, 'utf8');
  const data = JSON.parse(raw);
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

function buildKtcLookup(playersArray) {
  const byExact = new Map();
  const byNorm  = new Map();

  for (const p of playersArray) {
    const name = (p.playerName || '').trim();
    if (!name) continue;
    const entry = {
      ktcPlayerId: p.playerID ?? '',
      ktcSlug:     p.slug || '',
      position:    (p.position || '').toUpperCase(),
      team:        (p.team || '').toUpperCase(),
    };
    byExact.set(name, entry);
    const norm = normalise(name);
    if (!byNorm.has(norm)) byNorm.set(norm, []);
    byNorm.get(norm).push(entry);
  }

  return { byExact, byNorm };
}

function lookupKtc(name, ktcLookup) {
  const exact = ktcLookup.byExact.get(name);
  if (exact) return { ...exact, ktcMatch: 'exact' };

  const normHits = ktcLookup.byNorm.get(normalise(name)) || [];
  if (normHits.length === 1) return { ...normHits[0], ktcMatch: 'normalised' };
  if (normHits.length > 1) return { ...normHits[0], ktcMatch: 'ambiguous_ktc' };
  return { ktcPlayerId: '', ktcSlug: '', position: '', team: '', ktcMatch: 'no_ktc' };
}

function resolveHints(name, ktcHints, ktcEntry) {
  const fromValues = ktcHints.get(name) || {};
  return {
    position: fromValues.position || ktcEntry.position || '',
    team:     fromValues.team     || ktcEntry.team     || '',
  };
}

function csvEscape(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function run() {
  const args = process.argv.slice(2);
  const ktcHtmlIdx = args.indexOf('--ktc-html');
  const ktcHtmlPath = ktcHtmlIdx >= 0 ? args[ktcHtmlIdx + 1] : DEFAULT_KTC_HTML;
  const wideIdx = args.indexOf('--from-wide-csv');
  const wideCsvPath = wideIdx >= 0 ? args[wideIdx + 1] : null;

  const names         = loadUniqueNames(wideCsvPath);
  const ktcHints      = loadKtcValueHints();
  const playersArray  = loadKtcPlayersArray(ktcHtmlPath);
  const ktcLookup     = buildKtcLookup(playersArray);
  const sleeperPool   = loadSleeperCandidates();

  const rows = [];
  const counts = {
    pick: 0,
    sleeper_exact: 0,
    sleeper_normalised: 0,
    sleeper_last_name: 0,
    sleeper_duplicate: 0,
    sleeper_no_match: 0,
    ktc_matched: 0,
  };

  for (const name of names) {
    if (PICK_RE.test(name)) {
      rows.push({
        name,
        is_pick: '1',
        ktc_player_id: '',
        ktc_slug: '',
        sleeper_id: '',
        sleeper_name: '',
        position: 'PI',
        team: '',
        ktc_match: 'pick',
        sleeper_match: 'pick',
      });
      counts.pick += 1;
      continue;
    }

    const ktcEntry = lookupKtc(name, ktcLookup);
    if (ktcEntry.ktcPlayerId) counts.ktc_matched += 1;

    const hints = resolveHints(name, ktcHints, ktcEntry);
    const { candidate, strategy, ambiguous } = findBestPlayerMatch(name, sleeperPool, hints);

    let sleeperMatch = 'no_match';
    if (!candidate && ambiguous.length > 0) {
      sleeperMatch = 'duplicate';
      counts.sleeper_duplicate += 1;
    } else if (!candidate) {
      counts.sleeper_no_match += 1;
    } else {
      sleeperMatch = strategy;
      counts[`sleeper_${strategy}`] = (counts[`sleeper_${strategy}`] || 0) + 1;
    }

    rows.push({
      name,
      is_pick: '0',
      ktc_player_id: ktcEntry.ktcPlayerId,
      ktc_slug: ktcEntry.ktcSlug,
      sleeper_id: candidate ? candidate.sleeperId : '',
      sleeper_name: candidate ? candidate.fullName : '',
      position: hints.position || ktcEntry.position || (candidate ? candidate.position : ''),
      team: hints.team || ktcEntry.team || (candidate ? candidate.team : ''),
      ktc_match: ktcEntry.ktcMatch,
      sleeper_match: sleeperMatch,
    });
  }

  const header = [
    'name', 'is_pick', 'ktc_player_id', 'ktc_slug',
    'sleeper_id', 'sleeper_name', 'position', 'team',
    'ktc_match', 'sleeper_match',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((h) => csvEscape(row[h])).join(','));
  }
  fs.writeFileSync(OUT_FILE, `${lines.join('\n')}\n`, 'utf8');

  console.log('='.repeat(72));
  console.log('KTC historical name → ID map');
  console.log('='.repeat(72));
  console.log(`Unique names          : ${names.length}`);
  console.log(`  Draft picks         : ${counts.pick}`);
  console.log(`  KTC playerID found  : ${counts.ktc_matched}`);
  console.log(`Sleeper matches:`);
  console.log(`  exact               : ${counts.sleeper_exact || 0}`);
  console.log(`  normalised          : ${counts.sleeper_normalised || 0}`);
  console.log(`  last_name           : ${counts.sleeper_last_name || 0}`);
  console.log(`  duplicate           : ${counts.sleeper_duplicate}`);
  console.log(`  no_match            : ${counts.sleeper_no_match}`);
  console.log(`Wrote → ${OUT_FILE}`);
}

run();
