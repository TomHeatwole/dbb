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
 *  1. Lowercase everything
 *  2. Strip trailing generational suffixes (Jr., Sr., II, III, IV, V)
 *  3. Remove all non-alphanumeric characters except spaces
 *     (apostrophes, hyphens, periods, etc.)
 *  4. Collapse and trim whitespace
 *
 * Examples:
 *  "Ja'Marr Chase"      → "jmarr chase"
 *  "Jaxon Smith-Njigba" → "jaxon smithnjigba"
 *  "Calvin Ridley Jr."  → "calvin ridley"
 */

/**
 * Normalise a player name to a canonical form for comparison.
 * @param {string} name
 * @returns {string}
 */
export function normalisePlayerName(name) {
  return (name || '')
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
