import React from 'react';
import useIsMobile from './useIsMobile';
import PlayerCard from './PlayerCard';

function FullRoster({ playerList, positions = ['QB', 'WR', 'RB', 'TE'] }) {
  // Group players by position
  const playersByPosition = {};
  positions.forEach(pos => { playersByPosition[pos] = []; });
  playerList.forEach(player => {
    const pos = positions.includes(player.position) ? player.position : null;
    if (pos) {
      playersByPosition[pos].push(player);
    }
  });
  // Sort each position group by search_rank (ascending)
  positions.forEach(pos => {
    playersByPosition[pos].sort((a, b) => {
      const rankA = a.search_rank !== undefined ? a.search_rank : 9999999;
      const rankB = b.search_rank !== undefined ? b.search_rank : 9999999;
      return rankA - rankB;
    });
  });

  const isMobile = useIsMobile();

  return (
    <div className="team-roster-section">
      <div className={`player-columns${isMobile ? ' roster-mobile-columns' : ''}`}>
        {positions.map(pos => (
          <div key={pos} className={`player-column${isMobile ? ' roster-mobile-column' : ''}`}>
            <div className="player-column-header">{pos}</div>
            <ul className="player-list">
              {playersByPosition[pos].map((p, i) => (
                <li key={i} className="player-list-item player-list-item-flex player-hover-container">
                  {p.espn_photo_url && (
                    <img src={p.espn_photo_url} alt={p.name} className="player-avatar player-avatar-style" />
                  )}
                  <span className="player-name">{p.name}</span>
                  <div className="player-card-wrapper">
                    <PlayerCard player={p} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default FullRoster; 