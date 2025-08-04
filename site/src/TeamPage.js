import React, { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { LEAGUE_ID } from './global_constants';

function TeamPage() {
  const { id } = useParams();
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check if id is a positive integer
  const isValidId = /^[1-9]\d*$/.test(id);

  useEffect(() => {
    if (!isValidId) return;
    async function fetchRoster() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`);
        if (!response.ok) throw new Error('Failed to fetch rosters');
        const rosters = await response.json();
        const found = rosters.find(r => String(r.roster_id) === String(id));
        setRoster(found);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchRoster();
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
      <pre style={{textAlign: 'left', background: '#222', color: '#fff', padding: '1em', borderRadius: '8px', overflowX: 'auto'}}>
        {JSON.stringify(roster, null, 2)}
      </pre>
    </div>
  );
}

export default TeamPage; 