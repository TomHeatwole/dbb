/**
 * SimulatorPage — builder + 1000-run Monte Carlo sim.
 */

import React from 'react';
import { useSearchParams } from 'react-router-dom';
import SimulatorBuilderPage from './SimulatorBuilderPage';
import SimulatorRunPage from './SimulatorRunPage';

function SimulatorPage({ variant = 'season' }) {
  const [searchParams] = useSearchParams();
  const pageState = searchParams.get('state') || 'builder';

  if (pageState === 'run') {
    return <SimulatorRunPage variant={variant} />;
  }

  return <SimulatorBuilderPage variant={variant} />;
}

export function ROSSimulatorPage() {
  return <SimulatorPage variant="ros" />;
}

export default SimulatorPage;
