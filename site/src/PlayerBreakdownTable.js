import React, { useMemo } from 'react';
import { getTeamPlayerBreakdown } from './ScoresParser';
import { getPlayerInfo } from './PlayerLookup';

function PlayerBreakdownTable({ weeksParsedData, rosterId, startWeek, endWeek, playersData, playerIdMap, STARTER_POSITION_NAMES }) {
  const breakdown = useMemo(() => {
    return getTeamPlayerBreakdown(weeksParsedData, rosterId, startWeek, endWeek);
  }, [weeksParsedData, rosterId, startWeek, endWeek]);

  const rows = useMemo(() => {
    return Object.values(breakdown)
      .map((d) => {
        const info = getPlayerInfo(d.playerId, playersData, playerIdMap);
        const name = info && info.name ? info.name : d.playerId;
        const position = info && info.position ? info.position : '';
        const totalAppearances = d.starts + d.bench;
        const startRate = totalAppearances > 0 ? (d.starts / totalAppearances) : 0;
        const benchRate = totalAppearances > 0 ? (d.bench / totalAppearances) : 0;
        const avgStarterPts = d.starts > 0 ? (d.starterPointsSum / d.starts) : 0;
        const avgBenchPts = d.bench > 0 ? (d.benchPointsSum / d.bench) : 0;
        const totalPts = d.starterPointsSum + d.benchPointsSum;
        const avgTotalPts = totalAppearances > 0 ? (totalPts / totalAppearances) : 0;
        return {
          playerId: d.playerId,
          name,
          position,
          starts: d.starts,
          bench: d.bench,
          startRate,
          benchRate,
          avgStarterPts,
          avgBenchPts,
          avgTotalPts,
        };
      })
      .sort((a, b) => (b.starts - a.starts) || (b.bench - a.bench));
  }, [breakdown, playersData, playerIdMap]);

  return (
    <div className="pos-avg-table-container">
      <h3 className="pos-avg-table-title">Player Breakdown</h3>
      <div className="pos-avg-table-scroll">
        <table className="pos-avg-table player-breakdown-table player-breakdown-compact">
          <thead>
            <tr>
              <th>Player</th>
              <th className="player-breakdown-number"><div className="th-multiline"><div>Starts</div></div></th>
              <th className="player-breakdown-number"><div className="th-multiline"><div>Bench</div></div></th>
              <th className="player-breakdown-number"><div className="th-multiline"><div>Avg Pts</div></div></th>
              <th className="player-breakdown-number"><div className="th-multiline"><div>Avg Pts</div><div>(Start)</div></div></th>
              <th className="player-breakdown-number"><div className="th-multiline"><div>Avg Pts</div><div>(Bench)</div></div></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.playerId}>
                <td>{row.name}{row.position ? ` (${row.position})` : ''}</td>
                <td className="player-breakdown-number">{row.starts} ({(row.startRate * 100).toFixed(0)}%)</td>
                <td className="player-breakdown-number">{row.bench} ({(row.benchRate * 100).toFixed(0)}%)</td>
                <td className="player-breakdown-number">{row.avgTotalPts.toFixed(1)}</td>
                <td className="player-breakdown-number">{row.avgStarterPts.toFixed(1)}</td>
                <td className="player-breakdown-number">{row.avgBenchPts.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PlayerBreakdownTable; 