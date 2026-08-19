/**
 * Scenario URL encoding / decoding
 * {
 *   y: string,          // season year, e.g. "2025"
 *   c: Array<{
 *     r: number,        // rosterId
 *     a: string[],      // added player Sleeper IDs
 *     d: string[],      // dropped (removed) player Sleeper IDs
 *   }>                  // only teams that have at least one change
 * }
 *
 * The object is JSON-stringified then base64-encoded so the URL stays clean.
 */

import { isValidPlayerId, sanitizeRoster, sanitizeRosters } from './scenarioUtils';
import { normalizeOutcomeScenarioYear, DEFAULT_OUTCOME_SCENARIO_YEAR } from './outcomeScenarioConfig';
import { clampSimulatorIterations, DEFAULT_ITERATIONS } from './simulatorMonteCarlo';
import { normalizeVariance, DEFAULT_VARIANCE, normalizeMonotone, DEFAULT_MONOTONE } from './outcomeDistribution';
import { normalizeRankSource, DEFAULT_RANK_SOURCE, RANK_SOURCE_DASH } from './simulatorRankSource';

export { sanitizeRoster, sanitizeRosters, isValidPlayerId };

/**
 * Encode a scenario state into a URL-safe base64 string.
 *
 * @param {string} season
 * @param {Object} originalRosters  – { rosterId: string[] }
 * @param {Object} scenarioRosters  – { rosterId: string[] }
 * @returns {string} base64-encoded scenario param
 */
export function encodeScenario(season, originalRosters, scenarioRosters) {
  const changes = [];

  for (const rid in originalRosters) {
    const orig = new Set(originalRosters[rid] || []);
    const curr = scenarioRosters[rid] || [];
    const currSet = new Set(curr);

    const added   = curr.filter((pid) => !orig.has(pid));
    const removed = [...orig].filter((pid) => !currSet.has(pid));

    if (added.length > 0 || removed.length > 0) {
      changes.push({ r: Number(rid), a: added, d: removed });
    }
  }

  const schema = { y: String(season), c: changes };
  return btoa(JSON.stringify(schema));
}

/**
 * Decode a base64 scenario param back into the schema object.
 * Returns null if the param is missing or malformed.
 *
 * @param {string|null} encoded
 * @returns {{ y: string, c: Array } | null}
 */
export function decodeScenario(encoded) {
  if (!encoded) return null;
  try {
    const obj = JSON.parse(atob(encoded));
    if (!obj || typeof obj.y !== 'string' || !Array.isArray(obj.c)) return null;
    return obj;
  } catch {
    return null;
  }
}

// ── Future Scenario encoding ──────────────────────────────────────────────────
//
// Schema extends the base with a `py` (projection year) field and uses
// a fixed sentinel `y: "future"` so decoders can distinguish the two types.
//
// { y: "future", py: "2024", c: [{ r, a, d }] }

/**
 * Encode a future scenario (current rosters + projection year) into a URL-safe
 * base64 string.
 *
 * @param {string} projectionYear  The historical season used for stat mapping.
 * @param {Object} originalRosters – { rosterId: string[] }
 * @param {Object} scenarioRosters – { rosterId: string[] }
 * @returns {string} base64-encoded future scenario param
 */
export function encodeFutureScenario(projectionYear, originalRosters, scenarioRosters) {
  const changes = [];

  for (const rid in originalRosters) {
    const orig = new Set(originalRosters[rid] || []);
    const curr = scenarioRosters[rid] || [];
    const currSet = new Set(curr);

    const added   = curr.filter((pid) => !orig.has(pid));
    const removed = [...orig].filter((pid) => !currSet.has(pid));

    if (added.length > 0 || removed.length > 0) {
      changes.push({ r: Number(rid), a: added, d: removed });
    }
  }

  const schema = { y: 'future', py: String(projectionYear), c: changes };
  return btoa(JSON.stringify(schema));
}

/**
 * Decode a base64 future scenario param.
 * Returns null if the param is missing, malformed, or not a future scenario.
 *
 * @param {string|null} encoded
 * @returns {{ py: string, c: Array } | null}
 */
export function decodeFutureScenario(encoded) {
  if (!encoded) return null;
  try {
    const obj = JSON.parse(atob(encoded));
    if (!obj || obj.y !== 'future' || typeof obj.py !== 'string' || !Array.isArray(obj.c)) return null;
    return obj;
  } catch {
    return null;
  }
}

// ── Future Scenario v2 encoding ───────────────────────────────────────────────
//
// Outcome-based projections using Hwang ADP ±2 historical pools + percentile rolls.
//
// { y: "future2", sy: "2025", c: [{ r, a, d }], p: { [playerId]: percentile 0-100 },
//   pp: { [playerId]: playoff percentile 0-100 } }

export function encodeFutureScenario2(
  originalRosters,
  scenarioRosters,
  percentileRolls = {},
  seasonYear = DEFAULT_OUTCOME_SCENARIO_YEAR,
  playoffRolls = {},
) {
  const changes = [];

  for (const rid in originalRosters) {
    const orig = new Set(originalRosters[rid] || []);
    const curr = scenarioRosters[rid] || [];
    const currSet = new Set(curr);

    const added = curr.filter((pid) => !orig.has(pid));
    const removed = [...orig].filter((pid) => !currSet.has(pid));

    if (added.length > 0 || removed.length > 0) {
      changes.push({ r: Number(rid), a: added, d: removed });
    }
  }

  const schema = {
    y: 'future2',
    sy: normalizeOutcomeScenarioYear(seasonYear),
    c: changes,
    p: percentileRolls || {},
    pp: playoffRolls || {},
  };
  return btoa(JSON.stringify(schema));
}

export function decodeFutureScenario2(encoded) {
  if (!encoded) return null;
  try {
    const obj = JSON.parse(atob(encoded));
    if (!obj || !Array.isArray(obj.c)) return null;
    if (obj.y !== 'future2' && obj.y !== 'simulator') return null;
    return {
      sy: normalizeOutcomeScenarioYear(obj.sy),
      c: obj.c,
      p: obj.p && typeof obj.p === 'object' ? obj.p : {},
      pp: obj.pp && typeof obj.pp === 'object' ? obj.pp : {},
      n: obj.y === 'simulator' ? clampSimulatorIterations(obj.n) : undefined,
      v: obj.y === 'simulator' ? normalizeVariance(obj.v) : undefined,
      m: obj.y === 'simulator' ? normalizeMonotone(obj.m) : undefined,
      rs: obj.y === 'simulator' ? normalizeRankSource(obj.rs, obj.sy) : undefined,
    };
  } catch {
    return null;
  }
}

export function encodeSimulatorScenario(
  originalRosters,
  scenarioRosters,
  {
    seasonYear = DEFAULT_OUTCOME_SCENARIO_YEAR,
    iterations = DEFAULT_ITERATIONS,
    variance = DEFAULT_VARIANCE,
    monotone = DEFAULT_MONOTONE,
    rankSource = DEFAULT_RANK_SOURCE,
  } = {},
) {
  const changes = [];

  for (const rid in originalRosters) {
    const orig = new Set(originalRosters[rid] || []);
    const curr = scenarioRosters[rid] || [];
    const currSet = new Set(curr);

    const added = curr.filter((pid) => !orig.has(pid));
    const removed = [...orig].filter((pid) => !currSet.has(pid));

    if (added.length > 0 || removed.length > 0) {
      changes.push({ r: Number(rid), a: added, d: removed });
    }
  }

  const sy = normalizeOutcomeScenarioYear(seasonYear);
  const payload = {
    y: 'simulator',
    sy,
    n: clampSimulatorIterations(iterations),
    v: normalizeVariance(variance),
    m: normalizeMonotone(monotone),
    c: changes,
  };
  if (normalizeRankSource(rankSource, sy) === RANK_SOURCE_DASH) {
    payload.rs = RANK_SOURCE_DASH;
  }
  return btoa(JSON.stringify(payload));
}

/**
 * Build a Future Scenarios v2 eval URL for a specific percentile-roll outcome set.
 */
export function buildFutureScenario2EvalUrl(
  originalRosters,
  scenarioRosters,
  percentileRolls,
  seasonYear = DEFAULT_OUTCOME_SCENARIO_YEAR,
  playoffRolls = {},
) {
  const encoded = encodeFutureScenario2(
    originalRosters,
    scenarioRosters,
    percentileRolls,
    seasonYear,
    playoffRolls,
  );
  return `/future-scenarios-2?state=eval&scenario=${encodeURIComponent(encoded)}`;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Given originalRosters fetched from the API and the encoded changes,
 * reconstruct the modified scenarioRosters.
 *
 * @param {Object} originalRosters   – { rosterId: string[] }
 * @param {Array}  changes           – schema.c from decodeScenario
 * @returns {Object}                 – { rosterId: string[] }
 */
export function applyScenarioChanges(originalRosters, changes) {
  const result = {};

  for (const rid in originalRosters) {
    result[rid] = sanitizeRoster(originalRosters[rid]);
  }

  for (const { r, a, d } of changes) {
    const rid = String(r);
    const base = result[rid] || [];
    const dropSet = new Set((d || []).filter(isValidPlayerId));
    const withDrops = base.filter((pid) => !dropSet.has(pid));
    const addSet = new Set(withDrops);
    for (const pid of (a || [])) {
      if (isValidPlayerId(pid) && !addSet.has(pid)) withDrops.push(pid);
    }
    result[rid] = sanitizeRoster(withDrops);
  }

  return result;
}
