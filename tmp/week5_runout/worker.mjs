/**
 * One worker: full-season preseason sim, keep each roster's weeks 1–5 total.
 */
import { parentPort, workerData } from 'worker_threads';

process.env.REACT_APP_SITE_SETTINGS = workerData.siteSettings;
process.env.DATA_DIR = workerData.dataDir;

const {
  prepareSimContext,
  randomPercentile,
  percentileToOutcomeIndex,
  selectPlayoffOutcome,
  computeOptimalWeekStarterTotal,
} = await import('../../site/lib/mcp/simEngine.mjs');
const { loadPlayersData } = await import('../../site/lib/mcp/dataLoader.mjs');

const NUM_WEEKS = 17;
const REG_SEASON_WEEKS = 14;
const WINDOW = 5;

function fillWeekly(ctx) {
  const {
    allPlayerIds, pools, poolCumWeights, outcomeWeekPts, playoffIndex,
    playerPositions, weekBuffers, seasonTotals, rolls, playoffRolls,
  } = ctx;
  for (const pid of allPlayerIds) {
    const poolLen = pools[pid]?.length ?? 0;
    if (poolLen === 0) {
      for (let wi = 0; wi < NUM_WEEKS; wi++) weekBuffers[wi][pid] = 0;
      seasonTotals[pid] = 0;
      continue;
    }
    const pct = rolls[pid] ?? 50;
    const idx = percentileToOutcomeIndex(pct, poolLen, poolCumWeights[pid]);
    const ptsArr = outcomeWeekPts[pid][idx];
    let total = 0;
    let reg = 0;
    for (let wi = 0; wi < REG_SEASON_WEEKS; wi++) {
      const p = ptsArr ? ptsArr[wi] : 0;
      weekBuffers[wi][pid] = p;
      total += p;
      reg += p;
    }
    const pos = playerPositions[pid];
    const poSel = playoffIndex
      ? selectPlayoffOutcome(playoffIndex, pos, reg, (playoffRolls || {})[pid] ?? 50)
      : { outcome: null };
    const po = poSel.outcome?.po;
    for (let k = 0; k < 3; k++) {
      const p = po ? po[k] : (ptsArr ? (ptsArr[REG_SEASON_WEEKS + k] || 0) : 0);
      weekBuffers[REG_SEASON_WEEKS + k][pid] = p;
      total += p;
    }
    seasonTotals[pid] = total;
  }
}

function windowTotal(ctx, playerList, weeks) {
  let sum = 0;
  for (let wi = 0; wi < weeks; wi++) {
    sum += computeOptimalWeekStarterTotal(
      playerList,
      ctx.weekBuffers[wi],
      ctx.playerPositions,
      ctx.seasonTotals,
    );
  }
  return Math.round(sum * 10) / 10;
}

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
  if (!ctx.playoffRolls) ctx.playoffRolls = {};

  const n = msg.iterations;
  const samples5 = {};
  const samples14 = {};
  for (const rid of ctx.rosterIds) {
    samples5[rid] = new Float64Array(n);
    samples14[rid] = new Float64Array(n);
  }

  const progressEvery = Math.max(1, Math.floor(n / 20));
  for (let i = 0; i < n; i++) {
    for (const pid of ctx.allPlayerIds) {
      ctx.rolls[pid] = randomPercentile();
      ctx.playoffRolls[pid] = randomPercentile();
    }
    fillWeekly(ctx);
    for (const rid of ctx.rosterIds) {
      const list = ctx.scenarioRosters[rid] || ctx.scenarioRosters[String(rid)] || [];
      samples5[rid][i] = windowTotal(ctx, list, 5);
      samples14[rid][i] = windowTotal(ctx, list, 14);
    }
    if ((i + 1) % progressEvery === 0 || i + 1 === n) {
      parentPort.postMessage({ type: 'progress', progress: (i + 1) / n });
    }
  }

  const out = {};
  for (const rid of ctx.rosterIds) {
    out[rid] = { w5: Array.from(samples5[rid]), w14: Array.from(samples14[rid]) };
  }
  parentPort.postMessage({ type: 'done', iterations: n, samples: out });
});

parentPort.postMessage({ type: 'ready' });
