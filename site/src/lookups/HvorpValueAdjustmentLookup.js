/**
 * QB-grounded HVORP position multipliers (empty roster baseline).
 * CSVs built by compute_pos_value_compare.js from positional value compare data.
 */

export const HVORP_VALUE_ADJUSTMENTS = {
  final_ktc: {
    id: 'hvorp_values_empty_roster_final_ktc',
    label: 'HVORP Values — Empty Roster Final KTC',
    multipliersCsv: '/data/hvorp_values_empty_roster_final_ktc_multipliers.csv',
    baseKind: 'final_ktc_values',
  },
  comp_adj_final_ktc: {
    id: 'hvorp_values_empty_roster_competitor_adjusted_final_ktc',
    label: 'HVORP Values — Empty Roster Competitor Adjusted Final KTC',
    multipliersCsv: '/data/hvorp_values_empty_roster_competitor_adjusted_final_ktc_multipliers.csv',
    baseKind: 'final_ktc_redraft_adjusted',
  },
};

/** @type {Map<string, Map<string, number>>} */
const multiplierCache = new Map();

export async function loadHvorpPositionMultipliers(adjustmentKey) {
  const cfg = HVORP_VALUE_ADJUSTMENTS[adjustmentKey];
  if (!cfg) throw new Error(`Unknown HVORP value adjustment: ${adjustmentKey}`);

  if (multiplierCache.has(cfg.multipliersCsv)) {
    return multiplierCache.get(cfg.multipliersCsv);
  }

  const res = await fetch(cfg.multipliersCsv);
  if (!res.ok) throw new Error(`Failed to fetch ${cfg.multipliersCsv}`);
  const text = await res.text();

  const lines = text.trim().split('\n');
  if (lines.length < 2) {
    const empty = new Map();
    multiplierCache.set(cfg.multipliersCsv, empty);
    return empty;
  }

  const headers = lines[0].split(',').map((h) => h.trim());
  const posIdx = headers.indexOf('position');
  const multIdx = headers.indexOf('multiplier');
  if (posIdx === -1 || multIdx === -1) {
    throw new Error(`Invalid HVORP multiplier CSV (need position,multiplier): ${cfg.multipliersCsv}`);
  }

  const multipliers = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const position = (cols[posIdx] || '').trim().toUpperCase();
    const multiplier = parseFloat((cols[multIdx] || '').trim());
    if (!position || !Number.isFinite(multiplier)) continue;
    multipliers.set(position, multiplier);
  }

  multiplierCache.set(cfg.multipliersCsv, multipliers);
  return multipliers;
}

export function applyHvorpValueAdjustment(baseValue, position, multipliers) {
  if (baseValue == null || !Number.isFinite(baseValue)) return null;
  const pos = (position || '').toUpperCase();
  const multiplier = multipliers?.get(pos) ?? 1;
  return Math.round(baseValue * multiplier);
}

export function formatHvorpMultiplierSummary(multipliers) {
  return ['QB', 'RB', 'WR', 'TE']
    .filter((pos) => multipliers?.has(pos))
    .map((pos) => `${pos}×${multipliers.get(pos)}`)
    .join(', ');
}

export function getHvorpAdjustmentBySourceId(sourceId) {
  return Object.values(HVORP_VALUE_ADJUSTMENTS).find((cfg) => cfg.id === sourceId) || null;
}
