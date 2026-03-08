/**
 * historicalRankingsBuilder.js
 *
 * Parses a season stats CSV (stats_player_reg_{year}.csv) and builds
 * positional rank arrays — sorted by actual fantasy-points performance
 * using the league's exact scoring rules:
 *
 *   QB / RB / WR  →  fantasy_points  (standard, 0 PPR)
 *   TE            →  fantasy_points + receptions × 0.5  (half-PPR)
 *
 * Each array entry is a Sleeper player ID.  Index 0 = rank 1.
 *
 * The GSIS IDs in the stats CSV are cross-referenced against players.txt
 * (which has a `gsis_id` field on each entry) to resolve Sleeper IDs.
 *
 * Returned shape:
 *   { QB: string[], RB: string[], WR: string[], TE: string[] }
 */

// ── CSV helper (handles quoted fields containing commas) ─────────────────────

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += c; }
  }
  result.push(current);
  return result;
}

// ── Name normalization (mirrors GsisLookup.normalizeName) ────────────────────
// Strips common suffixes so "Michael Penix Jr." matches "Michael Penix Jr"
// and "Joe Milton III" matches "Joe Milton".

function normalizeName(name) {
  if (!name) return '';
  let n = name.toLowerCase().trim();
  const suffixes = [' jr.', ' jr', ' sr.', ' sr', ' ii', ' iii', ' iv', ' v'];
  for (const s of suffixes) {
    if (n.endsWith(s)) { n = n.slice(0, n.length - s.length).trim(); break; }
  }
  return n;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Build positional rank arrays from a season stats CSV.
 *
 * Player resolution uses a three-tier fallback:
 *   1. GSIS ID (direct, most reliable when present)
 *   2. Exact full_name match (case-insensitive)
 *   3. Normalized name match (strips Jr./III/etc. from both sides)
 *
 * ~67% of players in players.txt lack a gsis_id, so tiers 2 and 3 are
 * essential for comprehensive coverage.
 *
 * @param {string} csvText    Raw text of stats_player_reg_{year}.csv.
 * @param {Object} playersData  Sleeper players metadata keyed by Sleeper ID.
 * @returns {{ QB: [{sleeperId, scoringPts}], RB: [...], WR: [...], TE: [...] }}
 *   Arrays sorted by descending fantasy points (index 0 = rank 1).
 *   Returns empty arrays for all positions on any parse failure.
 */
export function buildHistoricalPositionRanks(csvText, playersData) {
  const empty = { QB: [], RB: [], WR: [], TE: [] };
  if (!csvText || !playersData) return empty;

  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return empty;

  // ── Build lookup maps from players.txt ───────────────────────────────────
  // Tier 1: GSIS ID → Sleeper ID
  // Tier 2: exact lowercase full_name → Sleeper ID
  // Tier 3: normalized name (no Jr./III) → Sleeper ID
  const gsisToSleeper      = {};
  const nameToSleeper      = {};
  const normNameToSleeper  = {};

  for (const sid in playersData) {
    const p = playersData[sid];
    if (!p) continue;

    const gsis = p.gsis_id && p.gsis_id.trim();
    if (gsis) gsisToSleeper[gsis] = sid;

    const name = p.full_name && p.full_name.trim();
    if (name) {
      nameToSleeper[name.toLowerCase()] = sid;
      normNameToSleeper[normalizeName(name)] = sid;
    }
  }

  // ── Find column indices ───────────────────────────────────────────────────
  const headers  = lines[0].split(',');
  const idIdx    = headers.indexOf('player_id');            // GSIS ID
  const nameIdx  = headers.indexOf('player_display_name'); // full name
  const posIdx   = headers.indexOf('position');
  const ptsIdx   = headers.indexOf('fantasy_points');       // standard (0 PPR)
  const recIdx   = headers.indexOf('receptions');

  if (idIdx === -1 || posIdx === -1 || ptsIdx === -1) return empty;

  // ── Parse rows ────────────────────────────────────────────────────────────
  const byPosition = { QB: [], RB: [], WR: [], TE: [] };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const vals     = parseCsvLine(line);
    const gsisId   = vals[idIdx]?.trim();
    const position = vals[posIdx]?.trim();

    if (!gsisId || !byPosition[position]) continue;

    const stdPts     = parseFloat(vals[ptsIdx]) || 0;
    const receptions = recIdx !== -1 ? (parseFloat(vals[recIdx]) || 0) : 0;

    // Half-PPR for TEs only; standard for everyone else
    const scoringPts = position === 'TE'
      ? stdPts + receptions * 0.5
      : stdPts;

    if (scoringPts <= 0) continue;

    // Resolve Sleeper ID via three-tier fallback
    const csvName   = nameIdx !== -1 ? (vals[nameIdx]?.trim() || '') : '';
    const sleeperId =
      gsisToSleeper[gsisId] ||
      (csvName && nameToSleeper[csvName.toLowerCase()]) ||
      (csvName && normNameToSleeper[normalizeName(csvName)]);

    if (!sleeperId) continue;

    byPosition[position].push({ sleeperId, scoringPts });
  }

  // ── Sort descending by points, keep both sleeperId and scoringPts ─────────
  //
  // Each array entry is { sleeperId: string, scoringPts: number }.
  // Index 0 = rank 1 (highest scorer).
  // scoringPts is retained so the UI can display the ranking basis for
  // verification (see the FpRankBadge rank-list modal in ScenarioTeamDetail).
  const result = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    byPosition[pos].sort((a, b) => b.scoringPts - a.scoringPts);
    result[pos] = byPosition[pos].map(({ sleeperId, scoringPts }) => ({ sleeperId, scoringPts }));
  }

  return result;
}
