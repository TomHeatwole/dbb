/**
 * Rankings Viewer loader for Hwang-adjusted KTC values.
 */

import {
  HWANG_VALUE_ADJUSTMENTS,
  loadHwangPositionMultipliers,
  applyHwangKtcAdjustment,
  formatMultiplierSummary,
  hwangMultiplierAt,
} from '../lookups/HwangValueAdjustmentLookup';
import { assignPosValueRanks, assignOverallValueRanks } from '../lookups/RedraftValueLookup';

export { HWANG_VALUE_ADJUSTMENTS };

function assignRanks(rows) {
  assignOverallValueRanks(rows, 'value', 'rank');
  return rows;
}

function computePosRanks(rows) {
  assignPosValueRanks(rows, 'value', 'posRank');
  return rows;
}

/**
 * Load KTC SF TE+ values with position multipliers from hwangPositionCoefficients.js.
 *
 * @param {'market' | 'true'} adjustmentKey
 */
export async function loadHwangAdjustedKtcRankings(adjustmentKey) {
  const cfg = HWANG_VALUE_ADJUSTMENTS[adjustmentKey];
  if (!cfg) throw new Error(`Unknown Hwang value adjustment: ${adjustmentKey}`);

  const [multipliers, ktcRes] = await Promise.all([
    loadHwangPositionMultipliers(adjustmentKey),
    fetch('/data/ktc_values.csv'),
  ]);
  if (!ktcRes.ok) throw new Error('Failed to fetch ktc_values.csv');

  const text = await ktcRes.text();
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const idx = (name) => headers.indexOf(name);
  const asOfIdx = idx('as_of');

  let asOf = null;
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const name = (cols[idx('name')] || '').trim();
    const position = (cols[idx('position')] || '').trim();
    if (!name || !position) continue;
    if (!asOf && asOfIdx >= 0) asOf = (cols[asOfIdx] || '').trim();

    const pos = position.toUpperCase();
    const baseValueKey = pos === 'TE' ? 'ktc_value_tep_2qb' : 'ktc_value_2qb';
    const ktcValue = parseInt(cols[idx(baseValueKey)], 10);
    if (!Number.isFinite(ktcValue)) continue;

    const value = applyHwangKtcAdjustment(ktcValue, position, multipliers);

    rows.push({
      name,
      position,
      team: (cols[idx('team')] || '').trim(),
      value,
      ktcValue,
      multiplier: Math.round(hwangMultiplierAt(multipliers.get(pos), ktcValue) * 1000) / 1000,
      rank: null,
      posRank: null,
      sleeperId: '',
    });
  }

  assignRanks(rows);
  computePosRanks(rows);
  rows.sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

  return {
    rows,
    meta: {
      asOf,
      sourceLabel: cfg.label,
      adjustmentKey,
      adjustmentSummary: formatMultiplierSummary(multipliers),
      rowCount: rows.length,
      stitched: true,
    },
  };
}
