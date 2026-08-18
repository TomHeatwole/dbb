import React from 'react';
import { Link } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import RedraftDash from '../redraftDash/RedraftDash';

function RedraftDashPage() {
  return (
    <InfoPageWrapper
      title="Redraft Dash"
      subtitle="2026 Cross-Source Rankings — Local or Public snapshot"
      leftHeader={
        <Link to="/sandbox" className="sandbox-back-btn">
          ← Sandbox
        </Link>
      }
    >
      <RedraftDash />
    </InfoPageWrapper>
  );
}

export default RedraftDashPage;
