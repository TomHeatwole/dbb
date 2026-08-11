import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { getSessionToken } from '../utils/authClient';
import { useAuthUser } from '../hooks/useAuthUser';

// Landing page for Google OAuth. Waits for the one-time session verifier
// exchange, then sends onboarded users home and everyone else to setup.

function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useAuthUser();
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getSessionToken();
        if (!token) throw new Error('No session after sign-in');
        const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        await refresh();
        if (cancelled) return;
        navigate(data.user?.onboarded ? '/home/' : '/FredDuel/setup', { replace: true });
      } catch (e) {
        if (!cancelled) setError(e.message || 'Sign-in failed');
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, refresh]);

  return (
    <InfoPageWrapper title="FredDuel" subtitle="Signing you in">
      <div style={{ maxWidth: 560, margin: '2rem auto', textAlign: 'center' }}>
        {error ? <p>Sign-in failed: {error}</p> : <p>Finishing sign-in…</p>}
      </div>
    </InfoPageWrapper>
  );
}

export default AuthCallbackPage;
