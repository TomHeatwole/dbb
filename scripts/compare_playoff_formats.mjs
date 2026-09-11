/**
 * Same weekly draws, scored under 2024 cumulative and 2025 bracket.
 * Counts how often 1st and 2nd place disagree.
 *
 *   node scripts/compare_playoff_formats.mjs
 *   node scripts/compare_playoff_formats.mjs --iterations 250000
 */
import { readFileSync } from 'fs';
import { cpus } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_PATH = join(ROOT, 'scripts', 'compare_playoff_formats_worker.mjs');
const SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');
const DATA_DIR = join(ROOT, 'site', 'public', 'data');

process.env.REACT_APP_SITE_SETTINGS = SITE_SETTINGS;
process.env.DATA_DIR = DATA_DIR;

function parseArgs(argv) {
  const out = { iterations: 250_000, workers: Math.max(1, (cpus()?.length || 2) - 1) };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--iterations' && next) {
      out.iterations = Math.max(1, Math.round(Number(next)));
      i += 1;
    } else if (arg === '--workers' && next) {
      out.workers = Math.max(1, Math.round(Number(next)));
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

function mergePairs(batches, key) {
  const out = {};
  for (const batch of batches) {
    for (const [pair, count] of Object.entries(batch[key] || {})) {
      out[pair] = (out[pair] || 0) + count;
    }
  }
  return out;
}

function formatPairs(pairs, teamMap, iterations, limit = 8) {
  return Object.entries(pairs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => {
      const [from, to] = key.split('->');
      const a = teamMap[Number(from)]?.teamName || from;
      const b = teamMap[Number(to)]?.teamName || to;
      return `  ${a} → ${b}   ${(count / iterations * 100).toFixed(1)}%  (${count.toLocaleString()})`;
    })
    .join('\n');
}

function runWorker(payload, onProgress) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_PATH, {
      workerData: {
        siteSettings: SITE_SETTINGS,
        dataDir: DATA_DIR,
      },
    });
    worker.on('message', (msg) => {
      if (msg?.type === 'ready') {
        worker.postMessage({
          scenarioRosters: payload.scenarioRosters,
          hwangAdpRankMap: payload.hwangAdpRankMap,
          catalog: payload.catalog,
          positionMaxRanks: payload.positionMaxRanks,
          basePointsByYear: payload.basePointsByYear,
          variance: payload.variance,
          monotone: payload.monotone,
          iterations: payload.iterations,
        });
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

const { iterations, workers } = parseArgs(process.argv.slice(2));

const { CURRENT_YEAR } = await import('../site/lib/mcp/config.mjs');
const { fetchRosters, fetchUsers } = await import('../site/lib/mcp/sleeperApi.mjs');
const { buildTeamMap } = await import('../site/lib/mcp/helpers.mjs');
const { loadSimulationInputs } = await import('../site/lib/mcp/simData.mjs');

const rosterMap = {};
console.log(`Loading ${CURRENT_YEAR} Hwang Dynasty rosters and sim inputs…`);
const startedLoad = Date.now();
const [rosters, users, inputs] = await Promise.all([
  fetchRosters(),
  fetchUsers(),
  loadSimulationInputs(),
]);
const teamMap = buildTeamMap(rosters, users);
for (const r of rosters) {
  if (r?.roster_id != null) rosterMap[Number(r.roster_id)] = [...(r.players || [])];
}
console.log(`Loaded ${Object.keys(rosterMap).length} rosters in ${((Date.now() - startedLoad) / 1000).toFixed(1)}s`);

const simPayload = {
  scenarioRosters: rosterMap,
  hwangAdpRankMap: inputs.hwangAdpRankMap,
  catalog: inputs.catalog,
  positionMaxRanks: inputs.positionMaxRanks,
  basePointsByYear: inputs.basePointsByYear,
  variance: 'openTail',
  monotone: 'quantiles',
};

const chunks = splitIterations(iterations, workers);
console.log(`Comparing cumulative vs bracket on ${iterations.toLocaleString()} paired runs…`);

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
const differentWinner = batches.reduce((s, b) => s + (b.differentWinner || 0), 0);
const differentSecond = batches.reduce((s, b) => s + (b.differentSecond || 0), 0);
const differentBoth = batches.reduce((s, b) => s + (b.differentBoth || 0), 0);
const winnerPairs = mergePairs(batches, 'winnerPairs');
const secondPairs = mergePairs(batches, 'secondPairs');
const elapsed = ((Date.now() - startedRun) / 1000).toFixed(1);

const pct = (n) => `${(n / iterations * 100).toFixed(1)}%`;
console.log(`Paired format comparison — ${iterations.toLocaleString()} runs (${elapsed}s)`);
console.log(`  Different winner:     ${differentWinner.toLocaleString()}  (${pct(differentWinner)})`);
console.log(`  Different 2nd place:  ${differentSecond.toLocaleString()}  (${pct(differentSecond)})`);
console.log(`  Both 1st and 2nd:     ${differentBoth.toLocaleString()}  (${pct(differentBoth)})`);
console.log(`  Only winner differs:  ${(differentWinner - differentBoth).toLocaleString()}  (${pct(differentWinner - differentBoth)})`);
console.log(`  Only 2nd differs:     ${(differentSecond - differentBoth).toLocaleString()}  (${pct(differentSecond - differentBoth)})`);
console.log('\nMost common champion flips (cumulative → bracket)');
console.log(formatPairs(winnerPairs, teamMap, iterations));
console.log('\nMost common 2nd-place flips (cumulative → bracket)');
console.log(formatPairs(secondPairs, teamMap, iterations));
