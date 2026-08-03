/* eslint-disable no-restricted-globals */
/**
 * Web Worker wrapper for the Hwang True Simulator engine.
 *
 * Running the simulation off the main thread keeps the UI fully responsive
 * and — critically — avoids background-tab timer throttling: browsers clamp
 * main-thread setTimeout to ≥1s when the tab loses focus, which would slow a
 * long run to a crawl. Worker timers are not throttled.
 *
 * Cancellation is handled by the host terminating the worker.
 */
import { runHwangTrueSimulation } from './hwangTrueSimulatorEngine';

self.onmessage = async (event) => {
  if (event.data?.type !== 'run') return;
  try {
    const results = await runHwangTrueSimulation({
      ...event.data.options,
      onProgress: (progress) => self.postMessage({ type: 'progress', progress }),
      isCancelled: () => false,
    });
    self.postMessage({ type: 'done', results });
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || 'Simulation failed' });
  }
};
