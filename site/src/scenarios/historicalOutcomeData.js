/**
 * historicalOutcomeData.js
 *
 * Builds a catalog of historical player-season outcomes keyed by Hwang ADP rank.
 * Each entry links a player's draft-time ADP to their actual season fantasy points.
 */

import { buildHistoricalPositionRanks } from './historicalRankingsBuilder';
import { loadHwangAdpByYear } from './hwangAdpLoader';

const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const OUTCOME_HISTORY_YEARS = 5;

/**
 * @param {number} currentYear
 * @returns {number[]}
 */
export function getOutcomeHistoryYears(currentYear) {
  const end = Number(currentYear) - 1;
  const start = end - OUTCOME_HISTORY_YEARS + 1;
  const years = [];
  for (let y = start; y <= end; y++) years.push(y);
  return years;
}

/**
 * Load ADP rows + season outcome ranks for the past N years.
 *
 * @param {number} currentYear
 * @param {Object} playersData
 * @returns {Promise<{
 *   years: number[],
 *   catalog: Array<{
 *     sleeperId: string,
 *     seasonYear: number,
 *     position: string,
 *     adpRank: number|null,
 *     effRank: number,
 *     scoringPts: number,
 *     outcomeRank: number,
 *   }>,
 *   catalogByPosition: Object,
 * }>}
 */
export async function loadHistoricalOutcomeCatalog(currentYear, playersData) {
  const years = getOutcomeHistoryYears(currentYear);
  const hwangByYear = await loadHwangAdpByYear();

  const statsResponses = await Promise.all(
    years.map((y) => fetch(`/data/stats_player_reg_${y}.csv`).catch(() => null)),
  );
  const statsTexts = await Promise.all(
    statsResponses.map((r) => (r && r.ok ? r.text().catch(() => null) : null)),
  );

  const outcomeRanksByYear = {};
  for (let i = 0; i < years.length; i++) {
    const csvText = statsTexts[i];
    if (!csvText) {
      outcomeRanksByYear[years[i]] = { QB: [], RB: [], WR: [], TE: [] };
      continue;
    }
    outcomeRanksByYear[years[i]] = buildHistoricalPositionRanks(csvText, playersData);
  }

  const catalog = [];
  const catalogByPosition = { QB: [], RB: [], WR: [], TE: [] };

  for (const year of years) {
    const adpRows = hwangByYear.get(year) || [];
    const posRanks = outcomeRanksByYear[year] || {};

    const outcomeRankLookup = {};
    for (const pos of POSITIONS) {
      outcomeRankLookup[pos] = {};
      (posRanks[pos] || []).forEach((entry, idx) => {
        outcomeRankLookup[pos][entry.sleeperId] = idx + 1;
      });
    }

    const scoringPtsLookup = {};
    for (const pos of POSITIONS) {
      for (const entry of (posRanks[pos] || [])) {
        scoringPtsLookup[entry.sleeperId] = entry.scoringPts;
      }
    }

    for (const row of adpRows) {
      const { position, sleeperId } = row;
      if (!POSITIONS.includes(position) || !sleeperId) continue;

      const scoringPts = scoringPtsLookup[sleeperId];
      if (scoringPts == null || scoringPts <= 0) continue;

      const effRank = row.effRank ?? row.posRank;
      if (effRank == null) continue;

      const entry = {
        sleeperId,
        seasonYear: year,
        position,
        adpRank: row.posRank,
        effRank,
        scoringPts,
        outcomeRank: outcomeRankLookup[position][sleeperId] || null,
      };

      catalog.push(entry);
      catalogByPosition[position].push(entry);
    }
  }

  return { years, catalog, catalogByPosition };
}
