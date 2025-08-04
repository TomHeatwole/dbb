import React, { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { getPlayerInfo, fetchPlayersData, fetchPlayerIdMap } from './PlayerLookup';
import { fetchTeamData } from './TeamLookup';

function TeamPage() {
  const { id } = useParams();
  const [roster, setRoster] = useState(null);
  const [user, setUser] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check if id is a positive integer
  const isValidId = /^[1-9]\d*$/.test(id);

  // Fetch player data and playerIdMap on mount
  useEffect(() => {
    fetchPlayersData()
      .then(setPlayersData)
      .catch(() => setPlayersData(null));
    fetchPlayerIdMap()
      .then(setPlayerIdMap)
      .catch(() => setPlayerIdMap(null));
  }, []);

  useEffect(() => {
    if (!isValidId) return;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const { rosters, users } = await fetchTeamData();
        const foundRoster = rosters.find(r => String(r.roster_id) === String(id));
        setRoster(foundRoster);
        if (!foundRoster) {
          setUser(null);
          setLoading(false);
          return;
        }
        const foundUser = users.find(u => String(u.user_id) === String(foundRoster.owner_id));
        setUser(foundUser);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id, isValidId]);

  if (!isValidId) {
    return <Navigate to="/home/" replace />;
  }

  if (loading || !playersData || !playerIdMap) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!roster) return <div>No roster found for ID {id}</div>;

  // Get team name and avatars
  const ownerName = user && user.display_name ? user.display_name : 'Unknown';
  let teamName = null;
  if (user && user.metadata && user.metadata.team_name) {
    teamName = user.metadata.team_name;
  } else if (ownerName && ownerName !== 'Unknown') {
    teamName = `Team ${ownerName}`;
  } else {
    teamName = `Team ${id}`;
  }
  // Helper to get avatar URL from value (ID or URL)
  function getAvatarUrl(avatarVal) {
    if (!avatarVal) return null;
    if (typeof avatarVal === 'string' && avatarVal.startsWith('http')) return avatarVal;
    return `https://sleepercdn.com/avatars/${avatarVal}`;
  }
  const userAvatarUrl = getAvatarUrl(user && user.avatar);

  // Get player info for each player on the roster
  const playerList = (roster.players || []).map(pid => {
    const info = getPlayerInfo(pid, playersData, playerIdMap);
    return info ? info : { name: pid, position: '', espn_photo_url: null };
  });

  // Group players by position
  const positions = ['QB', 'WR', 'RB', 'TE'];
  const playersByPosition = {};
  positions.forEach(pos => { playersByPosition[pos] = []; });
  playerList.forEach(player => {
    const pos = positions.includes(player.position) ? player.position : null;
    if (pos) {
      playersByPosition[pos].push(player);
    }
  });

  return (
    <div className="team-info-box">
      <h1 className="team-header">{teamName}</h1>
      <div className="owner-subtitle">
        <span>Owner: {ownerName}</span>
        {userAvatarUrl && (
          <img src={userAvatarUrl} alt="Owner Avatar" className="owner-avatar" />
        )}
      </div>
      <div style={{ marginTop: '1.5em', textAlign: 'left' }}>
        <div className="player-columns" style={{ display: 'flex', gap: '2em', justifyContent: 'center' }}>
          {positions.map(pos => (
            <div key={pos} style={{ minWidth: 120 }}>
              <div style={{ textAlign: 'center', marginBottom: 12, fontSize: '1.5em', fontWeight: 700, letterSpacing: '0.05em' }}>{pos}</div>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {playersByPosition[pos].map((p, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5em' }}>
                    {p.espn_photo_url && (
                      <img src={p.espn_photo_url} alt={p.name} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', marginRight: 12, background: '#222' }} />
                    )}
                    <span>{p.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default TeamPage; 