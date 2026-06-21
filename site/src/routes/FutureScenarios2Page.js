/**
 * FutureScenarios2Page — router for Future Scenarios v2 (outcome-based projections).
 */

import React from 'react';
import { useSearchParams } from 'react-router-dom';
import FutureScenario2BuilderPage from './FutureScenario2BuilderPage';
import FutureScenario2EvalPage from './FutureScenario2EvalPage';

function FutureScenarios2Page() {
  const [searchParams] = useSearchParams();
  const pageState = searchParams.get('state') || 'builder';

  if (pageState === 'eval') {
    return <FutureScenario2EvalPage />;
  }

  return <FutureScenario2BuilderPage />;
}

export default FutureScenarios2Page;
