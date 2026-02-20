#!/usr/bin/env node
/**
 * audit_ktc_name_matches.js
 *
 * Runs every player in ktc_values.csv through the same smart name-matching
 * logic used by the Dynasty Roster Values feature, against the full Sleeper
 * players.txt database.
 *
 * Match strategies (in order, mirrors playerNameMatcher.js):
 *   1. EXACT       – raw name string is identical
 *   2. NORMALISED  – matched after stripping punctuation / generational suffixes
 *   3. DISAMBIG    – multiple normalised hits resolved via position / team / age
 *   4. LAST_NAME   – no full-name match; matched by last name + position/team hint
 *   5. DUPLICATE   – multiple candidates remain even after hint scoring (ambiguous)
 *   6. NO_MATCH    – nothing found at all
 *
 * Usage:
 *   node scripts/audit_ktc_name_matches.js
 *   node scripts/audit_ktc_name_matches.js --flagged-only    (everything except EXACT)
 *   node scripts/audit_ktc_name_matches.js --no-match-only
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR     = path.join(__dirname, '../site/public/data');
const KTC_FILE     = path.join(DATA_DIR, 'ktc_values.csv');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.txt');

const RELEVANT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

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

/**
 * @param {string}        searchName
 * @param {Array<Object>} candidates   - Sleeper player entries
 * @param {Object}        hints        - { position?, team?, age? } from KTC
 * @returns {{ candidate, strategy, ambiguous }}
 *   strategy: 'exact' | 'normalised' | 'last_name' | null
 */
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

  // 3. Last-name fallback (requires at least one hint to guard false positives)
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

// ── Load KTC players ───────────────────────────────────────────────────────────

function loadKtc() {
  const lines   = fs.readFileSync(KTC_FILE, 'utf8').trim().split('\n');
  const headers = lines[0].split(',');
  const nameIdx = headers.indexOf('name');
  const posIdx  = headers.indexOf('position');
  const teamIdx = headers.indexOf('team');

  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    return {
      rawName:  (cols[nameIdx]  || '').trim(),
      position: (cols[posIdx]   || '').trim(),
      team:     (cols[teamIdx]  || '').trim(),
    };
  }).filter((p) => p.rawName && RELEVANT_POSITIONS.has(p.position));
}

// ── Load Sleeper players into a flat array ────────────────────────────────────

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

// ── Main ──────────────────────────────────────────────────────────────────────

function run() {
  const args        = process.argv.slice(2);
  const noMatchOnly = args.includes('--no-match-only');
  const flaggedOnly = args.includes('--flagged-only');

  const ktcPlayers  = loadKtc();
  const sleeperPool = loadSleeperCandidates();

  const results = [];

  for (const { rawName, position, team } of ktcPlayers) {
    const hints = { position, team };
    const { candidate, strategy, ambiguous } = findBestPlayerMatch(rawName, sleeperPool, hints);

    // Determine the display status
    let status;
    if (!candidate && ambiguous.length > 0) {
      status = 'DUPLICATE';
    } else if (!candidate) {
      status = 'NO_MATCH';
    } else if (strategy === 'exact') {
      status = 'EXACT';
    } else if (strategy === 'normalised') {
      // Was a duplicate resolved by hints, or a genuine normalised single-hit?
      status = 'NORMALISED';
    } else if (strategy === 'last_name') {
      status = 'LAST_NAME';
    } else {
      status = 'NO_MATCH';
    }

    results.push({ rawName, position, team, status, strategy, candidate, ambiguous });
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  const counts = { EXACT: 0, NORMALISED: 0, LAST_NAME: 0, DUPLICATE: 0, NO_MATCH: 0 };
  for (const r of results) counts[r.status]++;

  console.log('='.repeat(72));
  console.log('KTC → Sleeper name match audit');
  console.log('='.repeat(72));
  console.log(`Total KTC players checked : ${results.length}`);
  console.log(`  EXACT                   : ${counts.EXACT}`);
  console.log(`  NORMALISED (fuzzy)      : ${counts.NORMALISED}`);
  console.log(`  LAST_NAME (nickname)    : ${counts.LAST_NAME}`);
  console.log(`  DUPLICATE (ambiguous)   : ${counts.DUPLICATE}`);
  console.log(`  NO_MATCH                : ${counts.NO_MATCH}`);
  console.log('='.repeat(72));
  console.log();

  const toShow = results.filter((r) => {
    if (noMatchOnly)  return r.status === 'NO_MATCH';
    if (flaggedOnly)  return r.status !== 'EXACT';
    return true;
  });

  for (const r of toShow) {
    const tag = `[${r.status}]`.padEnd(12);
    const pos = r.position.padEnd(3);

    if (r.status === 'EXACT') {
      const m = r.candidate;
      console.log(`${tag} ${pos} "${r.rawName}"  →  id:${m.sleeperId}  (${m.team})`);

    } else if (r.status === 'NORMALISED') {
      const m = r.candidate;
      console.log(`${tag} ${pos} "${r.rawName}"  →  "${m.fullName}"  id:${m.sleeperId}  (${m.position} ${m.team})`);
      if (normalise(r.rawName) !== normalise(m.fullName)) {
        console.log(`             normalised: "${normalise(r.rawName)}" ← "${normalise(m.fullName)}"`);
      }

    } else if (r.status === 'LAST_NAME') {
      const m = r.candidate;
      console.log(`${tag} ${pos} "${r.rawName}"  →  "${m.fullName}"  id:${m.sleeperId}  (${m.position} ${m.team})`);
      console.log(`             matched on last name + position/team hints`);

    } else if (r.status === 'DUPLICATE') {
      console.log(`${tag} ${pos} "${r.rawName}"  →  ${r.ambiguous.length} candidates (unresolved):`);
      for (const m of r.ambiguous) {
        console.log(`             id:${m.sleeperId}  "${m.fullName}"  (${m.position} ${m.team}  age:${m.age ?? '?'})`);
      }

    } else {
      console.log(`${tag} ${pos} "${r.rawName}"  →  no match  (ktc team: ${r.team || '—'})`);
    }
  }

  console.log();
  console.log(`Showing ${toShow.length} / ${results.length} entries.`);
}

run();
