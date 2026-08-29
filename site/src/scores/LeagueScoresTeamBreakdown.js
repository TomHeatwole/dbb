import React from 'react';
import TeamScoresTables from './TeamScoresTables';

export default function LeagueScoresTeamBreakdown({ weekBreakdown, week, rosterId, benchOpen, onToggleBench, benchTotal, playersData, playerIdMap, searchParams, playerGameLabels, isActiveWeek = false, injuriesMap = {}, showCurrentInjury = false, playerHighlightMap = {}, playersTeamMap = {} }) {
  const benchIsProj = Array.isArray(weekBreakdown && weekBreakdown.bench) && weekBreakdown.bench.some((p) => p && p.ptsSource === 'proj');
  return (
    <div className="standings-row-expand-inner">
      <TeamScoresTables weekBreakdown={weekBreakdown} playersData={playersData} playerIdMap={playerIdMap} renderOnly="starters" totalsPlacement="bottom" playerGameLabels={playerGameLabels} isActiveWeek={isActiveWeek} injuriesMap={injuriesMap} showCurrentInjury={showCurrentInjury} playerHighlightMap={playerHighlightMap} playersTeamMap={playersTeamMap} />
      <div style={{ marginTop: '0.5rem' }}>
        <button type="button" onClick={onToggleBench} className="team-scores-bench-toggle">
          <span className={`standings-toggle-icon${benchOpen ? ' standings-toggle-icon--open' : ''}`}>{benchOpen ? '▾' : '▸'}</span>
          {benchOpen ? 'Hide Bench' : 'Show Bench'} ({benchTotal}{benchIsProj ? ' proj' : ' pts'})
        </button>
      </div>
      {benchOpen && (
        <div style={{ marginTop: '0.5rem' }}>
          <TeamScoresTables weekBreakdown={weekBreakdown} playersData={playersData} playerIdMap={playerIdMap} renderOnly="bench" totalsPlacement="bottom" playerGameLabels={playerGameLabels} isActiveWeek={isActiveWeek} injuriesMap={injuriesMap} showCurrentInjury={showCurrentInjury} playerHighlightMap={playerHighlightMap} playersTeamMap={playersTeamMap} />
        </div>
      )}
    </div>
  );
} 