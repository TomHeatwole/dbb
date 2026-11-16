import { getWeekScoreBreakdown } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';

export { resolveMatchupWinProbWeek, sumRange } from './matchupWinProbWeek';

export function computeWeeklyTotals(weeksParsedData, playersData, playerIdMap, teamId, weeksRange) {
  if (!Array.isArray(weeksParsedData) || !playersData || !playerIdMap || teamId == null) {
    return {};
  }
  const totals = {};
  const weeksToUse = Array.isArray(weeksRange) && weeksRange.length > 0
    ? weeksRange
    : weeksParsedData.map((_, idx) => idx + 1);
  for (const w of weeksToUse) {
    const breakdown = getWeekScoreBreakdown(weeksParsedData, w) || {};
    const raw = breakdown[teamId];
    if (!raw) {
      continue;
    }
    try {
      const computed = StartSitSort(raw, playersData, playerIdMap, null, null, null);
      if (computed && typeof computed.starterTotal === 'number') {
        totals[w] = Number(computed.starterTotal);
      }
    } catch (_) {
      // ignore failures, treat as missing
    }
  }
  return totals;
}
