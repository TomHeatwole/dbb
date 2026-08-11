import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { getSessionToken } from '../utils/authClient';
import { useAuthUser } from '../hooks/useAuthUser';

// Post-sign-in setup: every account must link a verified Sleeper username
// before entering FredDuel. Signed-out or already-linked users are sent
// straight back to /FredDuel.

const buttonStyle = {
  padding: '0.6rem 1.4rem',
  fontSize: '1rem',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'rgba(255,255,255,0.08)',
  color: 'inherit',
  cursor: 'pointer',
};

function FredDuelSetupPage() {
  const navigate = useNavigate();
  const { refresh } = useAuthUser();
  const [me, setMe] = useState(undefined); // undefined = loading
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const loadMe = useCallback(async () => {
    try {
      const token = await getSessionToken();
      if (!token) {
        setMe(null);
        return;
      }
      const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setMe(res.ok ? data.user : null);
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const token = await getSessionToken();
      const res = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sleeperUsername: username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await refresh();
      navigate('/FredDuel');
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  if (me === undefined) {
    return (
      <InfoPageWrapper title="FredDuel" subtitle="Account setup">
        <div style={{ maxWidth: 560, margin: '2rem auto', textAlign: 'center' }}>
          <p>Loading…</p>
        </div>
      </InfoPageWrapper>
    );
  }

  // Signed out, or already fully set up → nothing to do here
  if (!me || me.onboarded) {
    return <Navigate to="/FredDuel" replace />;
  }

  return (
    <InfoPageWrapper title="FredDuel" subtitle="Account setup">
      <div style={{ maxWidth: 560, margin: '2rem auto', textAlign: 'center' }}>
        <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>Almost there, {me.name || me.email}</p>
        <p style={{ opacity: 0.7 }}>
          Link your Sleeper account to finish setting up. This is required to use the exchange.
        </p>
        <form onSubmit={submit} style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: '1.5rem' }}>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Sleeper username"
            autoFocus
            style={{ padding: '0.5rem 0.8rem', borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', background: 'transparent', color: 'inherit' }}
          />
          <button type="submit" style={buttonStyle} disabled={submitting || !username.trim()}>
            {submitting ? 'Verifying…' : 'Verify & continue'}
          </button>
        </form>
        {error && <p style={{ opacity: 0.8, marginTop: '0.8rem' }}>{error}</p>}
      </div>
    </InfoPageWrapper>
  );
}

export default FredDuelSetupPage;
