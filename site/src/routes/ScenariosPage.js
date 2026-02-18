/**
 * ScenariosPage — thin router for the Scenario Builder feature.
 *
 * Reads the `state` query param and delegates rendering entirely to one of
 * two self-contained page components:
 *
 *   ?state=builder  (default)  →  ScenarioBuilderPage
 *   ?state=eval                →  ScenarioEvalPage
 *
 * These two pages share no React state and do not import from each other,
 * so they can be developed concurrently without risk of conflicts.
 */

import React from 'react';
import { useSearchParams } from 'react-router-dom';
import ScenarioBuilderPage from './ScenarioBuilderPage';
import ScenarioEvalPage from './ScenarioEvalPage';

function ScenariosPage() {
  const [searchParams] = useSearchParams();
  const pageState = searchParams.get('state') || 'builder';

  if (pageState === 'eval') {
    return <ScenarioEvalPage />;
  }

  return <ScenarioBuilderPage />;
}

export default ScenariosPage;
