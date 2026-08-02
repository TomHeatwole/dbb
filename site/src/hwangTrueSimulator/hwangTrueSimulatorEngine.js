/**
 * hwangTrueSimulatorEngine.js
 *
 * In-browser engine for the Hwang True Simulator.
 *
 * For each season (2021–2025) and each real Hwang roster archetype:
 *   1. Instantiate the archetype onto that season's preseason Final KTC board
 *      N times (jittered builds; deterministic single build when jitter = 0)
 *      and drop the lowest-value slot of the deepest position group → the
 *      26-man HVORP base.
 *   2. Take the season's top-300 Final KTC players, find every cross-position
 *      pair within ±5% KTC value of each other (symmetric: |a−b| ≤ 5% of mid).
 *   3. Plug each paired player into each build's base roster and measure true
 *      roster HVORP: the change in optimal weekly starter totals across all
 *      17 weeks (leave-one-out if the player is already on the base).
 *   4. Accumulate total HVORP per position group within each matchup
 *      (QB vs RB, QB vs WR, … WR vs TE) → total relative difference.
 *
 * Lineup slots and reception scoring are configurable per run:
 *   - slotCounts: { QB, RB, WR, TE, FLEX, SUPER } (default from
 *     STARTER_POSITION_NAMES → 1QB/3RB/3WR/1TE/2FLEX/1SUPER)
 *   - ppr: base points per reception for all positions (Hwang default 0)
 *   - tePremium: extra points per TE reception on top of ppr (Hwang default 0.5)
 * Everything else comes from the league score_format.json applied to Sleeper
 * weekly stats, identical to the Pos Value Compare pipeline.
 */

import { calculateFantasyPoints } from '../data_parse/fantasyCalculator';
import { fetchWeeklyStats, clearStatsCache } from '../data_parse/weeklyStatsLoader';
import { mapSleeperStats } from '../scenarios/sleeperScoring';
import {
  filterTopKtcPlayers,
  hvorpPctDelta,
  TOP_KTC_RANK,
} from '../posValueCompare/posValueCompareMetrics';
import {
  buildSeasonBoards,
  findDropSlotIndex,
  instantiateArchetype,
  mulberry32,
  parseCsv,
} from '../archetypeRosterBuilder/archetypeRosterGenerator';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';

export const SIM_YEARS = [2021, 2022, 2023, 2024, 2025];
export const PAIR_TOLERANCE_PCT = 5;
export const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
export const DEFAULT_BUILDS_PER_ARCHETYPE = 10;
export const DEFAULT_JITTER_PCT = 10;
const NUM_WEEKS = 17;
/** Full per-build roster detail is kept for this many builds per archetype;
 *  beyond that only the aggregates accumulate (keeps 1000-build runs in memory). */
const MAX_STORED_BUILDS = 10;

// ── Starter slot structure ────────────────────────────────────────────────────

function parseSlotCounts(names) {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPER: 0 };
  for (const raw of names || []) {
    const name = String(raw).toUpperCase();
    if (name.startsWith('SUPER')) counts.SUPER += 1;
    else if (name.startsWith('FLEX')) counts.FLEX += 1;
    else {
      const pos = name.replace(/\d+$/, '');
      if (counts[pos] != null) counts[pos] += 1;
    }
  }
  return counts;
}

/** League default lineup (Hwang): 1QB/3RB/3WR/1TE/2FLEX/1SUPER. */
export const SLOT_COUNTS = parseSlotCounts(STARTER_POSITION_NAMES);

// ── Scoring config ────────────────────────────────────────────────────────────

/** Override reception scoring: ppr for everyone, ppr + tePremium for TEs. */
export function applyReceptionScoring(scoringConfig, ppr, tePremium) {
  return {
    ...scoringConfig,
    scoring: { ...scoringConfig.scoring, receptions: ppr },
    position_specific_scoring: {
      ...scoringConfig.position_specific_scoring,
      receptions: { QB: ppr, RB: ppr, WR: ppr, TE: ppr + tePremium },
    },
  };
}

// ── Matchup keys ──────────────────────────────────────────────────────────────

export function matchupCombos() {
  const combos = [];
  for (let i = 0; i < POSITIONS.length; i += 1) {
    for (let j = i + 1; j < POSITIONS.length; j += 1) {
      combos.push({
        posA: POSITIONS[i],
        posB: POSITIONS[j],
        pairKey: `${POSITIONS[i]}_vs_${POSITIONS[j]}`,
        label: `${POSITIONS[i]} vs ${POSITIONS[j]}`,
      });
    }
  }
  return combos;
}

function emptyMatchups() {
  const out = {};
  for (const combo of matchupCombos()) {
    out[combo.pairKey] = { ...combo, count: 0, totalA: 0, totalB: 0 };
  }
  return out;
}

function accumulateMatchups(target, source) {
  for (const [key, m] of Object.entries(source)) {
    target[key].count += m.count;
    target[key].totalA += m.totalA;
    target[key].totalB += m.totalB;
  }
}

function finalizeMatchups(matchups) {
  const out = {};
  for (const [key, m] of Object.entries(matchups)) {
    out[key] = {
      ...m,
      totalA: Math.round(m.totalA * 10) / 10,
      totalB: Math.round(m.totalB * 10) / 10,
      relDiffPct: m.count > 0 ? hvorpPctDelta(m.totalA, m.totalB) : null,
    };
  }
  return out;
}

/** QB-grounded multipliers from total HVORP in QB-vs-pos matchups. */
function computeMultipliersFromTotals(matchups) {
  const byPosition = { QB: 1 };
  for (const pos of ['RB', 'WR', 'TE']) {
    const m = matchups[`QB_vs_${pos}`];
    byPosition[pos] = m && m.totalA > 0
      ? Math.round((m.totalB / m.totalA) * 1000) / 1000
      : null;
  }
  return byPosition;
}

// ── Optimal lineup (points-only) ──────────────────────────────────────────────
//
// Week arrays hold only positive point values, sorted desc, so an unfilled
// slot contributes 0 (a manager would bench any negative scorer).

function topRemainder(arr, skip, take) {
  const out = [];
  for (let i = skip; i < arr.length && out.length < take; i += 1) out.push(arr[i]);
  return out;
}

export function optimalTotal(posArrays, slotCounts = SLOT_COUNTS) {
  const { QB: nQb, RB: nRb, WR: nWr, TE: nTe, FLEX: nFlex, SUPER: nSuper } = slotCounts;
  const qb = posArrays.QB;
  const rb = posArrays.RB;
  const wr = posArrays.WR;
  const te = posArrays.TE;

  let total = 0;
  for (let i = 0; i < nQb && i < qb.length; i += 1) total += qb[i];
  for (let i = 0; i < nRb && i < rb.length; i += 1) total += rb[i];
  for (let i = 0; i < nWr && i < wr.length; i += 1) total += wr[i];
  for (let i = 0; i < nTe && i < te.length; i += 1) total += te[i];

  // FLEX pool: best remaining RB/WR/TE. SUPER: best remaining incl. QB.
  const need = nFlex + nSuper;
  const pool = [
    ...topRemainder(rb, nRb, need),
    ...topRemainder(wr, nWr, need),
    ...topRemainder(te, nTe, need),
  ].sort((a, b) => b - a);

  for (let i = 0; i < nFlex && i < pool.length; i += 1) total += pool[i];

  for (let s = 0; s < nSuper; s += 1) {
    const qbNext = qb[nQb + s] ?? -Infinity;
    const flexNext = pool[nFlex + s] ?? -Infinity;
    const best = Math.max(qbNext, flexNext);
    if (best > 0) total += best;
  }

  return total;
}

function insertSortedDesc(arr, value) {
  const out = arr.slice();
  let lo = 0;
  let hi = out.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (out[mid] >= value) lo = mid + 1;
    else hi = mid;
  }
  out.splice(lo, 0, value);
  return out;
}

function removeValue(arr, value) {
  const idx = arr.indexOf(value);
  if (idx === -1) return arr;
  const out = arr.slice();
  out.splice(idx, 1);
  return out;
}

// ── Weekly points ─────────────────────────────────────────────────────────────

async function buildYearWeeklyPoints(year, positionsById, scoringConfig, onWeekDone) {
  const ptsById = new Map();
  for (let week = 1; week <= NUM_WEEKS; week += 1) {
    const weekly = await fetchWeeklyStats(year, week);
    for (const [pid, position] of positionsById.entries()) {
      const stats = weekly ? weekly[pid] : null;
      if (!stats || typeof stats !== 'object') continue;
      const points = calculateFantasyPoints(mapSleeperStats(stats, position), scoringConfig);
      if (!ptsById.has(pid)) ptsById.set(pid, new Float64Array(NUM_WEEKS));
      ptsById.get(pid)[week - 1] = points;
    }
    if (onWeekDone) onWeekDone(week);
    if (week < NUM_WEEKS) await new Promise((r) => setTimeout(r, 50));
  }
  return ptsById;
}

function seasonTotal(ptsById, pid) {
  const pts = ptsById.get(pid);
  if (!pts) return 0;
  let total = 0;
  for (let w = 0; w < NUM_WEEKS; w += 1) total += pts[w];
  return Math.round(total * 10) / 10;
}

// ── Roster HVORP ──────────────────────────────────────────────────────────────

function buildBaseWeekArrays(basePlayers, ptsById) {
  const weeks = Array.from({ length: NUM_WEEKS }, () => ({ QB: [], RB: [], WR: [], TE: [] }));
  for (const player of basePlayers) {
    const pts = ptsById.get(player.sleeperId);
    if (!pts) continue;
    for (let w = 0; w < NUM_WEEKS; w += 1) {
      if (pts[w] > 0) weeks[w][player.position].push(pts[w]);
    }
  }
  for (const week of weeks) {
    for (const pos of POSITIONS) week[pos].sort((a, b) => b - a);
  }
  return weeks;
}

/**
 * True roster HVORP for one player against a base roster:
 * Σ over weeks of optimal(base ∪ player) − optimal(base ∖ player).
 * Reduces to add-on value off-roster and leave-one-out value on-roster.
 */
function evalPlayerHvorp(playerId, position, inBase, weekArrays, baseTotals, ptsById, slotCounts) {
  const pts = ptsById.get(playerId);
  if (!pts) return 0;
  let hvorp = 0;
  for (let w = 0; w < NUM_WEEKS; w += 1) {
    const p = pts[w];
    if (p <= 0) continue; // a non-positive week never changes the optimal lineup
    const arrays = weekArrays[w];
    if (inBase) {
      const without = { ...arrays, [position]: removeValue(arrays[position], p) };
      hvorp += baseTotals[w] - optimalTotal(without, slotCounts);
    } else {
      const withCand = { ...arrays, [position]: insertSortedDesc(arrays[position], p) };
      hvorp += optimalTotal(withCand, slotCounts) - baseTotals[w];
    }
  }
  return Math.round(hvorp * 10) / 10;
}

// ── Pair finding ──────────────────────────────────────────────────────────────

export function findValuePairs(candidates, tolerancePct = PAIR_TOLERANCE_PCT) {
  const byPos = { QB: [], RB: [], WR: [], TE: [] };
  for (const c of candidates) byPos[c.position].push(c);

  const pairs = [];
  for (const combo of matchupCombos()) {
    for (const a of byPos[combo.posA]) {
      for (const b of byPos[combo.posB]) {
        const mid = (a.value + b.value) / 2;
        if (mid <= 0) continue;
        if (Math.abs(a.value - b.value) <= (tolerancePct / 100) * mid) {
          pairs.push({ pairKey: combo.pairKey, a, b });
        }
      }
    }
  }
  return pairs;
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadSimInputs() {
  const [archRes, ktcRes, scoreRes, metaRes] = await Promise.all([
    fetch('/data/archetype_rosters.csv'),
    fetch('/data/final_ktc_values.csv'),
    fetch('/data/score_format.json'),
    fetch('/data/archetype_rosters_meta.json'),
  ]);
  if (!archRes.ok) throw new Error('Failed to fetch archetype_rosters.csv — run build_archetype_rosters.js');
  if (!ktcRes.ok) throw new Error('Failed to fetch final_ktc_values.csv');
  if (!scoreRes.ok) throw new Error('Failed to fetch score_format.json');

  const archetypeRows = parseCsv(await archRes.text());
  const finalKtcRows = parseCsv(await ktcRes.text());
  const scoringConfig = await scoreRes.json();
  const meta = metaRes.ok ? await metaRes.json() : null;

  return { archetypeRows, finalKtcRows, scoringConfig, meta };
}

function buildArchetypes(archetypeRows) {
  const byId = new Map();
  for (const row of archetypeRows) {
    if (!byId.has(row.archetype_id)) {
      const record = row.rank_basis === 'standings' ? ` (${row.wins}-${row.losses})` : '';
      byId.set(row.archetype_id, {
        archetypeId: row.archetype_id,
        label: `${row.season} #${row.finish_rank} — ${row.team_name}${record}`,
        season: row.season,
        finishRank: Number(row.finish_rank),
        teamName: row.team_name,
        slots: [],
      });
    }
    byId.get(row.archetype_id).slots.push({
      playerName: row.player_name,
      position: row.position,
      posRank: row.ktc_pos_rank ? Number(row.ktc_pos_rank) : null,
      ktcValue: row.ktc_value ? Number(row.ktc_value) : null,
    });
  }
  return Array.from(byId.values());
}

/** Archetype ids + labels only, for the pre-run picker. */
export async function loadArchetypeOptions() {
  const res = await fetch('/data/archetype_rosters.csv');
  if (!res.ok) throw new Error('Failed to fetch archetype_rosters.csv — run build_archetype_rosters.js');
  const rows = parseCsv(await res.text());
  return buildArchetypes(rows).map(({ archetypeId, label, season, finishRank }) => ({
    archetypeId, label, season, finishRank,
  }));
}

function buildYearCandidates(finalKtcRows, year, ptsById) {
  const rows = [];
  for (const row of finalKtcRows) {
    if (Number(row.year) !== year) continue;
    const position = (row.position || '').toUpperCase();
    const value = Number(row.ktc_value);
    const sleeperId = (row.sleeper_id || '').trim();
    if (!POSITIONS.includes(position) || !Number.isFinite(value) || !sleeperId) continue;
    rows.push({ name: row.name, position, value, playerId: sleeperId });
  }
  const top = filterTopKtcPlayers(rows, TOP_KTC_RANK);
  // Match Pos Value Compare: players with no season points (injured all year,
  // holdouts) are excluded from the pair pool.
  const candidates = [];
  let excludedZeroPoint = 0;
  for (const player of top) {
    const total = seasonTotal(ptsById, player.playerId);
    if (total <= 0) {
      excludedZeroPoint += 1;
      continue;
    }
    candidates.push({ ...player, seasonPts: total });
  }
  return { candidates, excludedZeroPoint, poolSize: top.length };
}

// ── Main run ──────────────────────────────────────────────────────────────────

/**
 * @param {Object}   opts
 * @param {number}   opts.jitterPct           0 = deterministic single build per archetype
 * @param {number}   opts.seed                RNG seed (only matters when jitterPct > 0)
 * @param {number}   opts.buildsPerArchetype  jittered instantiations per archetype
 * @param {Object}   opts.slotCounts          { QB, RB, WR, TE, FLEX, SUPER }
 * @param {number}   opts.ppr                 points per reception (all positions)
 * @param {number}   opts.tePremium           extra points per TE reception
 * @param {Array}    opts.archetypeIds        subset of archetype ids to run (null = all)
 * @param {Function} opts.onProgress          ({ fraction, label }) => void
 * @param {Function} opts.isCancelled         () => boolean
 */
export async function runHwangTrueSimulation({
  jitterPct = DEFAULT_JITTER_PCT,
  seed = 1,
  buildsPerArchetype = DEFAULT_BUILDS_PER_ARCHETYPE,
  slotCounts = SLOT_COUNTS,
  ppr = 0,
  tePremium = 0.5,
  archetypeIds = null,
  onProgress = () => {},
  isCancelled = () => false,
} = {}) {
  const { archetypeRows, finalKtcRows, scoringConfig: baseScoring, meta } = await loadSimInputs();
  const scoringConfig = applyReceptionScoring(baseScoring, ppr, tePremium);
  const allArchetypes = buildArchetypes(archetypeRows);
  const archetypes = archetypeIds && archetypeIds.length > 0
    ? allArchetypes.filter((a) => archetypeIds.includes(a.archetypeId))
    : allArchetypes;
  if (archetypes.length === 0) throw new Error('No archetypes selected');
  const seasonBoards = buildSeasonBoards(finalKtcRows);

  // Identical builds without jitter would just re-measure the same roster.
  const builds = jitterPct > 0 ? Math.max(1, buildsPerArchetype) : 1;

  const totalUnits = SIM_YEARS.length * (NUM_WEEKS + archetypes.length * builds);
  let unitsDone = 0;
  const report = (offset, label) => {
    onProgress({
      fraction: Math.min((unitsDone + offset) / totalUnits, 1),
      unitsDone: Math.min(Math.round(unitsDone + offset), totalUnits),
      totalUnits,
      label,
    });
  };

  const overallMatchups = emptyMatchups();
  const yearResults = [];

  for (const year of SIM_YEARS) {
    if (isCancelled()) throw new Error('cancelled');
    const board = seasonBoards.get(year);
    if (!board) continue;

    // Score every player on the year's Final KTC board (covers candidates and
    // every instantiated roster player).
    const positionsById = new Map();
    for (const pos of Object.keys(board)) {
      for (const entry of board[pos]) {
        if (entry.sleeperId) positionsById.set(entry.sleeperId, pos);
      }
    }
    report(0, `${year}: fetching weekly stats…`);
    const ptsById = await buildYearWeeklyPoints(year, positionsById, scoringConfig, (week) => {
      unitsDone += 1;
      report(0, `${year}: fetching weekly stats — week ${week}/${NUM_WEEKS}`);
    });
    clearStatsCache();

    const { candidates, excludedZeroPoint, poolSize } = buildYearCandidates(finalKtcRows, year, ptsById);
    const pairs = findValuePairs(candidates, PAIR_TOLERANCE_PCT);

    const candidateById = new Map(candidates.map((c) => [c.playerId, c]));
    const pairedIds = new Set();
    for (const pair of pairs) {
      pairedIds.add(pair.a.playerId);
      pairedIds.add(pair.b.playerId);
    }

    const yearMatchups = emptyMatchups();
    const archetypeResults = [];

    for (let ai = 0; ai < archetypes.length; ai += 1) {
      if (isCancelled()) throw new Error('cancelled');
      const archetype = archetypes[ai];
      const dropIndex = findDropSlotIndex(archetype.slots);

      const archMatchups = emptyMatchups();
      const hvorpSums = new Map(); // pid → { sum, n }
      const buildRecords = [];
      let totalKtcSum = 0;

      for (let b = 0; b < builds; b += 1) {
        if (isCancelled()) throw new Error('cancelled');
        const buildLabel = builds > 1 ? ` — build ${b + 1}/${builds}` : '';
        report(0, `${year}: ${archetype.label}${buildLabel} — instantiating roster`);

        const rng = jitterPct > 0
          ? mulberry32((seed >>> 0) + year * 1009 + ai * 9176 + b * 524287)
          : () => 0.5; // randInt(-1, 1) → 0: exact rank mapping
        const results = instantiateArchetype({ slots: archetype.slots, board, jitterPct, rng });

        const basePlayers = [];
        const players = [];
        results.forEach((r, idx) => {
          const generated = r.generated;
          const dropped = idx === dropIndex;
          const player = generated
            ? {
              sleeperId: generated.sleeperId,
              name: generated.name,
              position: r.slot.position,
              ktcValue: generated.value,
              posRank: r.targetRank,
              sourcePlayer: r.slot.playerName,
              offBoard: r.offBoard,
              dropped,
            }
            : null;
          if (player) players.push(player);
          if (player && !dropped) basePlayers.push(player);
        });

        const baseIdSet = new Set(basePlayers.map((p) => p.sleeperId));
        const weekArrays = buildBaseWeekArrays(basePlayers, ptsById);
        const baseTotals = weekArrays.map((week) => optimalTotal(week, slotCounts));

        // HVORP for every paired candidate plus every base player (for display).
        const hvorpById = new Map();
        const evalIds = new Set([...pairedIds, ...baseIdSet]);
        let evaluated = 0;
        for (const pid of evalIds) {
          const position = candidateById.get(pid)?.position
            || basePlayers.find((p) => p.sleeperId === pid)?.position;
          if (!position) continue;
          hvorpById.set(
            pid,
            evalPlayerHvorp(pid, position, baseIdSet.has(pid), weekArrays, baseTotals, ptsById, slotCounts),
          );
          evaluated += 1;
          if (evaluated % 60 === 0) {
            report(
              (b + evaluated / evalIds.size) / builds,
              `${year}: ${archetype.label}${buildLabel} — plugging in candidates (${evaluated}/${evalIds.size})`,
            );
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 0));
            if (isCancelled()) throw new Error('cancelled');
          }
        }

        for (const [pid, value] of hvorpById.entries()) {
          const agg = hvorpSums.get(pid) || { sum: 0, n: 0 };
          agg.sum += value;
          agg.n += 1;
          hvorpSums.set(pid, agg);
        }

        const buildMatchups = emptyMatchups();
        for (const pair of pairs) {
          const hvorpA = hvorpById.get(pair.a.playerId);
          const hvorpB = hvorpById.get(pair.b.playerId);
          if (hvorpA == null || hvorpB == null) continue;
          const m = buildMatchups[pair.pairKey];
          m.count += 1;
          m.totalA += hvorpA;
          m.totalB += hvorpB;
        }
        accumulateMatchups(archMatchups, buildMatchups);
        accumulateMatchups(yearMatchups, buildMatchups);

        const totalKtc = players.reduce((s, p) => s + (p.dropped ? 0 : p.ktcValue || 0), 0);
        totalKtcSum += totalKtc;
        if (b < MAX_STORED_BUILDS) {
          buildRecords.push({
            buildIndex: b + 1,
            totalKtc,
            players: players.map((p) => ({
              ...p,
              seasonPts: seasonTotal(ptsById, p.sleeperId),
              hvorp: hvorpById.get(p.sleeperId) ?? null,
            })),
          });
        }

        unitsDone += 1;
        report(0, `${year}: ${archetype.label}${buildLabel} — done`);
      }

      const hvorpAvgById = {};
      for (const [pid, agg] of hvorpSums.entries()) {
        hvorpAvgById[pid] = Math.round((agg.sum / agg.n) * 10) / 10;
      }

      archetypeResults.push({
        archetypeId: archetype.archetypeId,
        label: archetype.label,
        season: archetype.season,
        teamName: archetype.teamName,
        year,
        buildCount: builds,
        avgTotalKtc: Math.round(totalKtcSum / builds),
        matchups: finalizeMatchups(archMatchups),
        hvorpAvgById,
        builds: buildRecords,
      });
    }

    accumulateMatchups(overallMatchups, yearMatchups);
    yearResults.push({
      year,
      candidateCount: candidates.length,
      excludedZeroPoint,
      poolSize,
      pairCount: pairs.length,
      matchups: finalizeMatchups(yearMatchups),
      candidates: candidates.map((c) => ({
        playerId: c.playerId,
        name: c.name,
        position: c.position,
        value: c.value,
        seasonPts: c.seasonPts,
      })),
      pairs: pairs.map((p) => ({ pairKey: p.pairKey, aId: p.a.playerId, bId: p.b.playerId })),
      archetypes: archetypeResults,
    });
  }

  const finalOverall = finalizeMatchups(overallMatchups);

  return {
    config: {
      years: SIM_YEARS,
      tolerancePct: PAIR_TOLERANCE_PCT,
      topKtcRank: TOP_KTC_RANK,
      jitterPct,
      seed,
      buildsPerArchetype: builds,
      slotCounts,
      ppr,
      tePremium,
      archetypeCount: archetypes.length,
      ktcAsOf: meta?.ktcAsOf || null,
      hvorpMethod: 'roster-context optimal starter totals (17 weeks, add-on / leave-one-out)',
    },
    overall: {
      matchups: finalOverall,
      multipliers: computeMultipliersFromTotals(finalOverall),
    },
    years: yearResults,
  };
}
