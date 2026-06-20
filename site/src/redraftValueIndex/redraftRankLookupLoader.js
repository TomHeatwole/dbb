/**
 * Rank-slot lookup table for Redraft Value Index (40% year-weighted hist + 60% current KTC).
 */

const LOOKUP_CSV = '/data/ktc_redraft_rank_lookup.csv';

let lookupCache = null;

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

function lookupKey(position, rank) {
  return `${position}:${rank}`;
}

export async function loadRedraftRankLookup() {
  if (lookupCache) return lookupCache;

  const res = await fetch(LOOKUP_CSV);
  if (!res.ok) throw new Error('Failed to fetch ktc_redraft_rank_lookup.csv');

  const text = normalizeCsvText(await res.text());
  const lines = text.trim().split('\n');
  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);
  const map = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const position = (cols[idx('position')] || '').trim();
    const rank = parseInt(cols[idx('rank')], 10);
    if (!position || !Number.isFinite(rank)) continue;

    const weightedRaw = (cols[idx('weighted_hist_avg')] || '').trim();
    const currentRaw = (cols[idx('current_ktc_at_rank')] || '').trim();
    const blendedRaw = (cols[idx('blended_lookup_value')] || '').trim();

    map.set(lookupKey(position, rank), {
      position,
      rank,
      weighted_hist_avg: weightedRaw ? parseFloat(weightedRaw) : null,
      current_ktc_at_rank: currentRaw ? parseInt(currentRaw, 10) : null,
      blended_lookup_value: blendedRaw ? parseFloat(blendedRaw) : null,
    });
  }

  lookupCache = map;
  return map;
}

export function getRedraftRankSlot(lookupMap, position, rank) {
  return lookupMap.get(lookupKey(position, rank)) || null;
}

export function interpolateRedraftLookup(lookupMap, position, effRank) {
  if (!lookupMap || !position || effRank == null || effRank < 1) return null;

  const rankLow = Math.floor(effRank);
  const rankHigh = Math.ceil(effRank);
  const low = getRedraftRankSlot(lookupMap, position, rankLow);
  if (!low || low.blended_lookup_value == null) return null;

  if (rankLow === rankHigh) {
    return {
      effRank,
      rankLow,
      rankHigh,
      low,
      high: low,
      frac: 0,
      interpolated: low.blended_lookup_value,
      weightedLow: low.weighted_hist_avg,
      weightedHigh: low.weighted_hist_avg,
      currentLow: low.current_ktc_at_rank,
      currentHigh: low.current_ktc_at_rank,
      blendedLow: low.blended_lookup_value,
      blendedHigh: low.blended_lookup_value,
    };
  }

  const high = getRedraftRankSlot(lookupMap, position, rankHigh);
  if (!high || high.blended_lookup_value == null) return null;

  const frac = effRank - rankLow;
  const interp = (lo, hi) => {
    if (lo == null || hi == null) return null;
    return lo + frac * (hi - lo);
  };

  return {
    effRank,
    rankLow,
    rankHigh,
    low,
    high,
    frac,
    interpolated: interp(low.blended_lookup_value, high.blended_lookup_value),
    weightedLow: low.weighted_hist_avg,
    weightedHigh: high.weighted_hist_avg,
    currentLow: low.current_ktc_at_rank,
    currentHigh: high.current_ktc_at_rank,
    blendedLow: low.blended_lookup_value,
    blendedHigh: high.blended_lookup_value,
  };
}
