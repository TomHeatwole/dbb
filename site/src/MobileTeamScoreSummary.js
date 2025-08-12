import React from 'react';
import { Link } from 'react-router-dom';

export default function MobileTeamScoreSummary({ weekBreakdown, week, rosterId, searchParams }) {
  if (!weekBreakdown) {
    return null;
  }
  const startersTotal = weekBreakdown ? weekBreakdown.starterTotal : 0;
  const benchTotal = weekBreakdown ? weekBreakdown.benchTotal : 0;
  const qs = searchParams && searchParams.toString() ? `?${searchParams.toString()}` : '';
  return (
    <div className="standings-row-expand-inner standings-stats-grid">
      <div className="stat-label">Starters:</div>
      <div className="stat-v1">{startersTotal} pts</div>
      <div className="stat-v2"></div>
      <div className="stat-v3"></div>

      <div className="stat-label">Bench:</div>
      <div className="stat-v1">{benchTotal} pts</div>
      <div className="stat-v2"></div>
      <div className="stat-v3"></div>

      <div className="standings-team-link">
        <Link to={`/team/${rosterId}${qs}`}>See Week {week} Breakdown</Link>
      </div>
    </div>
  );
} 