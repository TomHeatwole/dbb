import React, { useMemo } from 'react';
import HeadToHeadSelectorWeb from './HeadToHeadSelectorWeb';
import MatchupView from './MatchupView';
import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';

function buildSeedMap(teams) {
  const map = {};
  (teams || []).forEach((t) => {
    if (!t || t.rosterId == null) {
      return;
    }
    const key = String(t.rosterId);
    if (t.seed != null) {
      map[key] = t.seed;
    } else if (t.displaySeed != null) {
      map[key] = t.displaySeed;
    }
  });
  return map;
}

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

function HeadToHeadView({
  season,
  loading,
  error,
  teams,
  selectedIds,
  onSelectionChange,
  weeks = null,
  preloadedTeamData = null,
  preloadedWeeksData = null,
  preloadedPlayersData = null,
  preloadedPlayerIdMap = null,
  usePlayoffTheme = true,
  displaySeeds = false,
  expandedWeeksOverride = null,
  showMatchup = true,
  controls = null,
  highlightMode = 'default',
  highlightThreshold = null
}) {
  const safeSelected = normalizeSelectedIds(selectedIds);
  const [team1Id, team2Id] = useMemo(() => {
    const a = safeSelected[0] != null ? Number(safeSelected[0]) : null;
    const b = safeSelected[1] != null ? Number(safeSelected[1]) : null;
    const safeA = Number.isFinite(a) ? a : null;
    const safeB = Number.isFinite(b) ? b : null;
    return [safeA, safeB];
  }, [safeSelected]);

  const isCurrentSeason = String(season) === String(CURRENT_YEAR);
  const defaultWeeks = useMemo(() => {
    if (Array.isArray(weeks) && weeks.length > 0) {
      return weeks;
    }
    const current = getCurrentNFLWeek();
    const last = isCurrentSeason ? current : 17;
    if (!last || !Number.isFinite(last) || last < 1) {
      return [];
    }
    const capped = isCurrentSeason ? Math.min(17, last) : 17;
    return Array.from({ length: capped }, (_, idx) => idx + 1);
  }, [weeks, isCurrentSeason]);

  const seedByRosterId = useMemo(() => buildSeedMap(teams), [teams]);
  const seed1 = team1Id != null ? (seedByRosterId[String(team1Id)] || null) : null;
  const seed2 = team2Id != null ? (seedByRosterId[String(team2Id)] || null) : null;

  const handleSelectionChange = (next) => {
    if (onSelectionChange) {
      onSelectionChange(normalizeSelectedIds(next));
    }
  };

  return (
    <div className="yoffs-head-to-head-container">
      {loading && (
        <div className="loading-center">
          <div className="spinner" aria-label="Loading" />
          <div className="loading-text">Loading teams…</div>
        </div>
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
            usePlayoffTheme={usePlayoffTheme}
          />
          {controls}
        </>
      )}
      {showMatchup &&
        !loading &&
        !error &&
        preloadedWeeksData &&
        preloadedPlayersData &&
        preloadedPlayerIdMap &&
        preloadedTeamData && (
          <div className="yoffs-matchup-view-container">
            <MatchupView
              season={season}
              team1Id={team1Id}
              team2Id={team2Id}
              week={null}
              weeks={defaultWeeks}
              expandedWeeksOverride={expandedWeeksOverride}
              preloadedTeamData={preloadedTeamData}
              preloadedWeeksData={preloadedWeeksData}
              preloadedPlayersData={preloadedPlayersData}
              preloadedPlayerIdMap={preloadedPlayerIdMap}
              displaySeeds={displaySeeds}
              seed1={seed1}
              seed2={seed2}
              highlightMode={highlightMode}
              highlightThreshold={highlightThreshold}
            />
          </div>
        )}
    </div>
  );
}

export default HeadToHeadView;


