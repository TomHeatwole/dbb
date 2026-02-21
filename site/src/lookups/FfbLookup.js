/**
 * FfbLookup.js
 * Fetches and parses /data/ffb.csv (comma-delimited).
 *
 * Columns: rank, name, sleeper_id
 *
 * Primary lookup key: Sleeper player ID.
 * Fallback: normalised player name.
 *
 * Each entry shape: { name, rank, sleeperId }
 */

import { normalisePlayerName } from '../utils/playerNameMatcher';

let cachedBySleeperId = null;
let cachedByName      = null;

/**
 * Fetch and parse ffb.csv.
 * Returns { bySleeperId: Map<string, entry>, byName: Map<normalisedName, entry> }.
 */
export async function fetchFfbData() {
  if (cachedBySleeperId) return { bySleeperId: cachedBySleeperId, byName: cachedByName };

  const res = await fetch('/data/ffb.csv');
  if (!res.ok) throw new Error('Failed to fetch ffb.csv');
  const text = await res.text();

  const lines = text.trim().split('\n');
  if (lines.length < 2) return { bySleeperId: new Map(), byName: new Map() };

  const headers  = lines[0].split(',').map(h => h.trim());
  const rankIdx  = headers.indexOf('rank');
  const nameIdx  = headers.indexOf('name');
  const sidIdx   = headers.indexOf('sleeper_id');

  const bySleeperId = new Map();
  const byName      = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cols    = lines[i].split(',').map(c => c.trim());
    const rawName = cols[nameIdx] || '';
    const rank    = parseInt(cols[rankIdx], 10);
    if (!rawName || !Number.isFinite(rank)) continue;

    const entry = {
      name:      rawName,
      rank,
      sleeperId: cols[sidIdx] || '',
    };

    if (entry.sleeperId) bySleeperId.set(entry.sleeperId, entry);
    byName.set(normalisePlayerName(rawName), entry);
  }

  cachedBySleeperId = bySleeperId;
  cachedByName      = byName;
  return { bySleeperId, byName };
}

/**
 * Look up a player's FFB entry.
 *
 * @param {string|null} sleeperId   – Sleeper player ID (preferred lookup key)
 * @param {string}      playerName  – Display name (fallback)
 * @param {Map}         bySleeperId
 * @param {Map}         byName
 */
export function getFfbEntry(sleeperId, playerName, bySleeperId, byName) {
  if (!bySleeperId && !byName) return null;

  if (sleeperId && bySleeperId) {
    const hit = bySleeperId.get(String(sleeperId));
    if (hit) return hit;
  }

  if (playerName && byName) {
    return byName.get(normalisePlayerName(playerName)) || null;
  }

  return null;
}

/**
 * Format an FFB rank for display: "#5" or "—".
 */
export function formatFfbRank(rank) {
  if (rank == null) return '—';
  return `#${rank}`;
}
