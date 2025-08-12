import React from 'react';
import { Link } from 'react-router-dom';
import TeamScoresTables from './TeamScoresTables';

export default function LeagueScoresTeamBreakdown({ weekBreakdown, week, rosterId, benchOpen, onToggleBench, benchTotal, playersData, playerIdMap, searchParams }) {
  const qs = searchParams && searchParams.toString() ? `?${searchParams.toString()}` : '';
  return (
    <div className="standings-row-expand-inner">
      <TeamScoresTables weekBreakdown={weekBreakdown} playersData={playersData} playerIdMap={playerIdMap} renderOnly="starters" />
      <div style={{ marginTop: '0.5rem' }}>
        <button type="button" onClick={onToggleBench} className="team-scores-bench-toggle">
          <span className={`standings-toggle-icon${benchOpen ? ' standings-toggle-icon--open' : ''}`}>{benchOpen ? '▾' : '▸'}</span>
          {benchOpen ? 'Hide Bench' : 'Show Bench'} ({benchTotal} pts)
        </button>
      </div>
      {benchOpen && (
        <div style={{ marginTop: '0.5rem' }}>
          <TeamScoresTables weekBreakdown={weekBreakdown} playersData={playersData} playerIdMap={playerIdMap} renderOnly="bench" />
        </div>
      )}
    </div>
  );
} 