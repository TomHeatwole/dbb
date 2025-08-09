import React, { useState } from 'react';

const HoverInfoCell = React.memo(function HoverInfoCell({ value, tooltipContent }) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const hoverTimeout = React.useRef();

  function handleMouseEnter(e) {
    hoverTimeout.current = setTimeout(() => {
      setHovered(true);
    }, 50);
    const rect = e.target.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top });
  }

  function handleMouseLeave() {
    clearTimeout(hoverTimeout.current);
    setHovered(false);
  }

  return (
    <td className="pos-avg-tooltip-relative">
      <div
        className="pos-avg-tooltip-hover-parent"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ display: 'inline-block', width: '100%' }}
      >
        <span className="pos-avg-tooltip-hover-area">
          {value}
        </span>
        {hovered && tooltipContent && (
          <div
            className="pos-avg-tooltip-fixed pos-avg-tooltip-fadein"
            style={{ left: pos.x, top: pos.y - 48 }}
          >
            {tooltipContent}
          </div>
        )}
      </div>
    </td>
  );
});

export default function PositionBreakdownTable({ weeksParsedData, rosterId, startWeek, endWeek, STARTER_POSITION_NAMES, rosters, users, searchParams }) {
  function getTeamName(rid) {
    if (!rosters || !users) return `Team ${rid}`;
    const roster = rosters.find(r => Number(r.roster_id) === Number(rid));
    if (!roster) return `Team ${rid}`;
    const user = users.find(u => String(u.user_id) === String(roster.owner_id));
    if (user && user.metadata && user.metadata.team_name) return user.metadata.team_name;
    if (user && user.display_name) return `Team ${user.display_name}`;
    return `Team ${rid}`;
  }

  return (
    <div className="pos-avg-table-container">
      <h3 className="pos-avg-table-title">Positional Averages</h3>
      <table className="pos-avg-table">
        <thead>
          <tr>
            <th>Position</th>
            <th>Team Avg</th>
            <th>League Avg</th>
            <th>League Ceiling</th>
            <th>League Floor</th>
          </tr>
        </thead>
        <tbody>
          {STARTER_POSITION_NAMES.map((posLabel, posIdx) => {
            let userScores = [];
            // Map: rosterId -> [scores]
            const teamScoresMap = {};
            for (let weekIdx = 0; weekIdx < (endWeek - startWeek + 1); ++weekIdx) {
              const weekNum = startWeek + weekIdx;
              const week = weeksParsedData[weekNum - 1];
              if (!week) continue;
              week.forEach(entry => {
                if (!entry || !entry.starters_points || entry.starters_points[posIdx] == null) return;
                const rid = entry.roster_id;
                if (!teamScoresMap[rid]) teamScoresMap[rid] = [];
                teamScoresMap[rid].push(entry.starters_points[posIdx]);
                if (rid === rosterId) {
                  userScores.push(entry.starters_points[posIdx]);
                }
              });
            }
            // Compute league averages (excluding user)
            const leagueTeamAveragesArr = Object.entries(teamScoresMap)
              .filter(([rid]) => Number(rid) !== rosterId)
              .map(([rid, scores]) => ({
                rosterId: Number(rid),
                avg: scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0
              }));
            // Add the user's team to the array for ceiling/floor calculation
            let allTeamAveragesArr = [...leagueTeamAveragesArr];
            if (userScores.length) {
              allTeamAveragesArr.push({ rosterId: Number(rosterId), avg: userScores.reduce((a, b) => a + b, 0) / userScores.length });
            }
            const leagueAvg = leagueTeamAveragesArr.length ? (leagueTeamAveragesArr.reduce((a, b) => a + b.avg, 0) / leagueTeamAveragesArr.length) : 0;
            let leagueCeiling = 0, leagueCeilingRoster = null;
            let leagueMin = 0, leagueMinRoster = null;
            if (allTeamAveragesArr.length) {
              const maxObj = allTeamAveragesArr.reduce((max, curr) => curr.avg > max.avg ? curr : max, allTeamAveragesArr[0]);
              const minObj = allTeamAveragesArr.reduce((min, curr) => curr.avg < min.avg ? curr : min, allTeamAveragesArr[0]);
              leagueCeiling = maxObj.avg;
              leagueCeilingRoster = maxObj.rosterId;
              leagueMin = minObj.avg;
              leagueMinRoster = minObj.rosterId;
            }
            const userAvg = userScores.length ? (userScores.reduce((a, b) => a + b, 0) / userScores.length) : 0;
            // Calculate delta
            const delta = leagueAvg === 0 ? 0 : ((userAvg - leagueAvg) / leagueAvg) * 100;

            return (
              <tr key={posIdx}>
                <td>{posLabel}</td>
                <HoverInfoCell
                  value={userAvg.toFixed(1)}
                  tooltipContent={
                    <>
                      League Avg: <span>{leagueAvg.toFixed(1)}</span><br />
                      <span className={delta >= 0 ? "pos-avg-tooltip-delta-pos" : "pos-avg-tooltip-delta-neg"}>
                        {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
                      </span>
                    </>
                  }
                />
                <td>{leagueAvg.toFixed(1)}</td>
                <HoverInfoCell
                  value={leagueCeiling.toFixed(1)}
                  tooltipContent={
                    (() => {
                      const roster = rosters && leagueCeilingRoster != null ? rosters.find(r => Number(r.roster_id) === Number(leagueCeilingRoster)) : null;
                      const user = roster && users ? users.find(u => String(u.user_id) === String(roster.owner_id)) : null;
                      return (
                        <>
                          <a
                            href={`/team/${leagueCeilingRoster}${searchParams && searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pos-avg-tooltip-link"
                          >
                            {user && user.avatar_url && (
                              <img src={user.avatar_url} alt={getTeamName(leagueCeilingRoster)} className="owner-avatar pos-avg-tooltip-avatar" />
                            )}
                            <span className="pos-avg-tooltip-team-name">{getTeamName(leagueCeilingRoster)}</span>
                            {posLabel} Avg: {leagueCeiling.toFixed(1)}
                            <br /><br />
                            <span className="pos-avg-tooltip-analytics-link">See Team Analytics &rarr;</span>
                          </a>
                        </>
                      );
                    })()
                  }
                />
                <HoverInfoCell
                  value={leagueMin.toFixed(1)}
                  tooltipContent={
                    (() => {
                      const roster = rosters && leagueMinRoster != null ? rosters.find(r => Number(r.roster_id) === Number(leagueMinRoster)) : null;
                      const user = roster && users ? users.find(u => String(u.user_id) === String(roster.owner_id)) : null;
                      return (
                        <>
                          <a
                            href={`/team/${leagueMinRoster}${searchParams && searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pos-avg-tooltip-link"
                          >
                            {user && user.avatar_url && (
                              <img src={user.avatar_url} alt={getTeamName(leagueMinRoster)} className="owner-avatar pos-avg-tooltip-avatar" />
                            )}
                            <span className="pos-avg-tooltip-team-name">{getTeamName(leagueMinRoster)}</span>
                            {posLabel} Avg: {leagueMin.toFixed(1)}
                            <br /><br />
                            <span className="pos-avg-tooltip-analytics-link">See Team Analytics &rarr;</span>
                          </a>
                        </>
                      );
                    })()
                  }
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
} 