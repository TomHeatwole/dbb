/**
 * Tunable position multipliers applied to KTC / Competitor / Rebuild bases.
 *
 * Coefficient numbers live in hwangPositionCoefficients.js — edit there only.
 */

import { normalisePlayerName, findBestPlayerMatch } from '../utils/playerNameMatcher';
import {
  assignPosValueRanks,
  assignOverallValueRanks,
} from './RedraftValueLookup';
import {
  HWANG_COEFFICIENT_LABELS,
  HWANG_COMPOSITE_COEFFICIENT_KEY,
  getHwangCoefficientMap,
} from './hwangPositionCoefficients';

export {
  HWANG_POSITION_COEFFICIENTS,
  HWANG_COEFFICIENT_LABELS,
  HWANG_COMPOSITE_COEFFICIENT_KEY,
  getHwangCoefficientMap,
} from './hwangPositionCoefficients';

export const HWANG_VALUE_ADJUSTMENTS = {
  market: {
    label: HWANG_COEFFICIENT_LABELS.market,
  },
  true: {
    label: HWANG_COEFFICIENT_LABELS.true,
  },
};

/** @type {Map<string, Map<string, number>>} */
const multiplierCache = new Map();

export async function loadHwangPositionMultipliers(adjustmentKey) {
  if (!HWANG_VALUE_ADJUSTMENTS[adjustmentKey]) {
    throw new Error(`Unknown Hwang value adjustment: ${adjustmentKey}`);
  }

  if (multiplierCache.has(adjustmentKey)) return multiplierCache.get(adjustmentKey);

  const multipliers = getHwangCoefficientMap(adjustmentKey);
  if (!multipliers) {
    throw new Error(`Missing Hwang coefficients for: ${adjustmentKey}`);
  }

  multiplierCache.set(adjustmentKey, multipliers);
  return multipliers;
}

/** Sync accessor — same maps as loadHwangPositionMultipliers. */
export function getHwangPositionMultipliers(adjustmentKey) {
  if (multiplierCache.has(adjustmentKey)) return multiplierCache.get(adjustmentKey);
  const multipliers = getHwangCoefficientMap(adjustmentKey);
  if (!multipliers) return null;
  multiplierCache.set(adjustmentKey, multipliers);
  return multipliers;
}

/** Multipliers used for Hwang-Adjusted Competitor / Rebuild. */
export function getHwangCompositeMultipliers() {
  return getHwangPositionMultipliers(HWANG_COMPOSITE_COEFFICIENT_KEY);
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
  return buildHwangAdjustedFromEntries(
    Array.from(ktcMap.values()),
    multipliers,
    (entry) => getStitchedKtcTepSfValue(entry),
    { teamKey: 'nflTeam' },
  );
}

/**
 * Apply Hwang position multipliers to an arbitrary list of valued entries,
 * then assign overall / positional ranks.
 *
 * @param {object[]} entries
 * @param {Map<string, number>} multipliers
 * @param {(entry: object) => number|null|undefined} getBaseValue
 * @param {{ teamKey?: string }} [opts]
 */
export function buildHwangAdjustedFromEntries(entries, multipliers, getBaseValue, opts = {}) {
  const teamKey = opts.teamKey || 'nflTeam';
  const rows = [];

  for (const entry of entries || []) {
    const baseValue = getBaseValue(entry);
    if (baseValue == null || !Number.isFinite(baseValue) || baseValue <= 0) continue;

    const value = applyHwangKtcAdjustment(baseValue, entry.position, multipliers);
    if (value == null) continue;

    const name = entry.name;
    if (!name) continue;

    rows.push({
      name,
      normName: normalisePlayerName(name),
      position: entry.position,
      nflTeam: entry[teamKey] || entry.nflTeam || entry.team || '',
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
