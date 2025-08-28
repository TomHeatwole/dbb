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
        const slotCounts = Array.isArray(d.startedPositionsCounts) ? d.startedPositionsCounts : [];
        return {
          playerId: d.playerId,
          name,
          position,
          starts: d.starts,
          bench: d.bench,
          startRate,
          benchRate,
          slotCounts,
          avgStarterPts,
          avgBenchPts,
        };
      })
      .sort((a, b) => (b.starts - a.starts) || (b.bench - a.bench));
  }, [breakdown, playersData, playerIdMap]);

  return (
    <div className="pos-avg-table-container">
      <h3 className="pos-avg-table-title">Player Breakdown</h3>
      <div className="pos-avg-table-scroll">
        <table className="pos-avg-table pos-avg-table-min">
          <thead>
            <tr>
              <th>Player</th>
              <th>Starts</th>
              <th>Bench</th>
              <th>Start %</th>
              <th>Bench %</th>
              {STARTER_POSITION_NAMES && STARTER_POSITION_NAMES.map((label, idx) => (
                <th key={idx}>{label}</th>
              ))}
              <th>Avg Pts (Start)</th>
              <th>Avg Pts (Bench)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.playerId}>
                <td>{row.name}{row.position ? ` (${row.position})` : ''}</td>
                <td>{row.starts}</td>
                <td>{row.bench}</td>
                <td>{(row.startRate * 100).toFixed(0)}%</td>
                <td>{(row.benchRate * 100).toFixed(0)}%</td>
                {STARTER_POSITION_NAMES && STARTER_POSITION_NAMES.map((_, idx) => (
                  <td key={`${row.playerId}-${idx}`}>{row.slotCounts[idx] || 0}</td>
                ))}
                <td>{row.avgStarterPts.toFixed(1)}</td>
                <td>{row.avgBenchPts.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PlayerBreakdownTable; 