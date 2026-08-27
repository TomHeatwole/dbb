import React from 'react';
import { Link } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import RedraftDash from '../redraftDash/RedraftDash';
import { useAuthUser } from '../hooks/useAuthUser';
import { isAdminUser } from '../utils/adminAccounts';

function RedraftDashPage() {
  const { user } = useAuthUser();
  const showSandboxLink = isAdminUser(user);

  return (
    <InfoPageWrapper
      title="Redraft Dash"
      subtitle="2026 Cross-Source Rankings — Local or Public snapshot"
      leftHeader={
        showSandboxLink ? (
          <Link to="/sandbox" className="sandbox-back-btn">
            ← Sandbox
          </Link>
        ) : null
      }
    >
      <RedraftDash />
    </InfoPageWrapper>
  );
}

export default RedraftDashPage;
