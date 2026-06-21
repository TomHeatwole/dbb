/**
 * simulatorWorker.js
 *
 * Web Worker entry — runs Monte Carlo sims off the main thread.
 */

/* eslint-disable no-restricted-globals */

import {
  runMonteCarloSimulationSync,
  isLightweightSimulatorRun,
} from './simulatorMonteCarloCore';

self.onmessage = (event) => {
  const { ctx, iterations } = event.data;
  const lightweight = isLightweightSimulatorRun(iterations);

  try {
    const result = runMonteCarloSimulationSync(ctx, {
      iterations,
      lightweight,
      onProgress: (progress) => {
        self.postMessage({ type: 'progress', progress });
      },
    });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err?.message || 'Simulation failed',
    });
  }
};
