/**
 * simulatorMonteCarlo.js
 *
 * Public API for season simulator Monte Carlo runs.
 * Dispatches to a Web Worker when available; falls back to batched main-thread runs.
 */

import {
  DEFAULT_ITERATIONS,
  MAX_SIMULATOR_ITERATIONS,
  SIMULATOR_TEAM_DETAIL_MAX_ITERATIONS,
  clampSimulatorIterations,
  isLightweightSimulatorRun,
  prepareSimulatorContext,
  computeSimulatorResultDeltas,
  createSimulationState,
  runSimulationIterations,
  finalizeSimulationState,
  BATCH_SIZE,
  LIGHTWEIGHT_BATCH_SIZE,
} from './simulatorMonteCarloCore';

export {
  DEFAULT_ITERATIONS,
  MAX_SIMULATOR_ITERATIONS,
  SIMULATOR_TEAM_DETAIL_MAX_ITERATIONS,
  clampSimulatorIterations,
  isLightweightSimulatorRun,
  prepareSimulatorContext,
  computeSimulatorResultDeltas,
};

/** @deprecated Use getOutcomeHistoryYears from historicalOutcomeData instead. */
export function getSimulatorRequiredYears() {
  return [];
}

function canUseWorker() {
  return typeof Worker !== 'undefined' && typeof window !== 'undefined';
}

function createWorkerContext(ctx) {
  return {
    ...ctx,
    weekBuffers: Array.from({ length: 17 }, () => ({})),
    seasonTotals: {},
    rolls: {},
    playoffRolls: {},
  };
}

function runInWorker(ctx, iterations, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./simulatorWorker.js', import.meta.url));
    let settled = false;

    const cleanup = () => {
      worker.terminate();
    };

    worker.onmessage = (event) => {
      const { type, progress, result, message } = event.data || {};
      if (type === 'progress') {
        if (onProgress) onProgress(progress);
        return;
      }
      if (type === 'done') {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(result);
        }
        return;
      }
      if (type === 'error') {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(message || 'Worker simulation failed'));
        }
      }
    };

    worker.onerror = (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    };

    worker.postMessage({
      ctx: createWorkerContext(ctx),
      iterations,
    });
  });
}

async function runOnMainThread(ctx, iterations, onProgress) {
  const lightweight = isLightweightSimulatorRun(iterations);
  const batchSize = lightweight ? LIGHTWEIGHT_BATCH_SIZE : BATCH_SIZE;
  const workerCtx = createWorkerContext(ctx);
  const state = createSimulationState(workerCtx, lightweight);

  let lastReportedProgress = 0;

  while (state.completed < iterations) {
    const batchEnd = Math.min(state.completed + batchSize, iterations);
    const batchCount = batchEnd - state.completed;

    runSimulationIterations(workerCtx, state, {
      count: batchCount,
      startIndex: state.completed,
      lightweight,
      onProgress: null,
      totalIterations: iterations,
    });

    if (onProgress) {
      const progress = state.completed / iterations;
      if (progress - lastReportedProgress >= 0.005 || state.completed === iterations) {
        lastReportedProgress = progress;
        onProgress(progress);
      }
    }

    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return finalizeSimulationState(state, iterations, ctx.rosterIds);
}

/**
 * @returns {Promise<{ results, baselineResults, resultDeltas, teamFinishBuckets }>}
 */
export async function runMonteCarloSimulation(
  ctx,
  _playersData,
  _playerIdMap,
  {
    iterations = DEFAULT_ITERATIONS,
    onProgress,
    useWorker = true,
  } = {},
) {
  const clamped = clampSimulatorIterations(iterations);

  if (useWorker && canUseWorker()) {
    try {
      return await runInWorker(ctx, clamped, onProgress);
    } catch (err) {
      console.warn('Simulator worker failed, falling back to main thread:', err);
    }
  }

  return runOnMainThread(ctx, clamped, onProgress);
}
