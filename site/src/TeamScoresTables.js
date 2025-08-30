import React from 'react';
import { getPlayerInfo } from './PlayerLookup';
import { STARTER_POSITION_NAMES } from './global_constants';

export default function TeamScoresTables({ weekBreakdown, playersData, playerIdMap, renderOnly = null, playerGameLabels = {}, isActiveWeek = false }) {
  if (!weekBreakdown) {
    return <div>No data for this week/team.</div>;
  }

  const renderStarters = () => (
    <div className="team-scores-tables-col" style={{ width: '100%' }}>
      <div className="team-scores-starters-bench-title">Starters</div>
      <table className="team-scores-table team-scores-table-fixed-width" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>Position</th>
            <th>Player</th>
            <th>Game</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          {weekBreakdown.starters.map((p, i) => {
            const info = getPlayerInfo(p.id, playersData, playerIdMap);
            const posLabel = STARTER_POSITION_NAMES[i] || `S${i + 1}`;
            const gameObj = playerGameLabels && playerGameLabels[p.id] ? playerGameLabels[p.id] : { text: '', live: false, team: null, completed: false };
            const teamAbbr = gameObj.team || (info && (info.team || info.team_abbr)) || null;
            const gameCellClasses = ['team-scores-game-cell'];
            if (isActiveWeek && gameObj.live) {
              gameCellClasses.push('team-scores-game-live');
            } else if (isActiveWeek && gameObj.completed) {
              gameCellClasses.push('team-scores-game-completed');
            }
            return (
              <tr key={p.id}>
                <td className="team-scores-pos-cell">{posLabel}</td>
                <td className="team-scores-player-cell">
                  {info && info.espn_photo_url && (
                    <img src={info.espn_photo_url} alt={info.name} className="player-avatar player-avatar-style team-scores-player-img-margin" />
                  )}
                  <span className="player-name">
                    {info && info.name ? info.name : (p.id === '0' ? '\u00A0' : p.id)}
                    {info && info.position ? ` (${info.position})` : ''}
                    {teamAbbr ? <span className="team-scores-game-cell" style={{ marginLeft: '0.35rem' }}>{teamAbbr}</span> : null}
                  </span>
                </td>
                <td className={gameCellClasses.join(' ')}>{gameObj.text}</td>
                <td className="team-scores-pts-cell">{p.pts}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="team-scores-total-row">
              <div className="team-scores-total-inner">Total: {weekBreakdown.starterTotal}</div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  const renderBench = () => (
    <div className="team-scores-tables-col" style={{ width: '100%' }}>
      <div className="team-scores-starters-bench-title">Bench</div>
      <table className="team-scores-table team-scores-table-bench" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>Player</th>
            <th>Game</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          {[...weekBreakdown.bench].sort((a, b) => b.pts - a.pts).map((p) => {
            const info = getPlayerInfo(p.id, playersData, playerIdMap);
            const gameObj = playerGameLabels && playerGameLabels[p.id] ? playerGameLabels[p.id] : { text: '', live: false, team: null, completed: false };
            const teamAbbr = gameObj.team || (info && (info.team || info.team_abbr)) || null;
            const gameCellClasses = ['team-scores-game-cell'];
            if (isActiveWeek && gameObj.live) {
              gameCellClasses.push('team-scores-game-live');
            } else if (isActiveWeek && gameObj.completed) {
              gameCellClasses.push('team-scores-game-completed');
            }
            return (
              <tr key={p.id}>
                <td className="team-scores-player-cell">
                  {info && info.espn_photo_url && (
                    <img src={info.espn_photo_url} alt={info.name} className="player-avatar player-avatar-style team-scores-player-img-margin" />
                  )}
                  <span className="player-name">
                    {info && info.name ? info.name : (p.id === '0' ? '\u00A0' : p.id)}
                    {info && info.position ? ` (${info.position})` : ''}
                    {teamAbbr ? <span className="team-scores-game-cell" style={{ marginLeft: '0.35rem' }}>{teamAbbr}</span> : null}
                  </span>
                </td>
                <td className={gameCellClasses.join(' ')}>{gameObj.text}</td>
                <td className="team-scores-pts-cell">{p.pts}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="team-scores-total-row">
              <div className="team-scores-total-inner">Total: {weekBreakdown.benchTotal}</div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  if (renderOnly === 'starters') {
    return renderStarters();
  }
  if (renderOnly === 'bench') {
    return renderBench();
  }

  return (
    <div className="team-scores-tables-flex">
      {renderStarters()}
      {renderBench()}
    </div>
  );
} 