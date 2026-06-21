/**
 * Tunable position multipliers applied to stitched KTC SF TE+ values.
 */

import { normalisePlayerName, findBestPlayerMatch } from '../utils/playerNameMatcher';
import {
  assignPosValueRanks,
  assignOverallValueRanks,
} from './RedraftValueLookup';

export const HWANG_VALUE_ADJUSTMENTS = {
  market: {
    label: 'Hwang Market Value Adjusted KTC',
    csv: '/data/hwang_market_value_adjustment.csv',
  },
  true: {
    label: 'Hwang True Value Adjusted KTC',
    csv: '/data/hwang_true_value_adjustment.csv',
  },
};

/** @type {Map<string, Map<string, number>>} */
const multiplierCache = new Map();

export async function loadHwangPositionMultipliers(adjustmentKey) {
  const cfg = HWANG_VALUE_ADJUSTMENTS[adjustmentKey];
  if (!cfg) throw new Error(`Unknown Hwang value adjustment: ${adjustmentKey}`);

  if (multiplierCache.has(cfg.csv)) return multiplierCache.get(cfg.csv);

  const res = await fetch(cfg.csv);
  if (!res.ok) throw new Error(`Failed to fetch ${cfg.csv}`);
  const text = await res.text();

  const lines = text.trim().split('\n');
  if (lines.length < 2) {
    const empty = new Map();
    multiplierCache.set(cfg.csv, empty);
    return empty;
  }

  const headers = lines[0].split(',').map((h) => h.trim());
  const posIdx = headers.indexOf('position');
  const multIdx = headers.indexOf('multiplier');
  if (posIdx === -1 || multIdx === -1) {
    throw new Error(`Invalid adjustment CSV (need position,multiplier): ${cfg.csv}`);
  }

  const multipliers = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const position = (cols[posIdx] || '').trim().toUpperCase();
    const multiplier = parseFloat((cols[multIdx] || '').trim());
    if (!position || !Number.isFinite(multiplier)) continue;
    multipliers.set(position, multiplier);
  }

  multiplierCache.set(cfg.csv, multipliers);
  return multipliers;
}

/** Stitched SF TE+ baseline: TE uses TE+ column, other positions use SF 2QB. */
export function getStitchedKtcTepSfValue(entry) {
  if (!entry) return null;
  const pos = (entry.position || '').toUpperCase();
  const value = pos === 'TE' ? entry.ktcValue_tep : entry.ktcValue_sf;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function applyHwangKtcAdjustment(baseValue, position, multipliers) {
  if (baseValue == null || !Number.isFinite(baseValue)) return null;
  const pos = (position || '').toUpperCase();
  const multiplier = multipliers?.get(pos) ?? 1;
  return Math.round(baseValue * multiplier);
}

export function lookupKtcMapEntry(playerName, ktcMap, hints = {}) {
  if (!ktcMap || !playerName) return null;

  const raw = ktcMap.get(normalisePlayerName(playerName));
  if (raw) return raw;

  const { candidate } = findBestPlayerMatch(
    playerName,
    Array.from(ktcMap.values()),
    hints,
    { team: 'nflTeam' },
  );
  return candidate || null;
}

/**
 * Build a name-keyed lookup of adjusted values + ranks from the KTC map.
 * Returns { byName: Map<normName, entry>, rows }.
 */
export function buildHwangAdjustedLookup(ktcMap, multipliers) {
  const rows = [];

  for (const entry of ktcMap.values()) {
    const baseValue = getStitchedKtcTepSfValue(entry);
    if (baseValue == null) continue;

    const value = applyHwangKtcAdjustment(baseValue, entry.position, multipliers);
    if (value == null) continue;

    rows.push({
      name: entry.name,
      normName: normalisePlayerName(entry.name),
      position: entry.position,
      nflTeam: entry.nflTeam,
      ktcValue: baseValue,
      value,
      overallRank: null,
      posRank: null,
    });
  }

  assignPosValueRanks(rows, 'value', 'posRank');
  assignOverallValueRanks(rows, 'value', 'overallRank');

  const byName = new Map();
  for (const row of rows) {
    byName.set(row.normName, row);
  }

  return { byName, rows };
}

export function getHwangAdjustedEntryByName(playerName, byName, hints = {}) {
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

export function formatMultiplierSummary(multipliers) {
  return ['QB', 'RB', 'WR', 'TE']
    .filter((pos) => multipliers?.has(pos))
    .map((pos) => `${pos}×${multipliers.get(pos)}`)
    .join(' · ');
}
