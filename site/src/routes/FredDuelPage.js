import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { getAuthClient, getSessionToken, clearSessionCache } from '../utils/authClient';

// FredDuel — future home of the exchange.
// Auth flow: Google sign-in (Neon Managed Better Auth) → accounts without a
// verified Sleeper username are redirected to /FredDuel/setup to finish.

const buttonStyle = {
  padding: '0.6rem 1.4rem',
  fontSize: '1rem',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'rgba(255,255,255,0.08)',
  color: 'inherit',
  cursor: 'pointer',
};

function GoogleSignInButton() {
  const [error, setError] = useState(null);

  const signIn = async () => {
    try {
      await getAuthClient().signIn.social({
        provider: 'google',
        callbackURL: `${window.location.origin}/FredDuel`,
        newUserCallbackURL: `${window.location.origin}/FredDuel/setup`,
      });
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <p>Sign in to enter the FredDuel exchange.</p>
      <button style={buttonStyle} onClick={signIn}>Sign in with Google</button>
      {error && <p style={{ opacity: 0.7 }}>Sign-in failed: {error}</p>}
    </div>
  );
}

function FredDuelPage() {
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [me, setMe] = useState(null);

  const refreshMe = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    try {
      const token = await getSessionToken();
      if (!token) {
        setMe(null);
        return;
      }
      const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMe(data.user);
    } catch (e) {
      setAuthError(e.message);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshMe(); }, [refreshMe]);

  const signOut = async () => {
    await getAuthClient().signOut();
    clearSessionCache();
    setMe(null);
  };

  // Signed in but no verified Sleeper account yet → finish setup first
  if (!loading && me && !me.onboarded) {
    return <Navigate to="/FredDuel/setup" replace />;
  }

  let content;
  if (loading) {
    content = <p>Loading…</p>;
  } else if (authError) {
    content = <p style={{ opacity: 0.8 }}>Something went wrong: {authError}</p>;
  } else if (!me) {
    content = <GoogleSignInButton />;
  } else {
    content = (
      <div>
        <p style={{ fontSize: '1.3rem', fontWeight: 600 }}>
          Welcome, {me.sleeperDisplayName || me.sleeperUsername}
        </p>
        <p style={{ opacity: 0.7 }}>
          Signed in as {me.email}
          <br />
          Sleeper: {me.sleeperUsername}
        </p>
        <p style={{ marginTop: '1.5rem', opacity: 0.7 }}>The exchange is coming soon.</p>
        <button style={{ ...buttonStyle, marginTop: '1rem' }} onClick={signOut}>Sign out</button>
      </div>
    );
  }

  return (
    <InfoPageWrapper title="FredDuel" subtitle="The Hwang Dynasty exchange">
      <div style={{ maxWidth: 560, margin: '2rem auto', textAlign: 'center' }}>
        {content}
      </div>
    </InfoPageWrapper>
  );
}

export default FredDuelPage;
