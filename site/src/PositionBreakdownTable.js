import React, { useState } from 'react';

const HoverInfoCell = React.memo(function HoverInfoCell({ value, tooltipContent }) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  return (
    <td
      onMouseEnter={e => {
        setHovered(true);
        const rect = e.target.getBoundingClientRect();
        setPos({ x: rect.left + rect.width / 2, y: rect.top });
      }}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative' }}
    >
      {value}
      {hovered && tooltipContent && (
        <div
          className="pos-avg-tooltip"
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y - 48,
            zIndex: 1000,
            background: '#fff',
            color: '#183661',
            border: '1px solid #eee',
            borderRadius: 8,
            padding: '10px 16px',
            fontWeight: 600,
            fontSize: 16,
            boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
            minWidth: 120,
            textAlign: 'center',
          }}
        >
          {tooltipContent}
        </div>
      )}
    </td>
  );
});

export default function PositionBreakdownTable({ weeksParsedData, rosterId, startWeek, endWeek, STARTER_POSITION_NAMES, rosters, users }) {
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
            <th>League Minimum</th>
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
            const leagueAvg = leagueTeamAveragesArr.length ? (leagueTeamAveragesArr.reduce((a, b) => a + b.avg, 0) / leagueTeamAveragesArr.length) : 0;
            let leagueCeiling = 0, leagueCeilingRoster = null;
            let leagueMin = 0, leagueMinRoster = null;
            if (leagueTeamAveragesArr.length) {
              const maxObj = leagueTeamAveragesArr.reduce((max, curr) => curr.avg > max.avg ? curr : max, leagueTeamAveragesArr[0]);
              const minObj = leagueTeamAveragesArr.reduce((min, curr) => curr.avg < min.avg ? curr : min, leagueTeamAveragesArr[0]);
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
                      <span style={{ color: delta >= 0 ? '#1a7f37' : '#c0392b' }}>
                        {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
                      </span>
                    </>
                  }
                />
                <td>{leagueAvg.toFixed(1)}</td>
                <HoverInfoCell
                  value={leagueCeiling.toFixed(1)}
                  tooltipContent={
                    <>
                      {getTeamName(leagueCeilingRoster)}<br />
                      {posLabel} Avg: {leagueCeiling.toFixed(1)}
                    </>
                  }
                />
                <HoverInfoCell
                  value={leagueMin.toFixed(1)}
                  tooltipContent={
                    <>
                      {getTeamName(leagueMinRoster)}<br />
                      {posLabel} Avg: {leagueMin.toFixed(1)}
                    </>
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