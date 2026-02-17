/**
 * Scenario URL encoding / decoding
 *
 * Schema:
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

  // Start from a deep copy of original
  for (const rid in originalRosters) {
    result[rid] = [...(originalRosters[rid] || [])];
  }

  for (const { r, a, d } of changes) {
    const rid = String(r);
    const base = result[rid] || [];
    const dropSet = new Set(d || []);
    const withDrops = base.filter((pid) => !dropSet.has(pid));
    // Add players that aren't already present
    const addSet = new Set(withDrops);
    for (const pid of (a || [])) {
      if (!addSet.has(pid)) withDrops.push(pid);
    }
    result[rid] = withDrops;
  }

  return result;
}
