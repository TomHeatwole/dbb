import React, { useMemo, useState } from 'react';
import { getTeamPlayerBreakdown } from '../scores/ScoresParser';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import useIsMobile from '../hooks/useIsMobile';
import PositionBadge from '../PositionBadge';

function PlayerBreakdownTable({ weeksParsedData, rosterId, startWeek, endWeek, playersData, playerIdMap, STARTER_POSITION_NAMES, rosterPlayers = [] }) {
  const breakdown = useMemo(() => {
    return getTeamPlayerBreakdown(weeksParsedData, rosterId, startWeek, endWeek);
  }, [weeksParsedData, rosterId, startWeek, endWeek]);

  const isMobile = useIsMobile();
  const [hover, setHover] = useState({ playerId: null, x: 0, y: 0 });

  const rows = useMemo(() => {
    let baseRows = Object.values(breakdown)
      .map((d) => {
        const info = getPlayerInfo(d.playerId, playersData, playerIdMap);
        const name = info && info.name ? info.name : d.playerId;
        const position = info && info.position ? info.position : '';
        const img = info && info.espn_photo_url ? info.espn_photo_url : null;
        const totalAppearances = d.starts + d.bench;
        const startRate = totalAppearances > 0 ? (d.starts / totalAppearances) : 0;
        const benchRate = totalAppearances > 0 ? (d.bench / totalAppearances) : 0;
        const avgStarterPts = d.starts > 0 ? (d.starterPointsSum / d.starts) : 0;
        const avgBenchPts = d.bench > 0 ? (d.benchPointsSum / d.bench) : 0;
        const totalPts = d.starterPointsSum + d.benchPointsSum;
        const avgTotalPts = totalAppearances > 0 ? (totalPts / totalAppearances) : 0;
        const slotCounts = Array.isArray(d.startedPositionsCounts) ? d.startedPositionsCounts : [];
        return {
          playerId: d.playerId,
          name,
          position,
          img,
          starts: d.starts,
          bench: d.bench,
          startRate,
          benchRate,
          avgStarterPts,
          avgBenchPts,
          avgTotalPts,
          slotCounts,
        };
      });

    if (baseRows.length === 0 && Array.isArray(rosterPlayers) && rosterPlayers.length > 0) {
      baseRows = rosterPlayers.map(pid => {
        const info = getPlayerInfo(pid, playersData, playerIdMap);
        return {
          playerId: pid,
          name: (info && info.name) || pid,
          position: (info && info.position) || '',
          img: (info && info.espn_photo_url) || null,
          starts: 0,
          bench: 0,
          startRate: 0,
          benchRate: 0,
          avgStarterPts: 0,
          avgBenchPts: 0,
          avgTotalPts: 0,
          slotCounts: Array.isArray(STARTER_POSITION_NAMES) ? Array(STARTER_POSITION_NAMES.length).fill(0) : [],
        };
      });
    }

    return baseRows.sort((a, b) => (b.starts - a.starts) || (b.bench - a.bench));
  }, [breakdown, playersData, playerIdMap, rosterPlayers, STARTER_POSITION_NAMES]);

  return (
    <div className="team-analytics-card team-analytics-table-card">
      <div className="team-analytics-card-head">
        <h3 className="team-analytics-card-title">Player breakdown</h3>
        <p className="team-analytics-card-sub">Starts, bench time, and scoring for everyone on the roster</p>
      </div>
      <div className="team-analytics-table-scroll">
        <table className="team-analytics-table player-breakdown-table player-breakdown-compact">
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
            {rows.map(row => {
              const isActive = hover.playerId === row.playerId;
              const margin = 12;
              const approxHalfWidth = 160; // ~320px card width
              const clampedX = isActive
                ? Math.min(window.innerWidth - margin - approxHalfWidth, Math.max(margin + approxHalfWidth, hover.x))
                : hover.x;
              const cardStyle = isActive
                ? { display: 'block', position: 'fixed', left: clampedX, top: hover.y, transform: 'translate(-50%, 12px)', zIndex: 9999 }
                : { display: 'none' };
              return (
                <tr
                  key={row.playerId}
                  className="player-breakdown-row"
                  onMouseEnter={(e) => setHover({ playerId: row.playerId, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => {
                    if (hover.playerId === row.playerId) { setHover({ playerId: row.playerId, x: e.clientX, y: e.clientY }); }
                  }}
                  onMouseLeave={() => setHover({ playerId: null, x: 0, y: 0 })}
                >
                  <td>
                    <div className="player-breakdown-name">
                      {!isMobile && (
                        <img src={getPlayerLogoUrl(row.img)} alt={row.name} className="player-breakdown-avatar" />
                      )}
                      <span>{row.name} <PositionBadge position={row.position} /></span>
                      <div className="player-breakdown-card-wrapper" style={cardStyle}>
                        <div className="player-start-card">
                          <div className="player-start-card-header">
                            <img src={getPlayerLogoUrl(row.img)} alt={row.name} className="player-start-card-photo" />
                            <div className="player-start-card-title">{row.name}</div>
                          </div>
                          <div className="player-start-card-count">{row.starts} Starts</div>
                          <div className="player-start-card-list">
                            {STARTER_POSITION_NAMES && STARTER_POSITION_NAMES.map((label, idx) => {
                              const count = row.slotCounts[idx] || 0;
                              if (!row.starts || count === 0) {
                                return null;
                              }
                              const pct = Math.round((count / row.starts) * 1000) / 10;
                              return (
                                <div key={idx} className="player-start-card-row">
                                  <span className="player-start-card-pos">{label}</span>
                                  <span className="player-start-card-val">{count} ({pct}%)</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="player-breakdown-number">{row.starts} ({(row.startRate * 100).toFixed(0)}%)</td>
                  <td className="player-breakdown-number">{row.bench} ({(row.benchRate * 100).toFixed(0)}%)</td>
                  <td className="player-breakdown-number">{row.avgTotalPts.toFixed(1)}</td>
                  <td className="player-breakdown-number">{row.avgStarterPts.toFixed(1)}</td>
                  <td className="player-breakdown-number">{row.avgBenchPts.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PlayerBreakdownTable; 