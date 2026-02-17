import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import { fetchTrendingPlayers } from '../lookups/TrendingLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { getPlayerInfo, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import useIsMobile from '../hooks/useIsMobile';

function TrendingFreeAgentsCard() {
  const [trendingFreeAgents, setTrendingFreeAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [idMap, setIdMap] = useState(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        // Load all required data in parallel
        const [trending, teamDataResult, players, idMapResult] = await Promise.all([
          fetchTrendingPlayers(),
          fetchTeamData(CURRENT_YEAR),
          fetch('/data/players.txt').then(res => res.json()),
          fetchPlayerIdMap()
        ]);

        // Store data for modal
        setTeamData(teamDataResult);
        setPlayersData(players);
        setIdMap(idMapResult);

        if (!trending || trending.length === 0) {
          setTrendingFreeAgents([]);
          return;
        }

        // Build set of all rostered Sleeper IDs
        const rosteredSleeperIds = new Set();
        teamDataResult.rosters.forEach(roster => {
          if (Array.isArray(roster.players)) {
            roster.players.forEach(pid => rosteredSleeperIds.add(pid));
          }
        });

        // Filter trending to only free agents
        const freeAgents = trending
          .filter(item => !rosteredSleeperIds.has(item.player_id))
          .slice(0, 10)
          .map(item => {
            const playerInfo = getPlayerInfo(item.player_id, players, idMapResult);
            return {
              playerId: item.player_id,
              count: item.count,
              name: playerInfo?.name || item.player_id,
              position: playerInfo?.position || '',
              team: playerInfo?.team || playerInfo?.team_abbr || '',
              photo: playerInfo?.espn_photo_url || null,
              fullPlayerInfo: playerInfo // Store full player info for modal
            };
          });

        setTrendingFreeAgents(freeAgents);
      } catch (err) {
        setError('Failed to load trending free agents');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // Close modal on Escape key
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
          rosters={teamData?.rosters || []}
          users={teamData?.users || []}
        />
      </div>
    </div>
  ) : null;

  return (
    <>
      <HomeCard>
        <div className="home-card-inner">
          <h2 className="home-card-title">📈 Trending Free Agents</h2>
          <div style={{ padding: isMobile ? '0.3rem 0' : '0.5rem 0' }}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 1fr',
              gap: isMobile ? '0.2rem' : '0.35rem',
              padding: isMobile ? '0 0.3rem' : '0 0.5rem'
            }}>
              {trendingFreeAgents.map((player, index) => (
                <div 
                  key={player.playerId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: isMobile ? '0.3rem 0.35rem' : '0.4rem 0.5rem',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: '4px',
                    gap: isMobile ? '0.35rem' : '0.5rem',
                    transition: 'background 0.2s ease',
                    minWidth: 0,
                    cursor: 'pointer'
                  }}
                  onClick={() => setSelectedPlayer(player.fullPlayerInfo)}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'}
                >
                  {/* Player Photo */}
                  <img 
                    src={getPlayerLogoUrl(player.photo)}
                    alt={player.name}
                    style={{
                      width: isMobile ? '20px' : '28px',
                      height: isMobile ? '20px' : '28px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '1.5px solid rgba(255, 255, 255, 0.1)',
                      background: 'rgba(255, 255, 255, 0.05)',
                      flexShrink: 0
                    }}
                  />

                  {/* Player Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: '600',
                      fontSize: isMobile ? '0.6rem' : '0.75rem',
                      color: 'rgba(255, 255, 255, 0.95)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.2
                    }}>
                      {player.name}
                    </div>
                    <div style={{
                      fontSize: isMobile ? '0.5rem' : '0.65rem',
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
                    gap: isMobile ? '0.1rem' : '0.15rem',
                    color: '#1db954',
                    fontWeight: 'bold',
                    fontSize: isMobile ? '0.55rem' : '0.7rem',
                    flexShrink: 0
                  }}>
                    <span style={{ fontSize: isMobile ? '0.6rem' : '0.8rem' }}>+</span>
                    {player.count.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </HomeCard>
      {modal && createPortal(modal, document.body)}
    </>
  );
}

export default TrendingFreeAgentsCard;
