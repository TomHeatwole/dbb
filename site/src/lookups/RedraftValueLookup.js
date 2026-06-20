/**
 * RedraftValueLookup.js
 * Fetches and parses /data/ktc_redraft_value_index.csv for competitor / rebuilder values.
 */

import { normalisePlayerName, findBestPlayerMatch } from '../utils/playerNameMatcher';
import { formatKtcValue } from './KtcLookup';

const REDRAFT_VALUE_CSV = '/data/ktc_redraft_value_index.csv';

let cachedByName = null;
let cachedAsOf = null;
let cachedAdpSource = null;

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
  fields.push(current.replace(/\r$/, ''));
  return fields;
}

function normalizeCsvText(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseIntOrNull(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloatOrNull(val) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

/** Positional ranks within QB/RB/WR/TE by adjusted value (RB12 style). */
export function assignPosValueRanks(entries, valueKey, rankKey) {
  const byPos = {};
  for (const entry of entries) {
    const value = entry[valueKey];
    if (value == null || value <= 0 || !entry.position) continue;
    if (!byPos[entry.position]) byPos[entry.position] = [];
    byPos[entry.position].push(entry);
  }
  for (const group of Object.values(byPos)) {
    group.sort((a, b) => b[valueKey] - a[valueKey]);
    group.forEach((entry, idx) => {
      entry[rankKey] = idx + 1;
    });
  }
}

/** Overall rank across all skill positions by adjusted value. */
export function assignOverallValueRanks(entries, valueKey, rankKey) {
  const ranked = entries
    .filter((entry) => entry[valueKey] != null && entry[valueKey] > 0)
    .sort((a, b) => b[valueKey] - a[valueKey]);
  ranked.forEach((entry, idx) => {
    entry[rankKey] = idx + 1;
  });
}

function ensureAdjustedRanks(byName) {
  const entries = Array.from(byName.values());
  assignPosValueRanks(entries, 'competitorAdjustedValue', 'competitorAdjustedRank');
  assignPosValueRanks(entries, 'rebuilderAdjustedValue', 'rebuilderAdjustedRank');
  assignOverallValueRanks(entries, 'competitorAdjustedValue', 'competitorAdjustedOverallRank');
  assignOverallValueRanks(entries, 'rebuilderAdjustedValue', 'rebuilderAdjustedOverallRank');
}

/**
 * Fetch and parse ktc_redraft_value_index.csv.
 * Returns { byName: Map<normalisedName, entry>, asOf, adpSource }.
 */
export async function fetchRedraftValueData() {
  if (cachedByName) {
    ensureAdjustedRanks(cachedByName);
    return { byName: cachedByName, asOf: cachedAsOf, adpSource: cachedAdpSource };
  }

  const res = await fetch(REDRAFT_VALUE_CSV);
  if (!res.ok) throw new Error('Failed to fetch ktc_redraft_value_index.csv');

  const text = normalizeCsvText(await res.text());
  const lines = text.trim().split('\n');
  if (lines.length < 2) {
    cachedByName = new Map();
    return { byName: cachedByName, asOf: null, adpSource: null };
  }

  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);

  const byName = new Map();
  let asOf = null;
  let adpSource = null;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const name = (cols[idx('name')] || '').trim();
    if (!name) continue;

    const competitorAdjusted = parseIntOrNull(
      (cols[idx('competitor_adjusted_value')] || cols[idx('redraft_adjusted_value')] || '').trim(),
    );
    const rebuilderAdjusted = parseIntOrNull(
      (cols[idx('rebuilder_adjusted_value')] || '').trim(),
    );
    if (competitorAdjusted == null && rebuilderAdjusted == null) continue;

    if (!asOf) asOf = (cols[idx('as_of')] || '').trim() || null;
    if (!adpSource) adpSource = (cols[idx('adp_source')] || '').trim() || null;

    const entry = {
      name,
      position: (cols[idx('position')] || '').trim(),
      nflTeam: (cols[idx('team')] || '').trim(),
      ktcValue: parseIntOrNull((cols[idx('ktc_value')] || '').trim()),
      ktcPosRank: parseIntOrNull((cols[idx('ktc_pos_rank')] || '').trim()),
      adpEffRank: parseFloatOrNull((cols[idx('adp_eff_rank')] || '').trim()),
      adpPosRank: parseIntOrNull(
        (cols[idx('adp_stack_rank')] || cols[idx('adp_pos_rank')] || '').trim(),
      ),
      competitorAdjustedValue: competitorAdjusted,
      rebuilderAdjustedValue: rebuilderAdjusted,
      redraftValueIndex: parseFloatOrNull((cols[idx('redraft_value_index')] || '').trim()),
      rebuildValueIndex: parseFloatOrNull((cols[idx('rebuild_value_index')] || '').trim()),
    };

    byName.set(normalisePlayerName(name), entry);
  }

  ensureAdjustedRanks(byName);

  cachedByName = byName;
  cachedAsOf = asOf;
  cachedAdpSource = adpSource;
  return { byName, asOf, adpSource };
}

/**
 * Look up redraft-adjusted values for a player by name.
 * hints: { position?, team? } for fallback matching.
 */
export function getRedraftValueEntryByName(playerName, byName, hints = {}) {
  if (!byName || !playerName) return null;

  let entry = byName.get(normalisePlayerName(playerName));
  if (!entry) {
    const { candidate } = findBestPlayerMatch(
      playerName,
      Array.from(byName.values()),
      hints,
      { team: 'nflTeam' },
    );
    entry = candidate;
  }
  return entry || null;
}

export { formatKtcValue as formatRedraftAdjustedValue };
