import React, { useState } from 'react';
import HomeCard from './HomeCard';
import { getAuthClient } from '../utils/authClient';

const SLEEPER_BOT = '/data/sleeper-bot.png';

function LoginHomeCard() {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setError(null);
    setBusy(true);
    try {
      const origin = window.location.origin;
      await getAuthClient().signIn.social({
        provider: 'google',
        // Must be a real route. `/` is a catch-all redirect to `/home/` that
        // would strip `?neon_auth_session_verifier=…` and leave us signed out.
        callbackURL: `${origin}/home/`,
        newUserCallbackURL: `${origin}/FredDuel/setup`,
      });
    } catch (e) {
      setError(e.message || 'Sign-in failed');
      setBusy(false);
    }
  };

  return (
    <HomeCard className="login-home-card">
      <div className="home-card-inner">
        <h2 className="home-card-title login-home-card-title">
          <img src={SLEEPER_BOT} alt="" className="login-home-card-title-logo" aria-hidden="true" />
          NEW: Log In
        </h2>
        <p className="home-card-body login-home-card-copy">
          See your Hwang Dynasty team highlighted across the site.
        </p>
        <button
          type="button"
          className="login-home-signin-btn"
          onClick={signIn}
          disabled={busy}
        >
          <span className="login-home-signin-lock" aria-hidden="true">🔐</span>
          {busy ? 'Opening…' : 'Sign In & Link your team'}
        </button>
        {error ? (
          <p className="login-home-card-error">Sign-in failed: {error}</p>
        ) : null}
      </div>
    </HomeCard>
  );
}

export default LoginHomeCard;
