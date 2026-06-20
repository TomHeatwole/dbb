#!/usr/bin/env node
/**
 * enrich_ktc_historical_sleeper_ids.js
 *
 * Re-resolves Sleeper IDs for every player name in the KTC historical CSVs
 * using players.txt + ktc_values.csv hints (same logic as build_ktc_historical_name_map.js).
 * Updates sleeper_id in place on:
 *   - site/public/data/sf_non_tep_ktc_values_historical.csv
 *   - site/public/data/sf_tep_ktc_values_historical.csv
 *
 * Writes unmatched player names to:
 *   - site/public/data/ktc_historical_sleeper_unmatched.txt
 *
 * Usage (from project root):
 *   node scripts/enrich_ktc_historical_sleeper_ids.js
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../site/public/data');
const FILES = [
  path.join(DATA_DIR, 'sf_non_tep_ktc_values_historical.csv'),
  path.join(DATA_DIR, 'sf_tep_ktc_values_historical.csv'),
];
const KTC_VALUES_CSV = path.join(DATA_DIR, 'ktc_values.csv');
const PLAYERS_FILE   = path.join(DATA_DIR, 'players.txt');
const UNMATCHED_FILE = path.join(DATA_DIR, 'ktc_historical_sleeper_unmatched.txt');

const { lookupSleeperAlias } = require('./ktc_historical_sleeper_aliases');

const RELEVANT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);
const PICK_RE = /^\d{4}\s+(Early|Mid|Late)\s+[1234](?:st|nd|rd|th)$/i;

function parseCsvRow(line) {
  if (line.endsWith('\r')) line = line.slice(0, -1);
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

function csvEscape(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

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

function loadUniqueNamesFromHistorical(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
  const header = parseCsvRow(lines[0]);
  const nameIdx = header.indexOf('name');
  const names = new Set();
  for (const line of lines.slice(1)) {
    const name = (parseCsvRow(line)[nameIdx] || '').trim();
    if (name) names.add(name);
  }
  return names;
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

function buildSleeperLookup(allNames, tepOnlyNames, ktcHints, sleeperPool) {
  const lookup = new Map();

  for (const name of allNames) {
    if (PICK_RE.test(name)) {
      lookup.set(name, { sleeper_id: '', sleeper_match: 'pick', sleeper_name: '' });
      continue;
    }

    const fromKtc = ktcHints.get(name) || {};
    const hints = {
      position: fromKtc.position || (tepOnlyNames.has(name) ? 'TE' : ''),
      team:     fromKtc.team || '',
    };

    let { candidate, strategy, ambiguous } = findBestPlayerMatch(name, sleeperPool, hints);
    if (!candidate) {
      const alias = lookupSleeperAlias(name, sleeperPool);
      if (alias) {
        candidate = alias.candidate;
        strategy = alias.strategy;
        ambiguous = [];
      }
    }

    let sleeperMatch = 'no_match';
    if (!candidate && ambiguous.length > 0) {
      sleeperMatch = 'duplicate';
    } else if (candidate) {
      sleeperMatch = strategy;
    }

    lookup.set(name, {
      sleeper_id:   candidate ? candidate.sleeperId : '',
      sleeper_name: candidate ? candidate.fullName : '',
      sleeper_match: sleeperMatch,
      position: hints.position || (candidate ? candidate.position : ''),
    });
  }

  return lookup;
}

function rewriteHistoricalCsv(csvPath, lookup) {
  const text = fs.readFileSync(csvPath, 'utf8').trim();
  const lines = text.split(/\r?\n/);
  const header = parseCsvRow(lines[0]);
  const nameIdx = header.indexOf('name');
  const sleeperIdx = header.indexOf('sleeper_id');
  if (nameIdx < 0 || sleeperIdx < 0) {
    throw new Error(`expected name and sleeper_id columns in ${csvPath}`);
  }

  const out = [header.map(csvEscape).join(',')];
  let updated = 0;

  for (const line of lines.slice(1)) {
    const cols = parseCsvRow(line);
    const name = (cols[nameIdx] || '').trim();
    const entry = lookup.get(name);
    if (entry && entry.sleeper_id && entry.sleeper_id !== cols[sleeperIdx]) {
      cols[sleeperIdx] = entry.sleeper_id;
      updated += 1;
    } else if (entry && entry.sleeper_id) {
      cols[sleeperIdx] = entry.sleeper_id;
    }
    out.push(cols.map(csvEscape).join(','));
  }

  fs.writeFileSync(csvPath, `${out.join('\n')}\n`, 'utf8');
  return { rows: lines.length - 1, updated };
}

function run() {
  for (const file of FILES) {
    if (!fs.existsSync(file)) {
      console.error(`ERROR: missing ${file}`);
      process.exit(1);
    }
  }

  const nonTepNames = loadUniqueNamesFromHistorical(FILES[0]);
  const tepNames    = loadUniqueNamesFromHistorical(FILES[1]);
  const allNames    = new Set([...nonTepNames, ...tepNames]);
  const tepOnlyNames = new Set([...tepNames].filter((n) => !nonTepNames.has(n)));

  const ktcHints    = loadKtcValueHints();
  const sleeperPool = loadSleeperCandidates();
  const lookup      = buildSleeperLookup(allNames, tepOnlyNames, ktcHints, sleeperPool);

  console.log('='.repeat(72));
  console.log('Enriching KTC historical CSVs with Sleeper IDs');
  console.log('='.repeat(72));
  console.log(`Unique names (union)  : ${allNames.size}`);
  console.log(`  TE-only names       : ${tepOnlyNames.size}`);

  for (const file of FILES) {
    const { rows, updated } = rewriteHistoricalCsv(file, lookup);
    console.log(`Updated ${path.basename(file)}: ${updated.toLocaleString()} rows (${rows.toLocaleString()} total)`);
  }

  const players = [...allNames].filter((n) => !PICK_RE.test(n)).sort();
  const unmatched = players.filter((n) => !(lookup.get(n)?.sleeper_id));
  const duplicates = players.filter((n) => lookup.get(n)?.sleeper_match === 'duplicate');

  const reportLines = [
    '# KTC historical names with no Sleeper ID match',
    `# Generated: ${new Date().toISOString()}`,
    `# Total player names: ${players.length}`,
    `# Unmatched: ${unmatched.length}`,
    `# Ambiguous (duplicate): ${duplicates.length}`,
    '',
  ];

  if (unmatched.length) {
    reportLines.push('## No match');
    for (const name of unmatched) {
      const entry = lookup.get(name);
      const pos = entry?.position || ktcHints.get(name)?.position || '';
      reportLines.push(`- ${name}${pos ? ` (${pos})` : ''}`);
    }
    reportLines.push('');
  }

  if (duplicates.length) {
    reportLines.push('## Ambiguous (multiple Sleeper candidates)');
    for (const name of duplicates) {
      const pos = lookup.get(name)?.position || '';
      reportLines.push(`- ${name}${pos ? ` (${pos})` : ''}`);
    }
    reportLines.push('');
  }

  fs.writeFileSync(UNMATCHED_FILE, `${reportLines.join('\n')}\n`, 'utf8');
  console.log(`\nSleeper match summary (players only):`);
  console.log(`  matched   : ${players.length - unmatched.length - duplicates.length}`);
  console.log(`  duplicate : ${duplicates.length}`);
  console.log(`  no_match  : ${unmatched.length}`);
  console.log(`Wrote report → ${UNMATCHED_FILE}`);

  if (unmatched.length) {
    console.log('\nNo Sleeper match:');
    for (const name of unmatched) {
      console.log(`  - ${name}`);
    }
  }
  if (duplicates.length) {
    console.log('\nAmbiguous duplicate:');
    for (const name of duplicates) {
      console.log(`  - ${name}`);
    }
  }
}

run();
