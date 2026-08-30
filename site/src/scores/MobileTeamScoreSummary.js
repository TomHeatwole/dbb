import React from 'react';
import { Link } from 'react-router-dom';
import ScoreSplit, { starterScoreSplit, benchScoreSplit } from './ScoreSplit';

export default function MobileTeamScoreSummary({ weekBreakdown, week, rosterId, searchParams, isActiveWeek = false, activeCount = 0, yetToPlayCount = 0 }) {
  if (!weekBreakdown) {
    return null;
  }
  const starterSplit = starterScoreSplit(weekBreakdown);
  const benchSplit = benchScoreSplit(weekBreakdown);
  const qs = searchParams && searchParams.toString() ? `?${searchParams.toString()}` : '';
  return (
    <div className="standings-row-expand-inner standings-stats-grid">
      <div className="stat-label">Starters:</div>
      <div className="stat-v1">
        <ScoreSplit {...starterSplit} layout="inline" />
      </div>
      <div className="stat-v2"></div>
      <div className="stat-v3"></div>

      <div className="stat-label">Bench:</div>
      <div className="stat-v1">
        <ScoreSplit {...benchSplit} layout="inline" />
      </div>
      <div className="stat-v2"></div>
      <div className="stat-v3"></div>

      {isActiveWeek ? (<>
        <div className="stat-label">Yet to Play:</div>
        <div className="stat-v1">{yetToPlayCount}</div>
        <div className="stat-v2"></div>
        <div className="stat-v3"></div>

        <div className="stat-label">In-Play:</div>
        <div className="stat-v1">{activeCount}</div>
        <div className="stat-v2"></div>
        <div className="stat-v3"></div>
      </>) : null}

      <div className="standings-team-link">
        <Link to={`/team/${rosterId}${qs}`}>See Week {week} Breakdown</Link>
      </div>
    </div>
  );
} 