/**
 * FutureScenariosPage — thin router for the Future Scenarios feature.
 *
 *   ?state=builder  (default)  →  FutureScenarioBuilderPage
 *   ?state=eval                →  FutureScenarioEvalPage
 */

import React from 'react';
import { useSearchParams } from 'react-router-dom';
import FutureScenarioBuilderPage from './FutureScenarioBuilderPage';
import FutureScenarioEvalPage from './FutureScenarioEvalPage';

function FutureScenariosPage() {
  const [searchParams] = useSearchParams();
  const pageState = searchParams.get('state') || 'builder';

  if (pageState === 'eval') {
    return <FutureScenarioEvalPage />;
  }

  return <FutureScenarioBuilderPage />;
}

export default FutureScenariosPage;
