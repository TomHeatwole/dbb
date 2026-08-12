import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { getAuthClient, getSessionToken, clearSessionCache } from '../utils/authClient';
import { setAuthReturnTo } from '../utils/authReturn';
import FredDuelExchange from '../fredduel/FredDuelExchange';
import {
  createTestClient, createRemoteClient, isTestMode, setTestMode,
  TEST_ACTOR_KEY,
} from '../fredduel/exchangeClient';
import { FALLBACK_TEAMS, testActorForRosterId } from '../fredduel/testSeed';

// FredDuel — the Hwang Dynasty betting exchange.
// Auth flow: Google sign-in → unverified accounts finish at /account/setup,
// then return here. Admins can toggle a "test data DB" mode (localStorage
// sandbox) to try the exchange acting as any of the 10 teams.

// Hardcoded admin list (Sleeper usernames) — the only accounts that can see
// and use test mode.
const ADMIN_SLEEPER_USERNAMES = ['sleeperdotcom'];

function isAdminUser(me) {
  const handle = String(me?.sleeperUsername || '').toLowerCase();
  return ADMIN_SLEEPER_USERNAMES.includes(handle);
}

function loadTeamsList() {
  return import('../hooks/useAuthUser')
    .then(({ loadCurrentTeamData }) => loadCurrentTeamData())
    .then(async ({ rosters, users }) => {
      const { buildRosterIdToTeamInfoMap } = await import('../lookups/TeamLookup');
      const map = buildRosterIdToTeamInfoMap(rosters, users);
      const list = Object.keys(map)
        .map((rid) => ({
          rosterId: Number(rid),
          teamName: map[rid].teamName,
          ownerName: map[rid].ownerName,
        }))
        .sort((a, b) => a.rosterId - b.rosterId);
      return list.length ? list : FALLBACK_TEAMS;
    })
    .catch(() => FALLBACK_TEAMS);
}

function GoogleSignInButton() {
  const [error, setError] = useState(null);

  const signIn = async () => {
    try {
      setAuthReturnTo('/FredDuel');
      await getAuthClient().signIn.social({
        provider: 'google',
        callbackURL: `${window.location.origin}/auth/callback`,
        newUserCallbackURL: `${window.location.origin}/auth/callback`,
      });
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <p>Sign in to enter the FredDuel exchange.</p>
      <button className="fd-btn fd-btn-primary" onClick={signIn}>Sign in with Google</button>
      {error && <p style={{ opacity: 0.7 }}>Sign-in failed: {error}</p>}
    </div>
  );
}

function loadTestActorRosterId() {
  try {
    const raw = localStorage.getItem(TEST_ACTOR_KEY);
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1) return n;
  } catch {}
  return FALLBACK_TEAMS[0].rosterId;
}

function FredDuelPage() {
  const [testMode, setTestModeState] = useState(isTestMode());
  const [testRosterId, setTestRosterId] = useState(loadTestActorRosterId());
  const [teams, setTeams] = useState(FALLBACK_TEAMS);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [me, setMe] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadTeamsList().then((list) => { if (!cancelled) setTeams(list); });
    return () => { cancelled = true; };
  }, []);

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

  useEffect(() => {
    if (!loading && me && !me.onboarded) {
      setAuthReturnTo('/FredDuel');
    }
  }, [loading, me]);

  const toggleTestMode = (on) => {
    setTestMode(on);
    setTestModeState(on);
  };

  const pickTestRoster = (rid) => {
    setTestRosterId(rid);
    try { localStorage.setItem(TEST_ACTOR_KEY, String(rid)); } catch {}
  };

  // Test client reads the actor through a ref so switching identities doesn't
  // rebuild the client (and lose in-flight state).
  const testActor = useMemo(
    () => testActorForRosterId(testRosterId, teams),
    [testRosterId, teams],
  );
  const testActorRef = useRef(testActor);
  testActorRef.current = testActor;
  const testClient = useMemo(() => createTestClient(() => testActorRef.current), []);
  const remoteClient = useMemo(() => createRemoteClient(getSessionToken), []);

  const signOut = async () => {
    await getAuthClient().signOut();
    clearSessionCache();
    setMe(null);
  };

  const isAdmin = isAdminUser(me);

  // Drop a stale test-mode flag if the signed-in user isn't an admin (e.g.
  // toggled on by an admin on a shared machine, or before this gate existed).
  useEffect(() => {
    if (!loading && testMode && !isAdmin) {
      setTestMode(false);
      setTestModeState(false);
    }
  }, [loading, testMode, isAdmin]);

  // ---- Test mode: admin-only sandbox on top of a local test DB ----
  if (testMode && isAdmin) {
    return (
      <InfoPageWrapper title="FredDuel" subtitle="The Hwang Dynasty exchange">
        <div className="fd-page">
          <div className="fd-test-banner">
            <span className="fd-test-flag">TEST DATA</span>
            <span>Sandbox DB in your browser — nothing here is real.</span>
            <label className="fd-test-actor">
              Acting as
              <select value={testActor.rosterId} onChange={(e) => pickTestRoster(Number(e.target.value))}>
                {teams.map((t) => (
                  <option key={t.rosterId} value={t.rosterId}>{t.teamName}</option>
                ))}
              </select>
            </label>
            <button className="fd-btn fd-btn-ghost" onClick={() => toggleTestMode(false)}>
              Exit test mode
            </button>
          </div>
          <FredDuelExchange
            client={testClient}
            actor={testActor}
            teams={teams}
            onResetTestData={() => testClient.resetTestData()}
          />
        </div>
      </InfoPageWrapper>
    );
  }

  // Signed in but no verified Sleeper account yet → generic setup (returns here after)
  if (!loading && me && !me.onboarded) {
    return <Navigate to="/account/setup" replace />;
  }

  let content;
  if (loading) {
    content = <p style={{ textAlign: 'center' }}>Loading…</p>;
  } else if (authError) {
    content = <p style={{ textAlign: 'center', opacity: 0.8 }}>Something went wrong: {authError}</p>;
  } else if (!me) {
    content = (
      <div style={{ maxWidth: 560, margin: '2rem auto', textAlign: 'center' }}>
        <GoogleSignInButton />
      </div>
    );
  } else {
    const actor = { id: me.id, name: me.sleeperDisplayName || me.sleeperUsername || me.name };
    content = (
      <div className="fd-page">
        <div className="fd-signed-in-row">
          <span className="fd-muted">
            Signed in as <strong>{actor.name}</strong>
          </span>
          {isAdmin && (
            <button className="fd-btn fd-btn-ghost" onClick={() => toggleTestMode(true)}>Test mode</button>
          )}
          <button className="fd-btn fd-btn-ghost" onClick={signOut}>Sign out</button>
        </div>
        <FredDuelExchange client={remoteClient} actor={actor} teams={teams} />
      </div>
    );
  }

  return (
    <InfoPageWrapper title="FredDuel" subtitle="The Hwang Dynasty exchange">
      {content}
    </InfoPageWrapper>
  );
}

export default FredDuelPage;
