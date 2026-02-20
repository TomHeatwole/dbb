import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchTrendingPlayers } from '../lookups/TrendingLookup';
import { getPlayerInfo, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import PlayerWeeklyScores from './PlayerWeeklyScores';
import LoadingState from '../LoadingState';
import useIsMobile from '../hooks/useIsMobile';
import { CURRENT_YEAR } from '../utils/DateHelper';

function TrendingPlayers() {
  const [trendingData, setTrendingData] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    Promise.all([
      fetchTrendingPlayers(),
      fetch('/data/players.txt').then(res => res.json()),
      fetchPlayerIdMap(),
      fetchTeamData(CURRENT_YEAR),
    ])
      .then(([trending, players, idMap, teamData]) => {
        setTrendingData(trending);
        setPlayersData(players);
        setPlayerIdMap(idMap);
        setRosters(teamData.rosters);
        setUsers(teamData.users);
      })
      .catch(() => {
        setError('Failed to load trending players');
      })
      .finally(() => setLoading(false));
  }, []);

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

  const handlePlayerClick = (item) => {
    if (!playersData) return;
    const playerInfo = getPlayerInfo(item.player_id, playersData, playerIdMap);
    if (playerInfo) setSelectedPlayer(playerInfo);
  };

  const modal = selectedPlayer ? (
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

  if (loading) {
    return <LoadingState label="Loading trending players…" />;
  }

  if (error) {
    return <div style={{ padding: '20px', color: '#ff6b6b' }}>{error}</div>;
  }

  return (
    <div className="pos-avg-table-container">
      <h3 className="pos-avg-table-title">Trending Players</h3>
      <p style={{ padding: '0 1rem', opacity: 0.7, fontSize: '0.9rem' }}>
        Most added in the last 24 hours
      </p>
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
                const playerInfo = playersData ? getPlayerInfo(item.player_id, playersData, playerIdMap) : null;
                const playerName = playerInfo ? playerInfo.name : `Player ${item.player_id}`;
                const position = playerInfo ? playerInfo.position : '';
                const team = playerInfo ? (playerInfo.team || playerInfo.team_abbr) : '';
                const img = getPlayerLogoUrl(playerInfo ? playerInfo.espn_photo_url : null);

                return (
                  <tr
                    key={item.player_id}
                    className="player-breakdown-row player-clickable"
                    onClick={() => handlePlayerClick(item)}
                  >
                    <td style={{
                      fontWeight: 'bold',
                      color: 'rgba(255, 255, 255, 0.6)',
                      textAlign: 'center'
                    }}>
                      #{index + 1}
                    </td>
                    <td>
                      <div className="player-breakdown-name">
                        {!isMobile && (
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

      {modal && createPortal(modal, document.body)}
    </div>
  );
}

export default TrendingPlayers;
