/**
 * Headless Hwang Dynasty season simulator — UI-equivalent aggregates only.
 *
 * Same engine / defaults as the Season Simulator page:
 *   current rosters, Hwang ADP, openTail, quantiles, cumulative playoffs.
 * Keeps the results table + per-team finish counts. Does not store per-sim
 * samples (same as the web UI at >5k runs).
 *
 * Usage (from repo root):
 *   node scripts/run_hwang_season_sim_1m.mjs
 *   node scripts/run_hwang_season_sim_1m.mjs --iterations 2000 --workers 1
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { cpus } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_PATH = join(ROOT, 'scripts', 'run_hwang_season_sim_1m_worker.mjs');
const OUT_DIR = join(ROOT, 'tmp', 'hwang_season_sim_1m');
const SITE_SETTINGS = readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8');
const DATA_DIR = join(ROOT, 'site', 'public', 'data');

process.env.REACT_APP_SITE_SETTINGS = SITE_SETTINGS;
process.env.DATA_DIR = DATA_DIR;

function parseArgs(argv) {
  const out = { iterations: 1_000_000, workers: Math.max(1, (cpus()?.length || 2) - 1) };
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

function emptyAcc(rosterId) {
  return {
    rosterId,
    wins: 0,
    bracketWins: 0,
    playoffCount: 0,
    placeSum: 0,
    regSeasonRankSum: 0,
    regSeasonSum: 0,
    playoffSum: 0,
    finishCounts: Array.from({ length: 10 }, () => 0),
    reg2000: 0,
    total2000: 0,
  };
}

function mergeResults(batches) {
  const byId = {};
  let iterations = 0;
  for (const batch of batches) {
    iterations += batch.iterations;
    for (const row of batch.results) {
      const acc = byId[row.rosterId] || emptyAcc(row.rosterId);
      acc.wins += row.wins || 0;
      acc.bracketWins += row.bracketWins || 0;
      acc.playoffCount += row.playoffCount || 0;
      acc.placeSum += (row.avgFinish || 0) * batch.iterations;
      acc.regSeasonRankSum += (row.avgRegSeasonRank || 0) * batch.iterations;
      acc.regSeasonSum += (row.avgRegSeason || 0) * batch.iterations;
      acc.playoffSum += (row.avgPlayoff || 0) * batch.iterations;
      for (let i = 0; i < 10; i++) {
        acc.finishCounts[i] += (row.finishCounts && row.finishCounts[i]) || 0;
      }
      acc.reg2000 += row.reg2000 || 0;
      acc.total2000 += row.total2000 || 0;
      byId[row.rosterId] = acc;
    }
  }

  return Object.values(byId).map((acc) => {
    const avgRegSeason = acc.regSeasonSum / iterations;
    const avgPlayoff = acc.playoffSum / iterations;
    return {
      rosterId: acc.rosterId,
      wins: acc.wins,
      bracketWins: acc.bracketWins,
      playoffCount: acc.playoffCount,
      winPct: (acc.wins / iterations) * 100,
      bracketWinPct: (acc.bracketWins / iterations) * 100,
      playoffPct: (acc.playoffCount / iterations) * 100,
      avgFinish: acc.placeSum / iterations,
      avgRegSeasonRank: acc.regSeasonRankSum / iterations,
      avgRegSeason,
      avgPlayoff,
      avgTotalScore: avgRegSeason + avgPlayoff,
      finishCounts: acc.finishCounts,
      reg2000: acc.reg2000,
      total2000: acc.total2000,
      reg2000Pct: (acc.reg2000 / iterations) * 100,
      total2000Pct: (acc.total2000 / iterations) * 100,
    };
  }).sort((a, b) => {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    return b.avgTotalScore - a.avgTotalScore;
  });
}

function formatTable(results, teamMap, iterations) {
  const rows = results.map((row, i) => {
    const info = teamMap[row.rosterId] || {};
    return {
      rank: i + 1,
      team: info.teamName || `Team ${row.rosterId}`,
      owner: info.ownerName || '?',
      winPct: row.winPct,
      bracketWinPct: row.bracketWinPct,
      playoffPct: row.playoffPct,
      wins: row.wins,
      bracketWins: row.bracketWins,
      avgFinish: row.avgFinish,
      avgRegSeasonRank: row.avgRegSeasonRank,
      avgRegSeason: row.avgRegSeason,
      avgPlayoff: row.avgPlayoff,
      avgTotalScore: row.avgTotalScore,
      playoffCount: row.playoffCount,
      finishCounts: row.finishCounts,
      reg2000Pct: row.reg2000Pct,
      total2000Pct: row.total2000Pct,
    };
  });

  const header = [
    '#',
    'Team',
    'Win % (Cumulative)',
    'Win % (2025 Bracket)',
    'Playoff %',
    'Avg Finish',
    'Avg Reg Seed',
    'Avg 14 Wk',
    'Avg Playoff',
    'Avg Total',
  ];
  const body = rows.map((r) => [
    `${r.rank}.`,
    r.team,
    `${r.winPct.toFixed(1)}%`,
    `${(r.bracketWinPct ?? 0).toFixed(1)}%`,
    `${r.playoffPct.toFixed(1)}%`,
    r.avgFinish.toFixed(2),
    r.avgRegSeasonRank.toFixed(2),
    r.avgRegSeason.toFixed(1),
    r.avgPlayoff.toFixed(1),
    r.avgTotalScore.toFixed(1),
  ]);
  const widths = header.map((h, col) => Math.max(h.length, ...body.map((row) => String(row[col]).length)));
  const fmt = (cells) => cells.map((c, i) => String(c)[i <= 1 ? 'padEnd' : 'padStart'](widths[i])).join('  ');
  const lines = [
    `Simulation Results — ${iterations.toLocaleString()} runs · sorted by cumulative win %`,
    fmt(header),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...body.map(fmt),
  ];
  const csvEscape = (value) => {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...body].map((cells) => cells.map(csvEscape).join(',')).join('\n');
  return { rows, text: lines.join('\n'), csv };
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

function buildRosterMapFromSleeper(rosters) {
  const map = {};
  for (const r of rosters) {
    if (r?.roster_id != null) map[Number(r.roster_id)] = [...(r.players || [])];
  }
  return map;
}

console.log(`Loading ${CURRENT_YEAR} Hwang Dynasty rosters and sim inputs…`);
const startedLoad = Date.now();
const [rosters, users, inputs] = await Promise.all([
  fetchRosters(),
  fetchUsers(),
  loadSimulationInputs(),
]);
const teamMap = buildTeamMap(rosters, users);
const rosterMap = buildRosterMapFromSleeper(rosters);
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
console.log(`Running ${iterations.toLocaleString()} simulations across ${chunks.length} worker(s)…`);

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
const merged = mergeResults(batches);
const elapsedMs = Date.now() - startedRun;
const { rows, text, csv } = formatTable(merged, teamMap, iterations);
console.log(text);
console.log('\nShare of runs scoring 2000+');
console.log('Team                        14-wk ≥2000   Season ≥2000');
for (const row of rows) {
  const r14 = row.reg2000Pct == null ? '—' : `${row.reg2000Pct.toFixed(1)}%`;
  const rTot = row.total2000Pct == null ? '—' : `${row.total2000Pct.toFixed(1)}%`;
  console.log(`  ${String(row.team).padEnd(26)} ${r14.padStart(11)}  ${rTot.padStart(12)}`);
}

mkdirSync(OUT_DIR, { recursive: true });
const payload = {
  meta: {
    season: CURRENT_YEAR,
    iterations,
    workers: chunks.length,
    variance: 'openTail',
    monotone: 'quantiles',
    rankSource: 'adp',
    playoffFormat: 'cumulative + 2025 bracket win %',
    elapsedMs,
    savedAt: new Date().toISOString(),
  },
  results: rows,
};
writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(payload, null, 2));
writeFileSync(join(OUT_DIR, 'results.txt'), `${text}\n`);
writeFileSync(join(OUT_DIR, 'results.csv'), `${csv}\n`);
console.log(`\nSaved table to ${join(OUT_DIR, 'results.csv')} (${(elapsedMs / 1000).toFixed(1)}s)`);
