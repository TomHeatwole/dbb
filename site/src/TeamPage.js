import React, { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { LEAGUE_ID } from './global_constants';

function TeamPage() {
  const { id } = useParams();
  const [roster, setRoster] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check if id is a positive integer
  const isValidId = /^[1-9]\d*$/.test(id);

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

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!roster) return <div>No roster found for ID {id}</div>;

  return (
    <div>
      <h1>Hello, team ID: {id}</h1>
      <h2>Roster Info</h2>
      <pre style={{textAlign: 'left', background: '#222', color: '#fff', padding: '1em', borderRadius: '8px', overflowX: 'auto'}}>
        {JSON.stringify(roster, null, 2)}
      </pre>
      <h2>User Info</h2>
      <pre style={{textAlign: 'left', background: '#222', color: '#fff', padding: '1em', borderRadius: '8px', overflowX: 'auto'}}>
        {JSON.stringify(user, null, 2)}
      </pre>
    </div>
  );
}

export default TeamPage; 