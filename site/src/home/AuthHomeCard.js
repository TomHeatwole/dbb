import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthUser } from '../hooks/useAuthUser';
import { getLoggedInTeamOverride } from '../debug/loggedInTeam';
import { setAuthReturnTo } from '../utils/authReturn';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import LoginHomeCard from './LoginHomeCard';
import YourTeamHomeCard from './YourTeamHomeCard';

function AuthHomeCard() {
  const { user, loading } = useAuthUser();

  useEffect(() => {
    if (user && !user.onboarded) {
      setAuthReturnTo('/home/');
    }
  }, [user]);
  if (loading && getLoggedInTeamOverride() == null) {
    return (
      <HomeCard className="auth-home-card">
        <LoadingState
          className="active-playoffs-loading"
          label="Loading…"
          ariaLabel="Loading account"
        />
      </HomeCard>
    );
  }
  if (user && !user.onboarded) return <Navigate to="/account/setup" replace />;
  return (user || getLoggedInTeamOverride() != null) ? <YourTeamHomeCard /> : <LoginHomeCard />;
}

export default AuthHomeCard;
