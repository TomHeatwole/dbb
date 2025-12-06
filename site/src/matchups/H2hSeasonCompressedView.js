import React, { useMemo } from 'react';
import MatchupView from './MatchupView';
import { getWeekScoreBreakdown } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';

function computeWeeklyTotals(weeksParsedData, playersData, playerIdMap, teamId) {
  if (!Array.isArray(weeksParsedData) || !playersData || !playerIdMap || teamId == null) {
    return {};
  }
  const totals = {};
  for (let w = 1; w <= weeksParsedData.length; w += 1) {
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

function sumRange(totalsByWeek, startW, endW) {
  if (!totalsByWeek || startW > endW) {
    return 0;
  }
  let sum = 0;
  for (let w = startW; w <= endW; w += 1) {
    if (typeof totalsByWeek[w] === 'number' && Number.isFinite(totalsByWeek[w])) {
      sum += totalsByWeek[w];
    }
  }
  return sum;
}

function H2hSeasonCompressedView({
  season,
  weeksParsedData,
  playersData,
  playerIdMap,
  team1Id,
  team2Id,
  preloadedTeamData,
}) {
  const maxWeekWithData = useMemo(() => {
    if (!Array.isArray(weeksParsedData)) {
      return 0;
    }
    let max = 0;
    weeksParsedData.forEach((weekArr, idx) => {
      if (Array.isArray(weekArr) && weekArr.length > 0) {
        max = Math.max(max, idx + 1);
      }
    });
    return max;
  }, [weeksParsedData]);

  const effectiveN = useMemo(() => {
    if (maxWeekWithData <= 0) {
      return 1;
    }
    if (String(season) !== String(CURRENT_YEAR)) {
      return 17;
    }
    const wk = getCurrentNFLWeek();
    if (!Number.isFinite(wk) || wk < 1) {
      return 1;
    }
    if (maxWeekWithData >= 17) {
      return 17;
    }
    return Math.min(wk, maxWeekWithData);
  }, [season, maxWeekWithData]);

  const weekTotals1 = useMemo(
    () => computeWeeklyTotals(weeksParsedData, playersData, playerIdMap, team1Id),
    [weeksParsedData, playersData, playerIdMap, team1Id]
  );
  const weekTotals2 = useMemo(
    () => computeWeeklyTotals(weeksParsedData, playersData, playerIdMap, team2Id),
    [weeksParsedData, playersData, playerIdMap, team2Id]
  );

  const hasBufferRow = effectiveN > 1;
  const bufferStart = 1;
  const bufferEnd = hasBufferRow ? (effectiveN - 1) : 0;
  const bufferLabel =
    hasBufferRow && bufferEnd >= bufferStart
      ? `Weeks ${bufferStart}–${bufferEnd}`
      : null;

  const bufferTotal1 = hasBufferRow ? sumRange(weekTotals1, bufferStart, bufferEnd) : 0;
  const bufferTotal2 = hasBufferRow ? sumRange(weekTotals2, bufferStart, bufferEnd) : 0;

  const singleWeek = effectiveN;

  const bufferLeftText =
    hasBufferRow ? `${Number(bufferTotal1 || 0).toFixed(1)} pts` : null;
  const bufferRightText =
    hasBufferRow ? `${Number(bufferTotal2 || 0).toFixed(1)} pts` : null;

  return (
    <div className="h2h-season-compressed-root">
      <MatchupView
        season={season}
        team1Id={team1Id}
        team2Id={team2Id}
        week={null}
        weeks={[singleWeek]}
        expandedWeeksOverride={[singleWeek]}
        preloadedTeamData={preloadedTeamData}
        preloadedWeeksData={weeksParsedData}
        preloadedPlayersData={playersData}
        preloadedPlayerIdMap={playerIdMap}
        displaySeeds={false}
        playoffBufferAmount={0}
        playoffBufferSide={null}
        bufferLabel={bufferLabel}
        bufferLeftText={bufferLeftText}
        bufferRightText={bufferRightText}
      />
    </div>
  );
}

export default H2hSeasonCompressedView;


