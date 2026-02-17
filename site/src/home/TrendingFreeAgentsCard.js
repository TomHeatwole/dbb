import React, { useEffect, useState } from 'react';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import { fetchTrendingPlayers } from '../lookups/TrendingLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { getPlayerInfo, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { CURRENT_YEAR } from '../utils/DateHelper';

function TrendingFreeAgentsCard() {
  const [trendingFreeAgents, setTrendingFreeAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        // Load all required data in parallel
        const [trending, teamData, players, idMap] = await Promise.all([
          fetchTrendingPlayers(),
          fetchTeamData(CURRENT_YEAR),
          fetch('/data/players.txt').then(res => res.json()),
          fetchPlayerIdMap()
        ]);

        if (!trending || trending.length === 0) {
          setTrendingFreeAgents([]);
          return;
        }

        // Build set of all rostered Sleeper IDs
        const rosteredSleeperIds = new Set();
        teamData.rosters.forEach(roster => {
          if (Array.isArray(roster.players)) {
            roster.players.forEach(pid => rosteredSleeperIds.add(pid));
          }
        });

        // Filter trending to only free agents
        const freeAgents = trending
          .filter(item => !rosteredSleeperIds.has(item.player_id))
          .slice(0, 10)
          .map(item => {
            const playerInfo = getPlayerInfo(item.player_id, players, idMap);
            return {
              playerId: item.player_id,
              count: item.count,
              name: playerInfo?.name || item.player_id,
              position: playerInfo?.position || '',
              team: playerInfo?.team || playerInfo?.team_abbr || '',
              photo: playerInfo?.espn_photo_url || null
            };
          });

        setTrendingFreeAgents(freeAgents);
      } catch (err) {
        console.error('Error loading trending free agents:', err);
        setError('Failed to load trending free agents');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return (
      <HomeCard>
        <div className="home-card-inner">
          <h2 className="home-card-title">📈 Trending Free Agents</h2>
          <LoadingState label="Loading trending free agents..." />
        </div>
      </HomeCard>
    );
  }

  if (error) {
    return (
      <HomeCard>
        <div className="home-card-inner">
          <h2 className="home-card-title">📈 Trending Free Agents</h2>
          <div style={{ padding: '1rem', color: '#ff6b6b', textAlign: 'center' }}>
            {error}
          </div>
        </div>
      </HomeCard>
    );
  }

  if (trendingFreeAgents.length === 0) {
    return (
      <HomeCard>
        <div className="home-card-inner">
          <h2 className="home-card-title">📈 Trending Free Agents</h2>
          <div style={{ padding: '1rem', color: '#999', textAlign: 'center' }}>
            No trending free agents found
          </div>
        </div>
      </HomeCard>
    );
  }

  return (
    <HomeCard>
      <div className="home-card-inner">
        <h2 className="home-card-title">📈 Trending Free Agents</h2>
        <div style={{ padding: '0.5rem 0' }}>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr',
            gap: '0.35rem',
            padding: '0 0.5rem'
          }}>
            {trendingFreeAgents.map((player, index) => (
              <div 
                key={player.playerId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0.4rem 0.5rem',
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: '4px',
                  gap: '0.5rem',
                  transition: 'background 0.2s ease',
                  minWidth: 0
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'}
              >
                {/* Player Photo */}
                {player.photo && (
                  <img 
                    src={player.photo}
                    alt={player.name}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '1.5px solid rgba(255, 255, 255, 0.1)',
                      background: 'rgba(255, 255, 255, 0.05)',
                      flexShrink: 0
                    }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                )}

                {/* Player Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: '600',
                    fontSize: '0.75rem',
                    color: 'rgba(255, 255, 255, 0.95)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    lineHeight: 1.2
                  }}>
                    {player.name}
                  </div>
                  <div style={{
                    fontSize: '0.65rem',
                    color: 'rgba(255, 255, 255, 0.5)',
                    marginTop: '1px',
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {player.position && `${player.position}`}
                    {player.position && player.team && ' • '}
                    {player.team}
                  </div>
                </div>

                {/* Add Count */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.15rem',
                  color: '#1db954',
                  fontWeight: 'bold',
                  fontSize: '0.7rem',
                  flexShrink: 0
                }}>
                  <span style={{ fontSize: '0.8rem' }}>+</span>
                  {player.count.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </HomeCard>
  );
}

export default TrendingFreeAgentsCard;
