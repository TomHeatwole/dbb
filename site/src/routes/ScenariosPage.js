import React, { useEffect, useState } from 'react';
import { fetchTrendingPlayers } from '../lookups/TrendingLookup';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import LoadingState from '../LoadingState';
import useIsMobile from '../hooks/useIsMobile';

function ScenariosPage() {
  const [trendingData, setTrendingData] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    Promise.all([
      fetchTrendingPlayers(),
      // Fetch players.txt directly for 2024 data
      fetch('/data/players.txt').then(res => res.json())
    ])
      .then(([trending, players]) => {
        setTrendingData(trending);
        setPlayersData(players);
      })
      .catch((err) => {
        console.error('Error loading data:', err);
        setError('Failed to load trending players');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <InfoPageWrapper title="Trending Players" subtitle={null}>
        <LoadingState label="Loading trending players…" />
      </InfoPageWrapper>
    );
  }

  if (error) {
    return (
      <InfoPageWrapper title="Trending Players" subtitle={null}>
        <div style={{ padding: '20px', color: '#ff6b6b' }}>{error}</div>
      </InfoPageWrapper>
    );
  }

  return (
    <InfoPageWrapper title="Trending Players" subtitle="Most added in the last 24 hours">
      <div className="pos-avg-table-container">
        {trendingData && trendingData.length > 0 ? (
          <div className="pos-avg-table-scroll">
            <table className="pos-avg-table player-breakdown-table player-breakdown-compact">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Rank</th>
                  <th>Player</th>
                  <th style={{ textAlign: 'right' }}>Adds</th>
                </tr>
              </thead>
              <tbody>
                {trendingData.map((item, index) => {
                  const playerInfo = playersData ? getPlayerInfo(item.player_id, playersData, null) : null;
                  const playerName = playerInfo ? playerInfo.name : `Player ${item.player_id}`;
                  const position = playerInfo ? playerInfo.position : '';
                  const team = playerInfo ? (playerInfo.team || playerInfo.team_abbr) : '';
                  const img = playerInfo ? playerInfo.espn_photo_url : null;
                  
                  return (
                    <tr key={item.player_id} className="player-breakdown-row">
                      <td style={{ 
                        fontWeight: 'bold', 
                        color: 'rgba(255, 255, 255, 0.6)',
                        textAlign: 'center'
                      }}>
                        #{index + 1}
                      </td>
                      <td>
                        <div className="player-breakdown-name">
                          {!isMobile && img && (
                            <img src={img} alt={playerName} className="player-breakdown-avatar" />
                          )}
                          <span>
                            {playerName}
                            {(position || team) && (
                              <span style={{ 
                                color: 'rgba(255, 255, 255, 0.6)', 
                                marginLeft: '0.5rem',
                                fontSize: '0.9em'
                              }}>
                                {position && `${position}`}
                                {position && team && ' • '}
                                {team && team}
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td style={{ 
                        textAlign: 'right',
                        color: '#1db954',
                        fontWeight: 'bold'
                      }}>
                        +{item.count.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '20px' }}>No trending players data available</div>
        )}
      </div>
    </InfoPageWrapper>
  );
}

export default ScenariosPage;
