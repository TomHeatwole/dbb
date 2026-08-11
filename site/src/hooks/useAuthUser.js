import { useCallback, useContext, useEffect, useMemo, useState, createContext } from 'react';
import { getSessionToken } from '../utils/authClient';
import { getLoggedInTeamOverride } from '../debug/loggedInTeam';

// Shared signed-in user for the whole app. Pages use this to highlight the
// logged-in Sleeper account's team. Null user = signed out / not onboarded.
const AuthUserContext = createContext({ user: null, loading: true, refresh: () => {} });

export function AuthUserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const token = await getSessionToken();
      if (!token) {
        setUser(null);
        return;
      }
      const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      const next = res.ok && data.user && data.user.onboarded ? data.user : null;
      setUser(next);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => ({ user, loading, refresh }), [user, loading, refresh]);
  return <AuthUserContext.Provider value={value}>{children}</AuthUserContext.Provider>;
}

export function useAuthUser() {
  return useContext(AuthUserContext);
}

/**
 * Resolve the logged-in user's roster_id from a Sleeper rosters+users pair.
 * Prefers sleeper_user_id === roster.owner_id; falls back to username.
 */
export function findMyRosterId(rosters, users, authUser) {
  const override = getLoggedInTeamOverride();
  if (override != null) return override;
  if (!authUser || !Array.isArray(rosters)) return null;

  if (authUser.sleeperUserId) {
    const mine = rosters.find((r) => String(r.owner_id) === String(authUser.sleeperUserId));
    if (mine) return Number(mine.roster_id);
  }

  if (authUser.sleeperUsername && Array.isArray(users)) {
    const handle = String(authUser.sleeperUsername).toLowerCase();
    const user = users.find((u) => u && String(u.username || '').toLowerCase() === handle);
    if (user) {
      const mine = rosters.find((r) => String(r.owner_id) === String(user.user_id));
      if (mine) return Number(mine.roster_id);
    }
  }

  return null;
}

export function useMyRosterId(rosters, users) {
  const { user } = useAuthUser();
  return useMemo(() => findMyRosterId(rosters, users, user), [rosters, users, user]);
}

// Shared current-season team fetch so pages that don't already have rosters
// (home cards, yoffs, builders) can still highlight the logged-in team.
let _teamCache = null;
let _teamPromise = null;

export async function loadCurrentTeamData() {
  if (_teamCache) return _teamCache;
  if (!_teamPromise) {
    const { fetchTeamData } = await import('../lookups/TeamLookup');
    _teamPromise = fetchTeamData()
      .then((d) => { _teamCache = d; return d; })
      .catch((e) => { _teamPromise = null; throw e; });
  }
  return _teamPromise;
}

export function useMyCurrentRosterId() {
  const { user } = useAuthUser();
  const [myRosterId, setMyRosterId] = useState(getLoggedInTeamOverride());

  useEffect(() => {
    const override = getLoggedInTeamOverride();
    if (override != null) {
      setMyRosterId(override);
      return;
    }
    if (!user) {
      setMyRosterId(null);
      return;
    }
    let cancelled = false;
    loadCurrentTeamData()
      .then((data) => {
        if (!cancelled) setMyRosterId(findMyRosterId(data.rosters, data.users, user));
      })
      .catch(() => {
        if (!cancelled) setMyRosterId(null);
      });
    return () => { cancelled = true; };
  }, [user]);

  return myRosterId;
}

export function isMyRoster(rosterId, myRosterId) {
  if (rosterId == null) return false;
  const override = getLoggedInTeamOverride();
  const effective = override != null ? override : myRosterId;
  if (effective == null) return false;
  return String(rosterId) === String(effective);
}

/** Appends `me` (or `prefix--me`) to a className when this roster is the logged-in user. */
export function meClass(base, rosterId, myRosterId, modifier = 'me') {
  if (!isMyRoster(rosterId, myRosterId)) return base || '';
  if (!base) return modifier;
  return `${base} ${base}--${modifier}`;
}
