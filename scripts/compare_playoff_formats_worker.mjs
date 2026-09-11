/**
 * Worker for scripts/compare_playoff_formats.mjs
 */
import { parentPort, workerData } from 'worker_threads';

process.env.REACT_APP_SITE_SETTINGS = workerData.siteSettings;
process.env.DATA_DIR = workerData.dataDir;

const { prepareSimContext, runPlayoffFormatDisagreement } = await import('../site/lib/mcp/simEngine.mjs');
const { loadPlayersData } = await import('../site/lib/mcp/dataLoader.mjs');

parentPort.on('message', (msg) => {
  const playersData = loadPlayersData();
  const ctx = prepareSimContext({
    scenarioRosters: msg.scenarioRosters,
    hwangAdpRankMap: msg.hwangAdpRankMap,
    catalog: msg.catalog,
    positionMaxRanks: msg.positionMaxRanks,
    basePointsByYear: msg.basePointsByYear,
    playersData,
    variance: msg.variance,
    monotone: msg.monotone,
  });

  const result = runPlayoffFormatDisagreement(ctx, msg.iterations, {
    uncapped: true,
    onProgress: (progress) => {
      parentPort.postMessage({ type: 'progress', progress });
    },
  });

  parentPort.postMessage({ type: 'done', ...result });
});

parentPort.postMessage({ type: 'ready' });
