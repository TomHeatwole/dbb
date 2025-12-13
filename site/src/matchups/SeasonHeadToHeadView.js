import React, { useMemo } from 'react';
import HeadToHeadSelectorWeb from './HeadToHeadSelectorWeb';
import MatchupView from './MatchupView';
import { getWeekScoreBreakdown } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import LoadingState from '../LoadingState';

function normalizeSelectedIds(selectedIds) {
  if (!Array.isArray(selectedIds)) {
    return [null, null];
  }
  const out = selectedIds.slice(0, 2);
  while (out.length < 2) {
    out.push(null);
  }
  return out;
}

function computeWeeklyTotals(weeksParsedData, playersData, playerIdMap, teamId, weeksRange) {
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

/**
 * SeasonHeadToHeadView
 *
 * Shared H2H shell for:
 * - Season (Expanded): multi-week MatchupView over weeks 1..N
 * - Season: single-week MatchupView for week N with a buffer row summarizing 1..N-1
 *
 * This keeps the HeadToHeadSelector and layout identical between the two modes.
 */
function SeasonHeadToHeadView({
  season,
  loading,
  error,
  teams,
  selectedIds,
  onSelectionChange,
  allWeeks,
  weeksParsedData,
  playersData,
  playerIdMap,
  preloadedTeamData,
  mode, // 'season' | 'expanded'
  highlightThreshold = null,
  selectedWeek = null,
  controls = null,
  enableMobileSelectorCollapse = false
}) {
  const safeSelected = normalizeSelectedIds(selectedIds);
  const [team1Id, team2Id] = useMemo(() => {
    const a = safeSelected[0] != null ? Number(safeSelected[0]) : null;
    const b = safeSelected[1] != null ? Number(safeSelected[1]) : null;
    const safeA = Number.isFinite(a) ? a : null;
    const safeB = Number.isFinite(b) ? b : null;
    return [safeA, safeB];
  }, [safeSelected]);

  const effectiveWeeks = useMemo(() => {
    if (Array.isArray(allWeeks) && allWeeks.length > 0) {
      return allWeeks;
    }
    if (!Array.isArray(weeksParsedData)) {
      return [];
    }
    const max = weeksParsedData.reduce((m, wk, idx) => {
      if (Array.isArray(wk) && wk.length > 0) {
        return Math.max(m, idx + 1);
      }
      return m;
    }, 0);
    if (max <= 0) {
      return [1];
    }
    return Array.from({ length: max }, (_, idx) => idx + 1);
  }, [allWeeks, weeksParsedData]);

  const lastAvailableWeek = effectiveWeeks.length > 0
    ? effectiveWeeks[effectiveWeeks.length - 1]
    : 1;

  const weekN = useMemo(() => {
    if (!effectiveWeeks.length) {
      return 1;
    }
    const minW = effectiveWeeks[0];
    const maxW = lastAvailableWeek;
    const nRaw = typeof selectedWeek === 'number' && Number.isFinite(selectedWeek)
      ? selectedWeek
      : maxW;
    return Math.min(maxW, Math.max(minW, nRaw));
  }, [effectiveWeeks, lastAvailableWeek, selectedWeek]);

  const weekTotals1 = useMemo(
    () => computeWeeklyTotals(weeksParsedData, playersData, playerIdMap, team1Id, effectiveWeeks),
    [weeksParsedData, playersData, playerIdMap, team1Id, effectiveWeeks]
  );
  const weekTotals2 = useMemo(
    () => computeWeeklyTotals(weeksParsedData, playersData, playerIdMap, team2Id, effectiveWeeks),
    [weeksParsedData, playersData, playerIdMap, team2Id, effectiveWeeks]
  );

  const hasBuffer = mode === 'season' && weekN > 1;
  const bufferStart = 1;
  const bufferEnd = hasBuffer ? (weekN - 1) : 0;
  const bufferLabel =
    hasBuffer && bufferEnd >= bufferStart
      ? (bufferEnd === bufferStart
          ? `Week ${bufferEnd}`
          : `Weeks ${bufferStart}–${bufferEnd}`)
      : null;

  const bufferTotal1 = hasBuffer
    ? sumRange(weekTotals1, bufferStart, bufferEnd)
    : 0;
  const bufferTotal2 = hasBuffer
    ? sumRange(weekTotals2, bufferStart, bufferEnd)
    : 0;

  const bufferLeftText =
    hasBuffer ? `${Number(bufferTotal1 || 0).toFixed(1)} pts` : null;
  const bufferRightText =
    hasBuffer ? `${Number(bufferTotal2 || 0).toFixed(1)} pts` : null;

  const matchupWeeks =
    mode === 'season'
      ? [weekN]
      : effectiveWeeks;

  const expandedWeeksOverride =
    mode === 'season'
      ? [weekN]
      : null;

  const seasonTotal1 = sumRange(weekTotals1, 1, weekN);
  const seasonTotal2 = sumRange(weekTotals2, 1, weekN);
  const headerLeftOverride =
    mode === 'season' ? seasonTotal1.toFixed(1) : null;
  const headerRightOverride =
    mode === 'season' ? seasonTotal2.toFixed(1) : null;

  const handleSelectionChange = (next) => {
    if (onSelectionChange) {
      onSelectionChange(normalizeSelectedIds(next));
    }
  };

  return (
    <div className="yoffs-head-to-head-container">
      {loading && (
        <LoadingState label="Loading teams…" />
      )}
      {!loading && error && <div>{error}</div>}
      {!loading && !error && (!teams || teams.length === 0) && (
        <div>No teams found for this season.</div>
      )}
      {!loading && !error && teams && teams.length > 0 && (
        <>
          <HeadToHeadSelectorWeb
            teams={teams}
            initialSelection={safeSelected}
            onSelectionChange={handleSelectionChange}
            usePlayoffTheme={false}
            enableMobileSelectorCollapse={enableMobileSelectorCollapse}
          />
          {controls}
        </>
      )}
      {!loading &&
        !error &&
        preloadedTeamData &&
        weeksParsedData &&
        playersData &&
        playerIdMap && (
          <div className="yoffs-matchup-view-container season-h2h-matchup-wrapper">
            <div className="season-h2h-matchup-height-shell">
              <MatchupView
                season={season}
                team1Id={team1Id}
                team2Id={team2Id}
                week={null}
                weeks={matchupWeeks}
                expandedWeeksOverride={expandedWeeksOverride}
                preloadedTeamData={preloadedTeamData}
                preloadedWeeksData={weeksParsedData}
                preloadedPlayersData={playersData}
                preloadedPlayerIdMap={playerIdMap}
                displaySeeds={false}
                bufferLabel={bufferLabel}
                bufferLeftText={bufferLeftText}
                bufferRightText={bufferRightText}
                headerLeftOverride={headerLeftOverride}
                headerRightOverride={headerRightOverride}
                highlightMode="seasonFinalOnly"
                highlightThreshold={highlightThreshold}
              />
            </div>
          </div>
        )}
    </div>
  );
}

export default SeasonHeadToHeadView;


