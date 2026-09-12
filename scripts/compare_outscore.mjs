/**
 * How often team A outscores team B on the same weekly draws.
 *
 *   node scripts/compare_outscore.mjs --a 5 --b 4 --iterations 250000
 */
import { readFileSync } from 'fs';
import { cpus } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!isMainThread) {
  process.env.REACT_APP_SITE_SETTINGS = workerData.siteSettings;
  process.env.DATA_DIR = workerData.dataDir;
  const { prepareSimContext, runPairOutscore } = await import('../site/lib/mcp/simEngine.mjs');
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
    const result = runPairOutscore(ctx, msg.rosterIdA, msg.rosterIdB, msg.iterations, {
      uncapped: true,
      onProgress: (progress) => parentPort.postMessage({ type: 'progress', progress }),
    });
    parentPort.postMessage({ type: 'done', ...result });
  });
  parentPort.postMessage({ type: 'ready' });
} else {
  const SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');
  const DATA_DIR = join(ROOT, 'site', 'public', 'data');
  process.env.REACT_APP_SITE_SETTINGS = SITE_SETTINGS;
  process.env.DATA_DIR = DATA_DIR;

  function parseArgs(argv) {
    const out = {
      iterations: 250_000,
      workers: Math.max(1, (cpus()?.length || 2) - 1),
      a: 5,
      b: 4,
    };
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      const next = argv[i + 1];
      if (arg === '--iterations' && next) {
        out.iterations = Math.max(1, Math.round(Number(next)));
        i += 1;
      } else if (arg === '--workers' && next) {
        out.workers = Math.max(1, Math.round(Number(next)));
        i += 1;
      } else if (arg === '--a' && next) {
        out.a = Number(next);
        i += 1;
      } else if (arg === '--b' && next) {
        out.b = Number(next);
        i += 1;
      }
    }
    return out;
  }

  function splitIterations(total, workerCount) {
    const n = Math.min(workerCount, total);
    const base = Math.floor(total / n);
    const extra = total % n;
    return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
  }

  function runWorker(payload, onProgress) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const worker = new Worker(fileURLToPath(import.meta.url), {
        workerData: { siteSettings: SITE_SETTINGS, dataDir: DATA_DIR },
      });
      worker.on('message', (msg) => {
        if (msg?.type === 'ready') {
          worker.postMessage(payload);
          return;
        }
        if (msg?.type === 'progress') {
          onProgress?.(msg.progress, payload.workerIndex);
          return;
        }
        if (msg?.type === 'done') {
          settled = true;
          resolve(msg);
          worker.terminate();
        }
      });
      worker.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      worker.on('exit', (code) => {
        if (!settled && code !== 0) reject(new Error(`worker exited ${code}`));
      });
    });
  }

  const { iterations, workers, a: rosterIdA, b: rosterIdB } = parseArgs(process.argv.slice(2));
  const { CURRENT_YEAR } = await import('../site/lib/mcp/config.mjs');
  const { fetchRosters, fetchUsers } = await import('../site/lib/mcp/sleeperApi.mjs');
  const { buildTeamMap } = await import('../site/lib/mcp/helpers.mjs');
  const { loadSimulationInputs } = await import('../site/lib/mcp/simData.mjs');

  const rosterMap = {};
  console.log(`Loading ${CURRENT_YEAR} Hwang Dynasty rosters…`);
  const [rosters, users, inputs] = await Promise.all([
    fetchRosters(),
    fetchUsers(),
    loadSimulationInputs(),
  ]);
  const teamMap = buildTeamMap(rosters, users);
  for (const r of rosters) {
    if (r?.roster_id != null) rosterMap[Number(r.roster_id)] = [...(r.players || [])];
  }
  const nameA = teamMap[rosterIdA]?.teamName || `Team ${rosterIdA}`;
  const nameB = teamMap[rosterIdB]?.teamName || `Team ${rosterIdB}`;
  console.log(`Comparing ${nameA} vs ${nameB} over ${iterations.toLocaleString()} runs`);

  const simPayload = {
    scenarioRosters: rosterMap,
    hwangAdpRankMap: inputs.hwangAdpRankMap,
    catalog: inputs.catalog,
    positionMaxRanks: inputs.positionMaxRanks,
    basePointsByYear: inputs.basePointsByYear,
    variance: 'openTail',
    monotone: 'quantiles',
    rosterIdA,
    rosterIdB,
  };

  const chunks = splitIterations(iterations, workers);
  const progressByWorker = Array.from({ length: chunks.length }, () => 0);
  let lastPct = -1;
  const startedRun = Date.now();

  function reportProgress() {
    const weighted = chunks.reduce((sum, n, i) => sum + n * progressByWorker[i], 0) / iterations;
    const pct = Math.floor(weighted * 100);
    if (pct === lastPct) return;
    lastPct = pct;
    const elapsed = (Date.now() - startedRun) / 1000;
    const eta = weighted > 0.01 ? (elapsed / weighted) * (1 - weighted) : 0;
    process.stdout.write(`\r  ${pct}%  elapsed ${elapsed.toFixed(0)}s  eta ${eta.toFixed(0)}s   `);
  }

  const batches = await Promise.all(chunks.map((n, workerIndex) => runWorker(
    { ...simPayload, iterations: n, workerIndex },
    (progress, idx) => {
      progressByWorker[idx] = progress;
      reportProgress();
    },
  )));

  process.stdout.write('\n');
  const merge = (key) => batches.reduce((acc, b) => ({
    a: acc.a + b[key].a,
    b: acc.b + b[key].b,
    tie: acc.tie + b[key].tie,
  }), { a: 0, b: 0, tie: 0 });
  const reg = merge('reg');
  const total = merge('total');
  const pct = (n) => `${(n / iterations * 100).toFixed(1)}%`;
  const elapsed = ((Date.now() - startedRun) / 1000).toFixed(1);

  console.log(`${nameA} vs ${nameB} — ${iterations.toLocaleString()} runs (${elapsed}s)`);
  console.log('14-week (regular season)');
  console.log(`  ${nameA} outscores:  ${reg.a.toLocaleString()}  (${pct(reg.a)})`);
  console.log(`  ${nameB} outscores:  ${reg.b.toLocaleString()}  (${pct(reg.b)})`);
  console.log(`  Tie:                ${reg.tie.toLocaleString()}  (${pct(reg.tie)})`);
  console.log('Full season (17 weeks)');
  console.log(`  ${nameA} outscores:  ${total.a.toLocaleString()}  (${pct(total.a)})`);
  console.log(`  ${nameB} outscores:  ${total.b.toLocaleString()}  (${pct(total.b)})`);
  console.log(`  Tie:                ${total.tie.toLocaleString()}  (${pct(total.tie)})`);
}
