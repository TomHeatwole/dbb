import React from 'react';
import { Link } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import RedraftDashLiveDraft from '../redraftDash/RedraftDashLiveDraft';
import { useAuthUser } from '../hooks/useAuthUser';
import { canAccessRedraftDash, isAdminUser } from '../utils/adminAccounts';

function LiveDraftPage() {
  const { user } = useAuthUser();
  const showDashLink = canAccessRedraftDash(user) || isAdminUser(user);

  return (
    <InfoPageWrapper
      title="Live Draft"
      subtitle="Cross out players as they go — Redraft Dash board"
      leftHeader={
        showDashLink ? (
          <Link to="/redraftdash" className="sandbox-back-btn">
            ← Redraft Dash
          </Link>
        ) : null
      }
    >
      <RedraftDashLiveDraft />
    </InfoPageWrapper>
  );
}

export default LiveDraftPage;
