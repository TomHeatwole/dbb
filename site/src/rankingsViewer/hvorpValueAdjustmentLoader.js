/**
 * Rankings Viewer loader for HVORP-adjusted value rankings.
 */

import {
  HVORP_VALUE_ADJUSTMENTS,
  applyHvorpValueAdjustment,
  formatHvorpMultiplierSummary,
  loadHvorpPositionMultipliers,
} from '../lookups/HvorpValueAdjustmentLookup';
import {
  assignOverallValueRanks,
  assignPosValueRanks,
} from '../lookups/RedraftValueLookup';

export { HVORP_VALUE_ADJUSTMENTS };

function rerankByValue(rows) {
  assignOverallValueRanks(rows, 'value', 'rank');
  assignPosValueRanks(rows, 'value', 'posRank');
  rows.sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
  return rows;
}

/**
 * @param {'final_ktc' | 'comp_adj_final_ktc'} adjustmentKey
 * @param {number|string} year
 * @param {Function} loadBaseRankings — injected to avoid circular imports
 */
export async function loadHvorpAdjustedRankings(adjustmentKey, year, loadBaseRankings) {
  const cfg = HVORP_VALUE_ADJUSTMENTS[adjustmentKey];
  if (!cfg) throw new Error(`Unknown HVORP value adjustment: ${adjustmentKey}`);

  const [multipliers, base] = await Promise.all([
    loadHvorpPositionMultipliers(adjustmentKey),
    loadBaseRankings(year),
  ]);

  const rows = (base.rows || []).map((row) => {
    const position = (row.position || '').toUpperCase();
    const baseValue = row.value;
    const value = applyHvorpValueAdjustment(baseValue, position, multipliers);
    return {
      ...row,
      value,
      baseValue,
      hvorpMultiplier: multipliers.get(position) ?? 1,
    };
  }).filter((row) => row.value != null && Number.isFinite(row.value));

  rerankByValue(rows);

  return {
    rows,
    meta: {
      ...base.meta,
      sourceLabel: cfg.label,
      adjustmentKey,
      adjustmentSummary: formatHvorpMultiplierSummary(multipliers),
      hvorpBaseline: 'empty_roster_qb_grounded',
      rowCount: rows.length,
    },
  };
}
