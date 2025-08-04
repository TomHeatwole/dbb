import React, { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { LEAGUE_ID } from './global_constants';
import { getPlayerInfo, fetchPlayersData } from './PlayerLookup';

function TeamPage() {
  const { id } = useParams();
  const [roster, setRoster] = useState(null);
  const [user, setUser] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check if id is a positive integer
  const isValidId = /^[1-9]\d*$/.test(id);

  // Fetch player data on mount (now using fetchPlayersData)
  useEffect(() => {
    fetchPlayersData()
      .then(setPlayersData)
      .catch(() => setPlayersData(null));
  }, []);

  useEffect(() => {
    if (!isValidId) return;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        // Fetch rosters
        const rosterRes = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`);
        if (!rosterRes.ok) throw new Error('Failed to fetch rosters');
        const rosters = await rosterRes.json();
        const foundRoster = rosters.find(r => String(r.roster_id) === String(id));
        setRoster(foundRoster);
        if (!foundRoster) {
          setUser(null);
          setLoading(false);
          return;
        }
        // Fetch users
        const usersRes = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`);
        if (!usersRes.ok) throw new Error('Failed to fetch users');
        const users = await usersRes.json();
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

  if (loading || !playersData) return <div>Loading...</div>;
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
    const info = getPlayerInfo(pid, playersData);
    return info ? info : { name: pid, position: '', espn_photo_url: null };
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
        <h4>Rostered Players:</h4>
        <ul>
          {playerList.map((p, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5em' }}>
              {p.espn_photo_url && (
                <img src={p.espn_photo_url} alt={p.name} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', marginRight: 12, background: '#222' }} />
              )}
              <span>{p.name} {p.position && <span style={{ color: '#aaa', fontSize: '0.95em' }}>({p.position})</span>}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default TeamPage; 