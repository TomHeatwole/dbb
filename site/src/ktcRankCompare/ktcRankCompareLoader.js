/**
 * Loaders for KTC Rank Compare sandbox module.
 */

import { formatKtcValue } from '../lookups/KtcLookup';

export { formatKtcValue };

const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const OVERALL_TAB = 'Overall';
const TABS = [OVERALL_TAB, ...POSITIONS];
const OVERALL_POSITION = 'OVERALL';

let currentByPositionCache = null;
let rankValuesCache = null;

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

function rankValueKey(tab, rank) {
  if (tab === OVERALL_TAB) {
    return `overall:${OVERALL_POSITION}:${rank}`;
  }
  return `positional:${tab}:${rank}`;
}

async function parseRankValuesCsv(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}`);
  const text = await res.text();
  const lines = text.trim().split('\n');
  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);

  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const metric = cols[idx('metric')];
    const rank = parseInt(cols[idx('rank')], 10);
    if (!Number.isFinite(rank)) continue;

    if (metric === 'positional') {
      const position = cols[idx('position')];
      if (!POSITIONS.includes(position)) continue;
      map.set(rankValueKey(position, rank), {
        label: cols[idx('label')],
        average_value: parseFloat(cols[idx('average_value')]),
        day_count: parseInt(cols[idx('day_count')], 10),
      });
      continue;
    }

    if (metric === 'overall' && cols[idx('position')] === OVERALL_POSITION) {
      map.set(rankValueKey(OVERALL_TAB, rank), {
        label: cols[idx('label')],
        average_value: parseFloat(cols[idx('average_value')]),
        day_count: parseInt(cols[idx('day_count')], 10),
      });
    }
  }
  return map;
}

export async function loadRankValuesMap() {
  if (rankValuesCache) return rankValuesCache;
  rankValuesCache = await parseRankValuesCsv('/data/ktc_average_rank_values.csv');
  return rankValuesCache;
}

export async function loadKtcRankCompareData() {
  if (currentByPositionCache && rankValuesCache) {
    return {
      currentByPosition: currentByPositionCache,
      rankValues: rankValuesCache,
    };
  }

  const [ktcRes, rankValues] = await Promise.all([
    fetch('/data/ktc_values.csv'),
    parseRankValuesCsv('/data/ktc_average_rank_values.csv'),
  ]);
  if (!ktcRes.ok) throw new Error('Failed to fetch ktc_values.csv');

  const text = await ktcRes.text();
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const idx = (name) => headers.indexOf(name);
  const asOfIdx = idx('as_of');

  const byPosition = { [OVERALL_TAB]: [], QB: [], RB: [], WR: [], TE: [] };
  let asOf = null;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const position = (cols[idx('position')] || '').trim().toUpperCase();
    if (!POSITIONS.includes(position)) continue;
    const name = (cols[idx('name')] || '').trim();
    const value = parseInt(cols[idx('ktc_value_tep_2qb')], 10);
    if (!name || !Number.isFinite(value)) continue;
    if (!asOf && asOfIdx >= 0) asOf = (cols[asOfIdx] || '').trim();

    const row = {
      name,
      position,
      team: (cols[idx('team')] || '').trim(),
      value,
    };
    byPosition[position].push(row);
    byPosition[OVERALL_TAB].push(row);
  }

  for (const pos of TABS) {
    byPosition[pos].sort((a, b) => b.value - a.value);
    byPosition[pos] = byPosition[pos].map((row, i) => ({
      ...row,
      posRank: i + 1,
      rankLabel: pos === OVERALL_TAB ? `Overall${i + 1}` : `${pos}${i + 1}`,
    }));
  }

  currentByPositionCache = { byPosition, asOf };
  rankValuesCache = rankValues;

  return {
    currentByPosition: currentByPositionCache,
    rankValues,
  };
}

export function getRankSlotStats(rankValuesMap, tab, rank) {
  return rankValuesMap.get(rankValueKey(tab, rank)) || null;
}

/** Historical average value gap between two rank slots (positional or overall). */
export function getRankPairDelta(rankValuesMap, tab, rankA, rankB) {
  const high = Math.min(rankA, rankB);
  const low = Math.max(rankA, rankB);
  if (high === low) return null;

  const top = rankValuesMap.get(rankValueKey(tab, high));
  const bottom = rankValuesMap.get(rankValueKey(tab, low));
  if (!top || !bottom) return null;

  const prefix = tab === OVERALL_TAB ? 'Overall' : tab;
  return {
    rankHigher: high,
    rankLower: low,
    label: `${prefix}${high}_vs_${prefix}${low}`,
    average_delta: Math.round((top.average_value - bottom.average_value) * 100) / 100,
    day_count: Math.min(top.day_count, bottom.day_count),
  };
}

export { POSITIONS, TABS, OVERALL_TAB };
