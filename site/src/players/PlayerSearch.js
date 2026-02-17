import React, { useEffect, useState } from 'react';
import { fetchTrendingPlayers } from '../lookups/TrendingLookup';
import { getPlayerInfo, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import LoadingState from '../LoadingState';
import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';

function PlayerSearch() {
  const [trendingData, setTrendingData] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [weeklyStats, setWeeklyStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [season, setSeason] = useState(CURRENT_YEAR);

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
    fetchPlayerWeeklyStats(player.player_id, season);
  };

  const fetchPlayerWeeklyStats = async (playerId, year) => {
    setStatsLoading(true);
    setWeeklyStats(null);
    try {
      const currentWeek = getCurrentNFLWeek(year);
      const totalWeeks = year === CURRENT_YEAR ? Math.min(17, currentWeek) : 17;
      
      // Fetch scores data which includes players_points
      const weeksParsedData = await fetchScoresData(year);
      const weeklyData = [];
      
      for (let week = 1; week <= totalWeeks; week++) {
        const weekData = weeksParsedData[week - 1];
        let points = 0;
        let stats = null;
        
        if (weekData && Array.isArray(weekData)) {
          for (const entry of weekData) {
            if (entry && entry.players_points && entry.players_points[playerId] != null) {
              points = entry.players_points[playerId];
              // Also try to get the actual stats from Sleeper API
              try {
                const response = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${year}/${week}`);
                if (response.ok) {
                  const sleeperStats = await response.json();
                  if (sleeperStats[playerId]) {
                    stats = sleeperStats[playerId];
                  }
                }
              } catch (err) {
                console.error(`Error fetching stats for week ${week}:`, err);
              }
              break;
            }
          }
        }
        
        weeklyData.push({
          week,
          points: Math.round(points * 10) / 10,
          stats
        });
      }
      
      setWeeklyStats(weeklyData);
    } catch (err) {
      console.error('Error fetching weekly stats:', err);
    } finally {
      setStatsLoading(false);
    }
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
        <div>
          <div style={{
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            padding: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            marginBottom: '20px',
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

          {/* Weekly Stats Table */}
          {statsLoading ? (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <LoadingState label="Loading weekly stats..." />
            </div>
          ) : weeklyStats && weeklyStats.length > 0 ? (
            <div style={{
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                fontSize: '18px',
                fontWeight: '600',
              }}>
                {season} Season Stats
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                }}>
                  <thead>
                    <tr style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.02)',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                    }}>
                      <th style={headerStyle}>Week</th>
                      <th style={headerStyle}>Points</th>
                      {selectedPlayer.position === 'QB' && (
                        <>
                          <th style={headerStyle}>Pass Yds</th>
                          <th style={headerStyle}>Pass TD</th>
                          <th style={headerStyle}>INT</th>
                          <th style={headerStyle}>Rush Yds</th>
                          <th style={headerStyle}>Rush TD</th>
                        </>
                      )}
                      {['RB', 'WR', 'TE'].includes(selectedPlayer.position) && (
                        <>
                          <th style={headerStyle}>Rush Yds</th>
                          <th style={headerStyle}>Rush TD</th>
                          <th style={headerStyle}>Rec</th>
                          <th style={headerStyle}>Rec Yds</th>
                          <th style={headerStyle}>Rec TD</th>
                        </>
                      )}
                      {selectedPlayer.position === 'K' && (
                        <>
                          <th style={headerStyle}>FGM</th>
                          <th style={headerStyle}>FGA</th>
                          <th style={headerStyle}>XPM</th>
                          <th style={headerStyle}>XPA</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyStats.map(({ week, points, stats }) => {
                      const hasStats = stats && Object.keys(stats).length > 0;

                      return (
                        <tr 
                          key={week}
                          style={{
                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                            opacity: points > 0 ? 1 : 0.4,
                          }}
                        >
                          <td style={cellStyle}>{week}</td>
                          <td style={{...cellStyle, fontWeight: '600', color: points > 0 ? '#1db954' : 'inherit'}}>
                            {points > 0 ? points.toFixed(1) : '-'}
                          </td>
                          {selectedPlayer.position === 'QB' && (
                            <>
                              <td style={cellStyle}>{stats?.pass_yd ? Math.round(stats.pass_yd) : '-'}</td>
                              <td style={cellStyle}>{stats?.pass_td ? Math.round(stats.pass_td) : '-'}</td>
                              <td style={cellStyle}>{stats?.pass_int ? Math.round(stats.pass_int) : '-'}</td>
                              <td style={cellStyle}>{stats?.rush_yd ? Math.round(stats.rush_yd) : '-'}</td>
                              <td style={cellStyle}>{stats?.rush_td ? Math.round(stats.rush_td) : '-'}</td>
                            </>
                          )}
                          {['RB', 'WR', 'TE'].includes(selectedPlayer.position) && (
                            <>
                              <td style={cellStyle}>{stats?.rush_yd ? Math.round(stats.rush_yd) : '-'}</td>
                              <td style={cellStyle}>{stats?.rush_td ? Math.round(stats.rush_td) : '-'}</td>
                              <td style={cellStyle}>{stats?.rec ? Math.round(stats.rec) : '-'}</td>
                              <td style={cellStyle}>{stats?.rec_yd ? Math.round(stats.rec_yd) : '-'}</td>
                              <td style={cellStyle}>{stats?.rec_td ? Math.round(stats.rec_td) : '-'}</td>
                            </>
                          )}
                          {selectedPlayer.position === 'K' && (
                            <>
                              <td style={cellStyle}>{stats?.fgm ? Math.round(stats.fgm) : '-'}</td>
                              <td style={cellStyle}>{stats?.fga ? Math.round(stats.fga) : '-'}</td>
                              <td style={cellStyle}>{stats?.xpm ? Math.round(stats.xpm) : '-'}</td>
                              <td style={cellStyle}>{stats?.xpa ? Math.round(stats.xpa) : '-'}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const headerStyle = {
  padding: '12px 16px',
  textAlign: 'left',
  fontSize: '13px',
  fontWeight: '600',
  color: 'rgba(255, 255, 255, 0.6)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const cellStyle = {
  padding: '12px 16px',
  textAlign: 'left',
  fontSize: '14px',
};

export default PlayerSearch;
