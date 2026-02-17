import React, { useEffect, useState } from 'react';
import { fetchTrendingPlayers } from '../lookups/TrendingLookup';
import { getPlayerInfo, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import LoadingState from '../LoadingState';

function PlayerSearch() {
  const [trendingData, setTrendingData] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchTrendingPlayers(),
      fetch('/data/players.txt').then(res => res.json()),
      fetchPlayerIdMap()
    ])
      .then(([trending, players, idMap]) => {
        setTrendingData(trending);
        setPlayersData(players);
        setPlayerIdMap(idMap);
      })
      .catch((err) => {
        console.error('Error loading data:', err);
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
    
    // If no search query, show top trending players
    if (!searchQuery.trim()) {
      return trendingData.slice(0, 10).map(item => {
        const playerInfo = getPlayerInfo(item.player_id, playersData, playerIdMap);
        return playerInfo ? { ...playerInfo, player_id: item.player_id, count: item.count } : null;
      }).filter(Boolean);
    }
    
    // Filter all players by search query
    const query = searchQuery.toLowerCase();
    const allPlayerMatches = [];
    
    for (const playerId in playersData) {
      const player = playersData[playerId];
      const firstName = (player.first_name || '').toLowerCase();
      const lastName = (player.last_name || '').toLowerCase();
      const fullName = (player.full_name || '').toLowerCase();
      
      if (firstName.includes(query) || lastName.includes(query) || fullName.includes(query)) {
        const playerInfo = getPlayerInfo(playerId, playersData, playerIdMap);
        if (playerInfo) {
          allPlayerMatches.push({ ...playerInfo, player_id: playerId });
        }
      }
      
      // Limit results
      if (allPlayerMatches.length >= 20) break;
    }
    
    return allPlayerMatches;
  };

  const handlePlayerSelect = (player) => {
    setSelectedPlayer(player);
    setSearchQuery('');
    setShowDropdown(false);
  };

  if (loading) {
    return <LoadingState label="Loading players…" />;
  }

  if (error) {
    return <div style={{ padding: '20px', color: '#ff6b6b' }}>{error}</div>;
  }

  const filteredPlayers = getFilteredPlayers();

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      {/* Search Bar */}
      <div style={{ position: 'relative', marginBottom: '30px' }} onClick={(e) => e.stopPropagation()}>
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
                Trending Players
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
                {player.espn_photo_url && (
                  <img 
                    src={player.espn_photo_url} 
                    alt={player.name}
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                    }}
                    onError={(e) => e.target.style.display = 'none'}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '500' }}>{player.name}</div>
                  <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.6)' }}>
                    {player.position && `${player.position}`}
                    {player.position && (player.team || player.team_abbr) && ' • '}
                    {(player.team || player.team_abbr) && (player.team || player.team_abbr)}
                  </div>
                </div>
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

      {/* Selected Player Display */}
      {selectedPlayer && (
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '12px',
          padding: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
        }}>
          {selectedPlayer.espn_photo_url && (
            <img 
              src={selectedPlayer.espn_photo_url} 
              alt={selectedPlayer.name}
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                objectFit: 'cover',
                border: '2px solid rgba(255, 255, 255, 0.1)',
              }}
              onError={(e) => e.target.style.display = 'none'}
            />
          )}
          <div>
            <h3 style={{ 
              margin: 0, 
              fontSize: '24px',
              fontWeight: '600',
            }}>
              {selectedPlayer.name}
            </h3>
            <div style={{ 
              marginTop: '8px',
              fontSize: '16px',
              color: 'rgba(255, 255, 255, 0.6)',
            }}>
              {selectedPlayer.position && `${selectedPlayer.position}`}
              {selectedPlayer.position && (selectedPlayer.team || selectedPlayer.team_abbr) && ' • '}
              {(selectedPlayer.team || selectedPlayer.team_abbr) && (selectedPlayer.team || selectedPlayer.team_abbr)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PlayerSearch;
