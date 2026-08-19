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
 *      Optional `hvorpMode: 'replace'` instead removes a similar-value player
 *      from the built roster and inserts the candidate (roster size stays
 *      constant). If one side of the pair is already on the club, that player
 *      is the swap target.
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
    out[combo.pairKey] = { ...combo, count: 0, weightSum: 0, totalA: 0, totalB: 0 };
  }
  return out;
}

function accumulateMatchups(target, source) {
  for (const [key, m] of Object.entries(source)) {
    target[key].count += m.count;
    target[key].weightSum += m.weightSum;
    target[key].totalA += m.totalA;
    target[key].totalB += m.totalB;
  }
}

function finalizeMatchups(matchups) {
  const out = {};
  for (const [key, m] of Object.entries(matchups)) {
    out[key] = {
      ...m,
      weightSum: Math.round(m.weightSum * 100) / 100,
      totalA: Math.round(m.totalA * 10) / 10,
      totalB: Math.round(m.totalB * 10) / 10,
      relDiffPct: m.count > 0 ? hvorpPctDelta(m.totalA, m.totalB) : null,
    };
  }
  return out;
}

/** Solve a 3×3 linear system by Gaussian elimination with partial pivoting. */
function solve3(A, b) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < 3; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < 3; r += 1) {
      if (Math.abs(M[r][i]) > Math.abs(M[pivot][i])) pivot = r;
    }
    [M[i], M[pivot]] = [M[pivot], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let r = 0; r < 3; r += 1) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c < 4; c += 1) M[r][c] -= f * M[i][c];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/**
 * Position multipliers solved over the full comparison network:
 * every matchup (QB vs RB, …, WR vs TE) contributes the equation
 * log(m_B) − log(m_A) = log(totalB / totalA), weighted by its accumulated
 * pair weight. Weighted least squares in log space uses the direct
 * RB↔WR↔TE comparisons too — not just the QB-anchored ones.
 *
 * The pair data only identifies differences between positions, so a gauge
 * is needed:
 *   grounding='qb'    pin QB at exactly 1.0 (multipliers read "vs QB")
 *   grounding='mean'  the geometric mean of all four positions is 1.0
 *                     (multipliers read "vs the average same-priced player";
 *                     QB gets its own multiplier and its noise no longer
 *                     leaks into the other three)
 */
export function computeMultipliersFromTotals(matchups, grounding = 'mean') {
  const idx = { RB: 0, WR: 1, TE: 2 };
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  for (const m of Object.values(matchups)) {
    if (!m || m.count === 0 || m.totalA <= 0 || m.totalB <= 0) continue;
    const r = Math.log(m.totalB / m.totalA);
    const w = m.weightSum > 0 ? m.weightSum : m.count;
    const terms = [];
    if (idx[m.posB] !== undefined) terms.push([idx[m.posB], 1]);
    if (idx[m.posA] !== undefined) terms.push([idx[m.posA], -1]);
    for (const [i, si] of terms) {
      b[i] += w * si * r;
      for (const [j, sj] of terms) A[i][j] += w * si * sj;
    }
  }
  const x = solve3(A, b);
  if (!x) return { QB: null, RB: null, WR: null, TE: null };
  const logs = { QB: 0, RB: x[0], WR: x[1], TE: x[2] };
  if (grounding === 'mean') {
    const mean = (logs.QB + logs.RB + logs.WR + logs.TE) / 4;
    for (const pos of Object.keys(logs)) logs[pos] -= mean;
  }
  const byPosition = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const v = Math.exp(logs[pos]);
    byPosition[pos] = Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
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

/**
 * Player on `basePlayers` to remove so a value-matched pair can swap in.
 * Prefer a pair member already on the club; otherwise the closest roster
 * player within ±tolerance of the pair midpoint. Null if both members are
 * on the roster (no unique hole) or nobody is close enough.
 */
function findSwapTarget(basePlayers, pair, tolerancePct) {
  const idA = pair.a.playerId;
  const idB = pair.b.playerId;
  const onA = basePlayers.some((p) => p.sleeperId === idA);
  const onB = basePlayers.some((p) => p.sleeperId === idB);
  if (onA && onB) return { target: null, reason: 'both_on_roster' };
  if (onA) return { target: basePlayers.find((p) => p.sleeperId === idA), reason: 'pair_on_roster' };
  if (onB) return { target: basePlayers.find((p) => p.sleeperId === idB), reason: 'pair_on_roster' };

  const mid = (pair.a.value + pair.b.value) / 2;
  if (!(mid > 0)) return { target: null, reason: 'no_target' };
  const maxDist = (tolerancePct / 100) * mid;
  let best = null;
  let bestDist = Infinity;
  for (const p of basePlayers) {
    if (!p.sleeperId || p.sleeperId === idA || p.sleeperId === idB) continue;
    const value = Number(p.ktcValue);
    if (!(value > 0)) continue;
    const dist = Math.abs(value - mid);
    if (dist <= maxDist && dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return { target: best, reason: best ? 'similar_value' : 'no_target' };
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

function joinCompRows(finalKtcRows, compRows) {
  // Competitor-adjusted values live in the redraft value index, which has no
  // sleeper ids — join to final KTC rows by (year, name). Same KTC name
  // source, so the join is exact.
  const sleeperIds = new Map();
  for (const row of finalKtcRows) {
    sleeperIds.set(`${row.year}|${(row.name || '').trim().toLowerCase()}`, row.sleeper_id);
  }
  const valueRows = [];
  for (const row of compRows) {
    const value = Number(row.competitor_adjusted_value);
    if (!Number.isFinite(value)) continue;
    const sleeperId = sleeperIds.get(`${row.year}|${(row.name || '').trim().toLowerCase()}`);
    if (!sleeperId) continue;
    valueRows.push({
      year: row.year,
      name: row.name,
      position: row.position,
      sleeper_id: sleeperId,
      ktc_value: value,
    });
  }
  return valueRows;
}

async function loadSimInputs(valueBasis, constructionBasis) {
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

  const needComp = valueBasis === 'comp' || constructionBasis === 'comp';
  let compJoined = null;
  if (needComp) {
    const compRes = await fetch('/data/final_ktc_redraft_value_index.csv');
    if (!compRes.ok) throw new Error('Failed to fetch final_ktc_redraft_value_index.csv');
    compJoined = joinCompRows(finalKtcRows, parseCsv(await compRes.text()));
  }

  const rowsFor = (basis) => (basis === 'comp' ? compJoined : finalKtcRows);
  return {
    archetypeRows,
    valueRows: rowsFor(valueBasis),
    constructionRows: rowsFor(constructionBasis),
    scoringConfig,
    meta,
  };
}

function buildArchetypes(archetypeRows, rankBasis = 'ktc') {
  const rankField = rankBasis === 'comp' ? 'comp_adj_pos_rank' : 'ktc_pos_rank';
  const valueField = rankBasis === 'comp' ? 'comp_adj_value' : 'ktc_value';
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
      posRank: row[rankField] ? Number(row[rankField]) : null,
      ktcValue: row[valueField] ? Number(row[valueField]) : null,
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
 * @param {string}   opts.valueBasis          'ktc' (Final KTC) or 'comp' (competitor-adjusted):
 *                                            drives pair prices and value-weighting
 * @param {string}   opts.constructionBasis   'ktc' or 'comp': board used to instantiate
 *                                            archetype rank slots. Defaults to valueBasis.
 *                                            Pin this to 'comp' when the archetypes are
 *                                            redraft/ADP rank ladders so KTC pairing does
 *                                            not rebuild the roster as a dynasty club.
 * @param {string}   opts.grounding           'mean' (default; multipliers vs the average
 *                                            same-priced player) or 'qb' (pin QB = 1.0)
 * @param {boolean}  opts.valueWeightPairs    weight each pair's contribution by its mid value
 * @param {boolean}  opts.pointsWeightBuilds  weight each build's contribution by its base-roster
 *                                            season optimal total (better teams count more)
 * @param {string}   opts.hvorpMode           'addon' (default; 27th-man plug) or
 *                                            'replace' (swap a similar-value roster player)
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
  valueBasis = 'ktc',
  constructionBasis = null,
  grounding = 'mean',
  valueWeightPairs = true,
  pointsWeightBuilds = true,
  hvorpMode = 'addon',
  onProgress = () => {},
  isCancelled = () => false,
} = {}) {
  const rankBasis = constructionBasis || valueBasis;
  const { archetypeRows, valueRows, constructionRows, scoringConfig: baseScoring, meta } = await loadSimInputs(valueBasis, rankBasis);
  const scoringConfig = applyReceptionScoring(baseScoring, ppr, tePremium);
  const allArchetypes = buildArchetypes(archetypeRows, rankBasis);
  const archetypes = archetypeIds && archetypeIds.length > 0
    ? allArchetypes.filter((a) => archetypeIds.includes(a.archetypeId))
    : allArchetypes;
  if (archetypes.length === 0) throw new Error('No archetypes selected');
  const seasonBoards = buildSeasonBoards(constructionRows);
  const valueBoards = rankBasis === valueBasis ? seasonBoards : buildSeasonBoards(valueRows);

  // Identical builds without jitter would just re-measure the same roster.
  const builds = jitterPct > 0 ? Math.max(1, buildsPerArchetype) : 1;

  const totalUnits = SIM_YEARS.length * (NUM_WEEKS + archetypes.length * builds);
  // Object so loop callbacks can safely mutate without no-loop-func.
  const progress = { unitsDone: 0 };
  const report = (offset, label) => {
    onProgress({
      fraction: Math.min((progress.unitsDone + offset) / totalUnits, 1),
      unitsDone: Math.min(Math.round(progress.unitsDone + offset), totalUnits),
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

    // Score every player who might appear on a constructed roster or in the
    // pairing pool (construction and pairing boards can differ).
    const positionsById = new Map();
    const addBoard = (b) => {
      if (!b) return;
      for (const pos of Object.keys(b)) {
        for (const entry of b[pos]) {
          if (entry.sleeperId) positionsById.set(entry.sleeperId, pos);
        }
      }
    };
    addBoard(board);
    addBoard(valueBoards.get(year));
    report(0, `${year}: fetching weekly stats…`);
    const ptsById = await buildYearWeeklyPoints(year, positionsById, scoringConfig, (week) => {
      progress.unitsDone += 1;
      report(0, `${year}: fetching weekly stats — week ${week}/${NUM_WEEKS}`);
    });
    clearStatsCache();

    const { candidates, excludedZeroPoint, poolSize } = buildYearCandidates(valueRows, year, ptsById);
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
      const dropIndex = hvorpMode === 'replace' ? -1 : findDropSlotIndex(archetype.slots);

      const archMatchups = emptyMatchups();
      const hvorpSums = new Map(); // pid → { sum, n, wSum, w }
      const buildRecords = [];
      let totalKtcSum = 0;
      let baseTotalSum = 0;
      let replaceAttempts = 0;
      let replaceHits = 0;
      let replaceSkipBoth = 0;
      let replaceSkipNoTarget = 0;

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
        const hvorpById = new Map();

        if (hvorpMode === 'replace') {
          const holeCache = new Map(); // swapTargetId → { weekArrays, baseTotals, evals: Map(pid → hvorp) }
          const plugLabel = 'replacing similar-value players';
          let evaluated = 0;
          const evalOne = (hole, cand) => {
            if (hole.evals.has(cand.playerId)) return hole.evals.get(cand.playerId);
            const value = evalPlayerHvorp(
              cand.playerId, cand.position, false,
              hole.weekArrays, hole.baseTotals, ptsById, slotCounts,
            );
            hole.evals.set(cand.playerId, value);
            evaluated += 1;
            return value;
          };
          for (const pair of pairs) {
            replaceAttempts += 1;
            const { target, reason } = findSwapTarget(basePlayers, pair, PAIR_TOLERANCE_PCT);
            if (!target) {
              if (reason === 'both_on_roster') replaceSkipBoth += 1;
              else replaceSkipNoTarget += 1;
              continue;
            }
            replaceHits += 1;
            let hole = holeCache.get(target.sleeperId);
            if (!hole) {
              const holePlayers = basePlayers.filter((p) => p.sleeperId !== target.sleeperId);
              const holeWeeks = buildBaseWeekArrays(holePlayers, ptsById);
              hole = {
                weekArrays: holeWeeks,
                baseTotals: holeWeeks.map((week) => optimalTotal(week, slotCounts)),
                evals: new Map(),
              };
              holeCache.set(target.sleeperId, hole);
            }
            const hvorpA = evalOne(hole, pair.a);
            const hvorpB = evalOne(hole, pair.b);
            hvorpById.set(pair.a.playerId, (hvorpById.get(pair.a.playerId) || 0) + hvorpA);
            hvorpById.set(`${pair.a.playerId}__n`, (hvorpById.get(`${pair.a.playerId}__n`) || 0) + 1);
            hvorpById.set(pair.b.playerId, (hvorpById.get(pair.b.playerId) || 0) + hvorpB);
            hvorpById.set(`${pair.b.playerId}__n`, (hvorpById.get(`${pair.b.playerId}__n`) || 0) + 1);
            pair._hvorpA = hvorpA;
            pair._hvorpB = hvorpB;
            pair._hit = true;
            if (evaluated > 0 && evaluated % 80 === 0) {
              report(
                (b + 0.5) / builds,
                `${year}: ${archetype.label}${buildLabel} — ${plugLabel} (${evaluated} evals)`,
              );
              // eslint-disable-next-line no-await-in-loop
              await new Promise((r) => setTimeout(r, 0));
              if (isCancelled()) throw new Error('cancelled');
            }
          }
        } else {
          // HVORP for every paired candidate plus every base player (for display).
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
        }

        // Season-long optimal total of the base roster: the build's strength,
        // used as its contribution weight when pointsWeightBuilds is on.
        const seasonBaseTotal = baseTotals.reduce((s, v) => s + v, 0);
        baseTotalSum += seasonBaseTotal;
        const buildW = pointsWeightBuilds ? seasonBaseTotal / 2500 : 1;

        if (hvorpMode === 'replace') {
          const seen = new Set();
          for (const pair of pairs) {
            if (!pair._hit) continue;
            for (const cand of [pair.a, pair.b]) {
              if (seen.has(cand.playerId)) continue;
              seen.add(cand.playerId);
              const n = hvorpById.get(`${cand.playerId}__n`) || 1;
              const value = (hvorpById.get(cand.playerId) || 0) / n;
              const agg = hvorpSums.get(cand.playerId) || { sum: 0, n: 0, wSum: 0, w: 0 };
              agg.sum += value;
              agg.n += 1;
              agg.wSum += value * buildW;
              agg.w += buildW;
              hvorpSums.set(cand.playerId, agg);
            }
          }
        } else {
          for (const [pid, value] of hvorpById.entries()) {
            if (typeof pid === 'string' && pid.endsWith('__n')) continue;
            const agg = hvorpSums.get(pid) || { sum: 0, n: 0, wSum: 0, w: 0 };
            agg.sum += value;
            agg.n += 1;
            agg.wSum += value * buildW;
            agg.w += buildW;
            hvorpSums.set(pid, agg);
          }
        }

        const buildMatchups = emptyMatchups();
        for (const pair of pairs) {
          let hvorpA;
          let hvorpB;
          if (hvorpMode === 'replace') {
            if (!pair._hit) continue;
            hvorpA = pair._hvorpA;
            hvorpB = pair._hvorpB;
            pair._hit = false;
            pair._hvorpA = null;
            pair._hvorpB = null;
          } else {
            hvorpA = hvorpById.get(pair.a.playerId);
            hvorpB = hvorpById.get(pair.b.playerId);
            if (hvorpA == null || hvorpB == null) continue;
          }
          const valueW = valueWeightPairs
            ? ((pair.a.value + pair.b.value) / 2) / 5000
            : 1;
          const w = valueW * buildW;
          const m = buildMatchups[pair.pairKey];
          m.count += 1;
          m.weightSum += w;
          m.totalA += w * hvorpA;
          m.totalB += w * hvorpB;
        }
        accumulateMatchups(archMatchups, buildMatchups);
        accumulateMatchups(yearMatchups, buildMatchups);

        const totalKtc = players.reduce((s, p) => s + (p.dropped ? 0 : p.ktcValue || 0), 0);
        totalKtcSum += totalKtc;
        if (b < MAX_STORED_BUILDS) {
          buildRecords.push({
            buildIndex: b + 1,
            totalKtc,
            players: players.map((p) => {
              let hvorp = hvorpById.get(p.sleeperId);
              if (hvorpMode === 'replace') {
                const n = hvorpById.get(`${p.sleeperId}__n`);
                hvorp = n > 0 ? hvorp / n : null;
              }
              return {
                ...p,
                seasonPts: seasonTotal(ptsById, p.sleeperId),
                hvorp: hvorp ?? null,
              };
            }),
          });
        }

        progress.unitsDone += 1;
        report(0, `${year}: ${archetype.label}${buildLabel} — done`);
      }

      const hvorpAvgById = {};
      const hvorpWeightedAvgById = {};
      for (const [pid, agg] of hvorpSums.entries()) {
        hvorpAvgById[pid] = Math.round((agg.sum / agg.n) * 10) / 10;
        hvorpWeightedAvgById[pid] = agg.w > 0
          ? Math.round((agg.wSum / agg.w) * 10) / 10
          : null;
      }

      archetypeResults.push({
        archetypeId: archetype.archetypeId,
        label: archetype.label,
        season: archetype.season,
        teamName: archetype.teamName,
        year,
        buildCount: builds,
        avgTotalKtc: Math.round(totalKtcSum / builds),
        avgBaseTotal: Math.round(baseTotalSum / builds),
        matchups: finalizeMatchups(archMatchups),
        hvorpAvgById,
        hvorpWeightedAvgById,
        builds: buildRecords,
        replaceAttempts,
        replaceHits,
        replaceSkipBoth,
        replaceSkipNoTarget,
      });
    }

    accumulateMatchups(overallMatchups, yearMatchups);
    yearResults.push({
      year,
      candidateCount: candidates.length,
      excludedZeroPoint,
      poolSize,
      pairCount: pairs.length,
      replaceAttempts: archetypeResults.reduce((s, a) => s + (a.replaceAttempts || 0), 0),
      replaceHits: archetypeResults.reduce((s, a) => s + (a.replaceHits || 0), 0),
      replaceSkipBoth: archetypeResults.reduce((s, a) => s + (a.replaceSkipBoth || 0), 0),
      replaceSkipNoTarget: archetypeResults.reduce((s, a) => s + (a.replaceSkipNoTarget || 0), 0),
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
      valueBasis,
      constructionBasis: rankBasis,
      grounding,
      valueWeightPairs,
      pointsWeightBuilds,
      hvorpMode,
      archetypeCount: archetypes.length,
      ktcAsOf: meta?.ktcAsOf || null,
      hvorpMethod: hvorpMode === 'replace'
        ? 'roster-context optimal starter totals (17 weeks, replace similar-value player)'
        : 'roster-context optimal starter totals (17 weeks, add-on / leave-one-out)',
    },
    overall: {
      matchups: finalOverall,
      multipliers: computeMultipliersFromTotals(finalOverall, grounding),
    },
    years: yearResults,
  };
}
