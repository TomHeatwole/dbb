/**
 * FantasyCalcLookup.js
 * Fetches and parses /data/fantasycalc.csv (semicolon-delimited, quoted fields).
 *
 * Primary lookup key: Sleeper player ID (present in the CSV as `sleeperId`).
 * Fallback: normalised player name.
 *
 * Each entry shape:
 * {
 *   name, team, position, age,
 *   sleeperId,
 *   value, overallRank, posRank, trend30day,
 * }
 */

import { normalisePlayerName, findBestPlayerMatch } from '../utils/playerNameMatcher';

let cachedBySleeperId = null;
let cachedByName      = null;

/**
 * Fetch and parse fantasycalc.csv.
 * Returns { bySleeperId: Map<string, entry>, byName: Map<normalisedName, entry> }.
 */
export async function fetchFantasyCalcData() {
  if (cachedBySleeperId) return { bySleeperId: cachedBySleeperId, byName: cachedByName };

  const res = await fetch('/data/fantasycalc.csv');
  if (!res.ok) throw new Error('Failed to fetch fantasycalc.csv');
  const text = await res.text();

  const lines = text.trim().split('\n');
  if (lines.length < 2) return { bySleeperId: new Map(), byName: new Map() };

  const headers    = lines[0].split(';');
  const nameIdx    = headers.indexOf('name');
  const teamIdx    = headers.indexOf('team');
  const posIdx     = headers.indexOf('position');
  const ageIdx     = headers.indexOf('age');
  const sidIdx     = headers.indexOf('sleeperId');
  const valIdx     = headers.indexOf('value');
  const oRankIdx   = headers.indexOf('overallRank');
  const pRankIdx   = headers.indexOf('positionRank');
  const trendIdx   = headers.indexOf('trend30day');

  const bySleeperId = new Map();
  const byName      = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cols    = lines[i].split(';').map(c => c.replace(/^"|"$/g, '').trim());
    const rawName = cols[nameIdx] || '';
    const value   = parseInt(cols[valIdx], 10);
    if (!rawName || !Number.isFinite(value)) continue;

    const entry = {
      name:       rawName,
      team:       cols[teamIdx]  || '',
      position:   cols[posIdx]   || '',
      age:        parseFloat(cols[ageIdx]) || null,
      sleeperId:  cols[sidIdx]   || '',
      value,
      overallRank: parseInt(cols[oRankIdx], 10) || null,
      posRank:     parseInt(cols[pRankIdx], 10) || null,
      trend30day:  parseInt(cols[trendIdx], 10) || null,
    };

    if (entry.sleeperId) bySleeperId.set(entry.sleeperId, entry);
    byName.set(normalisePlayerName(rawName), entry);
  }

  cachedBySleeperId = bySleeperId;
  cachedByName      = byName;
  return { bySleeperId, byName };
}

/**
 * Look up a player's FantasyCalc entry.
 *
 * @param {string|null} sleeperId   – Sleeper player ID (preferred lookup key)
 * @param {string}      playerName  – Display name (fallback)
 * @param {Map}         bySleeperId
 * @param {Map}         byName
 * @param {object}      hints       – { position?, team? } for fuzzy-match disambiguation
 */
export function getFantasyCalcEntry(sleeperId, playerName, bySleeperId, byName, hints = {}) {
  if (!bySleeperId && !byName) return null;

  if (sleeperId && bySleeperId) {
    const hit = bySleeperId.get(String(sleeperId));
    if (hit) return hit;
  }

  if (playerName && byName) {
    const direct = byName.get(normalisePlayerName(playerName));
    if (direct) return direct;

    const { candidate } = findBestPlayerMatch(
      playerName,
      Array.from(byName.values()),
      hints,
    );
    return candidate || null;
  }

  return null;
}

/**
 * Format a FantasyCalc value for display: "9,939" or "—".
 */
export function formatFcValue(value) {
  if (value == null || value <= 0) return '—';
  return value.toLocaleString();
}

/**
 * Format a 30-day trend for display: "+295" or "−79".
 * Returns null if trend is 0 or absent.
 */
export function formatFcTrend(trend) {
  if (trend == null || trend === 0) return null;
  return trend > 0 ? `+${trend}` : `${trend}`;
}
