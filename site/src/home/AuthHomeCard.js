import React from 'react';
import { useAuthUser } from '../hooks/useAuthUser';
import { getLoggedInTeamOverride } from '../debug/loggedInTeam';
import LoginHomeCard from './LoginHomeCard';
import YourTeamHomeCard from './YourTeamHomeCard';

function AuthHomeCard() {
  const { user, loading } = useAuthUser();
  if (loading && getLoggedInTeamOverride() == null) return null;
  return (user || getLoggedInTeamOverride() != null) ? <YourTeamHomeCard /> : <LoginHomeCard />;
}

export default AuthHomeCard;
