/**
 * SimulatorPage — builder + 1000-run Monte Carlo sim.
 */

import React from 'react';
import { useSearchParams } from 'react-router-dom';
import SimulatorBuilderPage from './SimulatorBuilderPage';
import SimulatorRunPage from './SimulatorRunPage';

function SimulatorPage() {
  const [searchParams] = useSearchParams();
  const pageState = searchParams.get('state') || 'builder';

  if (pageState === 'run') {
    return <SimulatorRunPage />;
  }

  return <SimulatorBuilderPage />;
}

export default SimulatorPage;
