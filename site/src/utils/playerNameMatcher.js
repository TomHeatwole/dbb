/**
 * playerNameMatcher.js
 *
 * Shared utilities for fuzzy-matching player names across data sources
 * (e.g. Sleeper API ↔ KTC CSV, FantasyCalc CSV, etc.).
 *
 * The core idea: normalise both sides to a canonical lowercase ASCII form
 * before comparing, so punctuation differences, suffix variants, and extra
 * whitespace don't cause false misses.
 *
 * Normalisation rules applied in order:
 *  1. Unicode NFD decomposition (é → e + combining accent) + strip diacritics
 *  2. Lowercase everything
 *  3. Strip trailing generational suffixes (Jr., Sr., II, III, IV, V)
 *  4. Remove all non-alphanumeric characters except spaces
 *  5. Collapse and trim whitespace
 *
 * Examples:
 *  "Ja'Marr Chase"      → "jmarr chase"
 *  "Jaxon Smith-Njigba" → "jaxon smithnjigba"
 *  "Calvin Ridley Jr."  → "calvin ridley"
 *  "Audric Estimé"      → "audric estime"
 */

/**
 * Map FantasyPros / KeepTradeCut-style abbreviations onto the canonical
 * codes used by Sleeper and FantasyCalc (TB, GB, KC, …).
 * Kept as identity entries where sources already agree.
 */
const NFL_TEAM_ALIASES = {
  TBB: 'TB', TAM: 'TB',
  GBP: 'GB', GNB: 'GB',
  KCC: 'KC', KAN: 'KC',
  NEP: 'NE', NWE: 'NE',
  NOS: 'NO', NOR: 'NO',
  SFO: 'SF',
  JAC: 'JAX',
  LVR: 'LV', OAK: 'LV', RAI: 'LV',
  ARZ: 'ARI',
  WSH: 'WAS', WASH: 'WAS',
  SD: 'LAC', SDG: 'LAC',
  STL: 'LAR',
};

/**
 * Normalise an NFL team abbreviation for cross-source comparison.
 * Returns '' for missing / free-agent markers so callers can treat them
 * as "no team hint" rather than a hard mismatch against rostered codes.
 * @param {string|null|undefined} team
 * @returns {string}
 */
export function normaliseNflTeam(team) {
  if (team == null) return '';
  const upper = String(team).replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!upper || upper === 'FA' || upper === 'NONE') return '';
  return NFL_TEAM_ALIASES[upper] || upper;
}

/**
 * Normalise a player name to a canonical form for comparison.
 * @param {string} name
 * @returns {string}
 */
export function normalisePlayerName(name) {
  return (name || '')
    .normalize('NFD')                    // decompose accented chars (é → e + ◌́)
    .replace(/[\u0300-\u036f]/g, '')     // strip combining diacritical marks
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Return true if two player names refer to the same player after normalisation.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function playerNamesMatch(a, b) {
  return normalisePlayerName(a) === normalisePlayerName(b);
}

/**
 * True when first names look like the same person under a nickname/short form
 * (Kenny/Kenneth, Chig/Chigoziem, Josh/Joshua), not merely the same initial.
 * @param {string} nameA
 * @param {string} nameB
 * @returns {boolean}
 */
export function firstNamesCompatible(nameA, nameB) {
  const a = normalisePlayerName(nameA).split(' ')[0] || '';
  const b = normalisePlayerName(nameB).split(' ')[0] || '';
  if (!a || !b) return false;
  if (a === b) return true;
  // One name is a short form of the other (josh/joshua, pat/patrick)
  if (a.startsWith(b) || b.startsWith(a)) return true;
  // Shared stem of 3+ chars (kenny/kenneth → "ken")
  const limit = Math.min(a.length, b.length);
  let shared = 0;
  while (shared < limit && a[shared] === b[shared]) shared += 1;
  return shared >= 3;
}

/**
 * Find the best matching player from a collection of candidates.
 *
 * Matching strategy (in order):
 *   1. Exact name match (raw string equality)
 *   2. Normalised name match (punctuation/suffixes stripped)
 *   3. On multiple matches: score by position → team → age to find an
 *      unambiguous winner
 *   4. If still no match: last-name-only search filtered by position/team hints
 *      and compatible first names (at least one hint required to avoid false positives)
 *
 * Team hints are compared after {@link normaliseNflTeam} so KTC codes like
 * "TBB" match Sleeper/FantasyCalc "TB".
 *
 * @param {string}        searchName
 * @param {Array<Object>} candidates   - pool of player objects to search
 * @param {Object}        [hints]      - { position?, team?, age? }
 * @param {Object}        [keys]       - property names in candidate objects;
 *                                       defaults: name='name', position='position',
 *                                                 team='team', age='age'
 * @returns {{
 *   candidate: Object|null,
 *   strategy:  'exact'|'normalised'|'last_name'|null,
 *   ambiguous: Array<Object>
 * }}
 *   strategy  – how the match was found, or null when unresolved
 *   ambiguous – the tied candidates when resolution failed
 */
export function findBestPlayerMatch(searchName, candidates, hints = {}, keys = {}) {
  const nameKey = keys.name     || 'name';
  const posKey  = keys.position || 'position';
  const teamKey = keys.team     || 'team';
  const ageKey  = keys.age      || 'age';

  const normSearch     = normalisePlayerName(searchName);
  const lastNameSearch = normSearch.split(' ').pop();
  const hintTeam       = normaliseNflTeam(hints.team);

  // Score a candidate against the supplied hints.
  // Position is the strongest signal, team is secondary, exact age is a tiebreaker.
  function hintScore(c) {
    let score = 0;
    if (hints.position && c[posKey]) {
      if ((c[posKey] || '').toUpperCase() === (hints.position || '').toUpperCase()) score += 4;
    }
    if (hintTeam && c[teamKey]) {
      if (normaliseNflTeam(c[teamKey]) === hintTeam) score += 2;
    }
    if (hints.age != null && c[ageKey] != null) {
      if (Math.abs(Number(c[ageKey]) - Number(hints.age)) === 0) score += 1;
    }
    return score;
  }

  // From a pool, return the single best candidate using hint scoring.
  // Returns null when the pool is empty or when the top score is tied.
  function pickBest(pool) {
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0];
    const hasHints = hints.position || hintTeam || hints.age != null;
    if (!hasHints) return null;
    const scored = pool
      .map((c) => ({ c, score: hintScore(c) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score > 0 && scored[0].score > scored[1].score) return scored[0].c;
    return null;
  }

  // ── 1. Exact name match ────────────────────────────────────────────────────
  const exactPool = candidates.filter((c) => (c[nameKey] || '') === searchName);
  if (exactPool.length === 1) {
    return { candidate: exactPool[0], strategy: 'exact', ambiguous: [] };
  }
  if (exactPool.length > 1) {
    const best = pickBest(exactPool);
    if (best) return { candidate: best, strategy: 'exact', ambiguous: [] };
    return { candidate: null, strategy: null, ambiguous: exactPool };
  }

  // ── 2. Normalised name match ───────────────────────────────────────────────
  const normPool = candidates.filter(
    (c) => normalisePlayerName(c[nameKey] || '') === normSearch
  );
  if (normPool.length === 1) {
    return { candidate: normPool[0], strategy: 'normalised', ambiguous: [] };
  }
  if (normPool.length > 1) {
    const best = pickBest(normPool);
    if (best) return { candidate: best, strategy: 'normalised', ambiguous: [] };
    return { candidate: null, strategy: null, ambiguous: normPool };
  }

  // ── 3. Last-name fallback (nickname / alias support) ──────────────────────
  // Requires at least one hint to guard against false positives.
  // First names must also be compatible so Kameron Johnson ≠ Tez Johnson
  // even when last name, position, and (normalised) team all match.
  const hasHintsForLastName = hints.position || hintTeam;
  if (hasHintsForLastName) {
    const lastNamePool = candidates.filter((c) => {
      const normCand = normalisePlayerName(c[nameKey] || '');
      if (normCand.split(' ').pop() !== lastNameSearch) return false;
      if (!firstNamesCompatible(searchName, c[nameKey] || '')) return false;
      if (hints.position && (c[posKey] || '').toUpperCase() !== (hints.position || '').toUpperCase()) return false;
      if (hintTeam) {
        const candTeam = normaliseNflTeam(c[teamKey]);
        // Empty candidate team (FA) never satisfies a concrete team hint
        if (!candTeam || candTeam !== hintTeam) return false;
      }
      return true;
    });
    if (lastNamePool.length === 1) {
      return { candidate: lastNamePool[0], strategy: 'last_name', ambiguous: [] };
    }
    if (lastNamePool.length > 1) {
      const best = pickBest(lastNamePool);
      if (best) return { candidate: best, strategy: 'last_name', ambiguous: [] };
      return { candidate: null, strategy: null, ambiguous: lastNamePool };
    }
  }

  return { candidate: null, strategy: null, ambiguous: [] };
}
