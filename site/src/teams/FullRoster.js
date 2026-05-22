import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import useIsMobile from '../hooks/useIsMobile';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import PositionBadge from '../PositionBadge';

function toOrdinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) {
    return '';
  }
  const v = num % 100;
  if (v >= 11 && v <= 13) {
    return `${num}th`;
  }
  switch (num % 10) {
    case 1: return `${num}st`;
    case 2: return `${num}nd`;
    case 3: return `${num}rd`;
    default: return `${num}th`;
  }
}

function abbreviateTeamName(name) {
  if (!name) {
    return '';
  }
  const trimmed = String(name).trim();
  if (trimmed.length <= 13) {
    return trimmed;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 0) {
    return trimmed;
  }
  const firstWord = parts[0];
  const lastWord = parts[parts.length - 1];
  const firstInitial = firstWord.charAt(0).toUpperCase();
  return `${firstInitial}. ${lastWord}`;
}

function formatPick(pick, draftOrder = null, nextDraftYear = null) {
  if (!pick) {
    return '';
  }
  const season = pick.season != null ? String(pick.season) : '';
  const round = pick.round != null ? Number(pick.round) : null;
  const roundLabel = pick.round != null ? toOrdinal(pick.round) : '';
  const rawTeamName = pick.team_name || (pick.previous_owner_id != null ? `Team ${pick.previous_owner_id}` : '');
  const viaTeamName = abbreviateTeamName(rawTeamName);
  const viaLabel = viaTeamName ? ` (${viaTeamName})` : '';
  
  // If we have draft order data and this pick is for the next draft year and is round 1-4
  if (draftOrder && season === nextDraftYear && Number.isFinite(round) && round >= 1 && round <= 4) {
    // roster_id is the original team whose pick this is
    const originalRosterId = pick.roster_id != null ? String(pick.roster_id) : null;
    const pickNum = originalRosterId ? draftOrder[originalRosterId] : null;
    
    if (Number.isFinite(pickNum)) {
      // Format as "2026 1.03 (Team Name)"
      const pickLabel = `${round}.${String(pickNum).padStart(2, '0')}`;
      return `${season} ${pickLabel}${viaLabel}`.trim();
    }
  }
  
  // Default format: "2026 1st (Team Name)"
  return `${season} ${roundLabel}${viaLabel}`.trim();
}

// Helper function to get the pick number for sorting purposes
function getPickNumberForSort(pick, draftOrder, nextDraftYear) {
  if (!pick) return 9999;
  
  const season = pick.season != null ? String(pick.season) : '';
  const round = pick.round != null ? Number(pick.round) : null;
  
  // If we have draft order data and this pick is for the next draft year
  if (draftOrder && season === nextDraftYear && Number.isFinite(round) && round >= 1 && round <= 4) {
    const originalRosterId = pick.roster_id != null ? String(pick.roster_id) : null;
    const pickNum = originalRosterId ? draftOrder[originalRosterId] : null;
    
    if (Number.isFinite(pickNum)) {
      return pickNum;
    }
  }
  
  // Default: return a large number (sorts to end within the same round/year)
  return 9999;
}

function FullRoster({ playerList, positions = ['QB', 'WR', 'RB', 'TE'], picks = [], draftOrder = null, nextDraftYear = null, rosters = null, users = null }) {
  // Sort picks by year, round, and then pick number (for draft order)
  const sortedPicks = [...picks].sort((a, b) => {
    const aSeason = Number(a.season || 0);
    const bSeason = Number(b.season || 0);
    if (aSeason !== bSeason) {
      return aSeason - bSeason;
    }
    
    const aRound = Number(a.round || 0);
    const bRound = Number(b.round || 0);
    if (aRound !== bRound) {
      return aRound - bRound;
    }
    
    // Sort by pick number within the same year/round
    const aPickNum = getPickNumberForSort(a, draftOrder, nextDraftYear);
    const bPickNum = getPickNumberForSort(b, draftOrder, nextDraftYear);
    if (aPickNum !== bPickNum) {
      return aPickNum - bPickNum;
    }
    
    // Fallback: sort by team name
    const aName = a.team_name || '';
    const bName = b.team_name || '';
    return aName.localeCompare(bName);
  });

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
        <PlayerWeeklyScores 
          player={selectedPlayer} 
          onClose={() => setSelectedPlayer(null)}
          rosters={rosters}
          users={users}
        />
      </div>
    </div>
  ) : null;

  return (
    <div className="team-roster-section">
      <div className={`player-columns${isMobile ? ' roster-mobile-columns' : ''}`}>
        {positions.map(pos => (
          <div key={pos} className={`player-column${isMobile ? ' roster-mobile-column' : ''}`}>
            <div className="player-column-header"><PositionBadge position={pos} /></div>
            <ul className="player-list">
              {pos === 'Picks'
                ? sortedPicks.map((pick, i) => (
                    <li
                      key={i}
                      className="player-list-item player-list-item-flex"
                    >
                      <span className="player-name">{formatPick(pick, draftOrder, nextDraftYear)}</span>
                    </li>
                  ))
                : playersByPosition[pos].map((p, i) => (
                    <li
                      key={i}
                      className="player-list-item player-list-item-flex player-clickable"
                      onClick={() => setSelectedPlayer(p)}
                    >
                      <img src={getPlayerLogoUrl(p.espn_photo_url)} alt={p.name} className="player-avatar player-avatar-style" />
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