import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchTrendingPlayers } from '../lookups/TrendingLookup';
import { getPlayerInfo, fetchPlayerIdMap, isRookie } from '../lookups/PlayerLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import LoadingState from '../LoadingState';
import PlayerWeeklyScores from './PlayerWeeklyScores';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import PositionBadge from '../PositionBadge';

function PlayerSearch() {
  const [trendingData, setTrendingData] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [rookiesOnly, setRookiesOnly] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchTrendingPlayers(),
      fetch('/data/players.txt').then(res => res.json()),
      fetchPlayerIdMap(),
      fetchTeamData(CURRENT_YEAR)
    ])
      .then(([trending, players, idMap, teamData]) => {
        setTrendingData(trending);
        setPlayersData(players);
        setPlayerIdMap(idMap);
        setRosters(teamData.rosters);
        setUsers(teamData.users);
      })
      .catch(() => {
        setError('Failed to load player data');
      })
      .finally(() => setLoading(false));
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowDropdown(false);
    if (showDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showDropdown]);

  const getFilteredPlayers = () => {
    if (!trendingData || !playersData) return [];

    // Rookies-only mode with no search query: show all rookies sorted by search_rank
    if (rookiesOnly && !searchQuery.trim()) {
      const rookieMatches = [];
      for (const playerId in playersData) {
        const player = playersData[playerId];
        if (isRookie(player)) {
          const playerInfo = getPlayerInfo(playerId, playersData, playerIdMap);
          if (playerInfo) rookieMatches.push(playerInfo);
        }
      }
      rookieMatches.sort((a, b) => {
        const ra = a.search_rank === 9999999 ? Infinity : (a.search_rank ?? Infinity);
        const rb = b.search_rank === 9999999 ? Infinity : (b.search_rank ?? Infinity);
        return ra - rb;
      });
      return rookieMatches.slice(0, 20);
    }

    // If no search query, show top trending players (optionally filtered to rookies)
    if (!searchQuery.trim()) {
      return trendingData.slice(0, 10).map(item => {
        const playerInfo = getPlayerInfo(item.player_id, playersData, playerIdMap);
        return playerInfo ? { ...playerInfo, count: item.count } : null;
      }).filter(Boolean);
    }

    // Filter all players by search query (and optionally by rookie status)
    const query = searchQuery.toLowerCase();
    const allPlayerMatches = [];

    for (const playerId in playersData) {
      const player = playersData[playerId];
      if (rookiesOnly && !isRookie(player)) continue;

      const firstName = (player.first_name || '').toLowerCase();
      const lastName = (player.last_name || '').toLowerCase();
      const fullName = (player.full_name || '').toLowerCase();

      if (firstName.includes(query) || lastName.includes(query) || fullName.includes(query)) {
        const playerInfo = getPlayerInfo(playerId, playersData, playerIdMap);
        if (playerInfo) {
          allPlayerMatches.push(playerInfo);
        }
      }

      if (allPlayerMatches.length >= 20) break;
    }

    return allPlayerMatches;
  };

  const handlePlayerSelect = (player) => {
    setSelectedPlayer(player);
    setSearchQuery('');
    setShowDropdown(false);
  };

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setSelectedPlayer(null);
    }
    if (selectedPlayer) {
      document.addEventListener('keydown', onKeyDown);
    }
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedPlayer]);

  useEffect(() => {
    if (selectedPlayer) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [selectedPlayer]);

  if (loading) {
    return <LoadingState label="Loading players…" />;
  }

  if (error) {
    return <div style={{ padding: '20px', color: '#ff6b6b' }}>{error}</div>;
  }

  const filteredPlayers = getFilteredPlayers();

  const playerModal = selectedPlayer ? (
    <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
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
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      {/* Search Bar */}
      <div style={{ position: 'relative', marginBottom: '12px' }} onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          placeholder="Search for a player..."
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: '16px',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            color: '#fff',
            outline: 'none',
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)'}
          onMouseLeave={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
        />
        
        {/* Rookies toggle */}
        <div style={{ marginTop: '10px', marginBottom: '6px' }}>
          <button
            onClick={() => setRookiesOnly(v => !v)}
            style={{
              padding: '5px 14px',
              fontSize: '13px',
              fontWeight: '500',
              borderRadius: '20px',
              border: rookiesOnly
                ? '1px solid #f5a623'
                : '1px solid rgba(255, 255, 255, 0.15)',
              backgroundColor: rookiesOnly
                ? 'rgba(245, 166, 35, 0.15)'
                : 'transparent',
              color: rookiesOnly ? '#f5a623' : 'rgba(255, 255, 255, 0.5)',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Rookies only
          </button>
        </div>

        {/* Dropdown */}
        {showDropdown && filteredPlayers.length > 0 && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '4px',
            backgroundColor: '#1a1f2e',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            maxHeight: '400px',
            overflowY: 'auto',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}>
            {!searchQuery.trim() && (
              <div style={{
                padding: '8px 16px',
                fontSize: '12px',
                color: 'rgba(255, 255, 255, 0.5)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              }}>
                {rookiesOnly ? 'Rookies' : 'Trending Players'}
              </div>
            )}
            {filteredPlayers.map((player) => (
              <div
                key={player.player_id}
                onClick={() => handlePlayerSelect(player)}
                style={{
                  padding: '12px 16px',
                  cursor: 'pointer',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <img 
                  src={getPlayerLogoUrl(player.espn_photo_url)} 
                  alt={player.name}
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    objectFit: 'cover',
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '500' }}>{player.name}</div>
                  <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.6)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <PositionBadge position={player.position} />
                    {(player.team || player.team_abbr) && <span>{player.team || player.team_abbr}</span>}
                  </div>
                </div>
                {isRookie(player) && (
                  <div style={{
                    padding: '2px 7px',
                    fontSize: '11px',
                    fontWeight: '600',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(245, 166, 35, 0.15)',
                    color: '#f5a623',
                    border: '1px solid rgba(245, 166, 35, 0.3)',
                    letterSpacing: '0.3px',
                  }}>
                    R
                  </div>
                )}
                {player.count && (
                  <div style={{ 
                    color: '#1db954', 
                    fontWeight: 'bold',
                    fontSize: '14px',
                  }}>
                    +{player.count.toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {playerModal && createPortal(playerModal, document.body)}
    </div>
  );
}

export default PlayerSearch;
