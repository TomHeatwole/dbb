import React, { useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PageMeta from '../PageMeta';
import { getSessionToken } from '../utils/authClient';
import { createRemoteClient } from '../fredduel/exchangeClient';
import FredDuelSettlePanel from '../fredduel/FredDuelSettlePanel';
import { useAuthUser } from '../hooks/useAuthUser';

const OG_TITLE = 'FredDuel — Settle bets';
const OG_DESCRIPTION = 'Admin grading for the Hwang Dynasty exchange';

function FredDuelSettlePage() {
  const { user, loading } = useAuthUser();
  const client = useMemo(() => createRemoteClient(getSessionToken), []);

  if (loading) {
    return (
      <InfoPageWrapper title="Settle bets" subtitle="FredDuel admin">
        <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
        <p style={{ textAlign: 'center' }}>Loading…</p>
      </InfoPageWrapper>
    );
  }

  if (!user?.onboarded) {
    return <Navigate to="/account/setup" replace />;
  }

  return (
    <InfoPageWrapper title="Settle bets" subtitle="FredDuel admin">
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <div className="fd-page">
        <FredDuelSettlePanel client={client} />
      </div>
    </InfoPageWrapper>
  );
}

export default FredDuelSettlePage;
