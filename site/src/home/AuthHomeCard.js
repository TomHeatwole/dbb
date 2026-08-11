import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthUser } from '../hooks/useAuthUser';
import { getLoggedInTeamOverride } from '../debug/loggedInTeam';
import LoginHomeCard from './LoginHomeCard';
import YourTeamHomeCard from './YourTeamHomeCard';

function AuthHomeCard() {
  const { user, loading } = useAuthUser();
  if (loading && getLoggedInTeamOverride() == null) return null;
  if (user && !user.onboarded) return <Navigate to="/account/setup" replace />;
  return (user || getLoggedInTeamOverride() != null) ? <YourTeamHomeCard /> : <LoginHomeCard />;
}

export default AuthHomeCard;
