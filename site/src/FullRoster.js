import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

  const [selectedPlayer, setSelectedPlayer] = useState(null);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setSelectedPlayer(null);
      }
    }
    if (selectedPlayer) {
      document.addEventListener('keydown', onKeyDown);
    }
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedPlayer]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (selectedPlayer) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [selectedPlayer]);

  const modal = selectedPlayer ? (
    <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <PlayerCard player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />
      </div>
    </div>
  ) : null;

  return (
    <div className="team-roster-section">
      <div className={`player-columns${isMobile ? ' roster-mobile-columns' : ''}`}>
        {positions.map(pos => (
          <div key={pos} className={`player-column${isMobile ? ' roster-mobile-column' : ''}`}>
            <div className="player-column-header">{pos}</div>
            <ul className="player-list">
              {playersByPosition[pos].map((p, i) => (
                <li
                  key={i}
                  className="player-list-item player-list-item-flex player-clickable"
                  onClick={() => setSelectedPlayer(p)}
                >
                  {p.espn_photo_url && (
                    <img src={p.espn_photo_url} alt={p.name} className="player-avatar player-avatar-style" />
                  )}
                  <span className="player-name">{p.name}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {modal && createPortal(modal, document.body)}
    </div>
  );
}

export default FullRoster; 