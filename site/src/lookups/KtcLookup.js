/**
 * KtcLookup.js
 * Fetches and parses /data/ktc_values.csv.
 *
 * Supported formats:
 *   'sf'     – Superflex / 2QB, no TE premium  (ktc_value_2qb / rank_2qb)
 *   'sf_tep' – Superflex TE+                   (ktc_value_tep_2qb / rank_tep_2qb)
 *
 * Positional ranks are computed at parse time per format by sorting within
 * each position group by value descending.
 *
 * Draft pick values use Hwang True pick multipliers (True Rookie Pick chart)
 * applied to live KTC Early/Mid/Late quotes when available.
 */

import { normalisePlayerName as normaliseName, findBestPlayerMatch } from '../utils/playerNameMatcher';
import {
  getTruePickValue,
  getMarketPickValue,
  tierFromPickInRound,
} from './TruePickValueLookup';

let cachedKtcMap = null;
let cachedAsOf   = null;

// ── Fallback market pick table (pre-True) ─────────────────────────────────────
// Used only when live KTC pick rows are missing. Keys: yearOffset, round, tier.
// KEEP rough sync with site/lib/mcp/values.mjs PICK_VALUES.
const PICK_MARKET_FALLBACK = {
  0: {
    1: { early: 9200, mid: 6200, late: 3800 },
    2: { early: 2900, mid: 2300, late: 1700 },
    3: { early: 1500, mid: 1150, late: 850  },
    4: { early: 650,  mid: 480,  late: 320  },
  },
  1: {
    1: { early: 6800, mid: 5000, late: 3100 },
    2: { early: 2400, mid: 1850, late: 1350 },
    3: { early: 1200, mid: 930,  late: 700  },
    4: { early: 510,  mid: 400,  late: 300  },
  },
  2: {
    1: { early: 5400, mid: 3900, late: 2600 },
    2: { early: 1950, mid: 1550, late: 1150 },
    3: { early: 980,  mid: 770,  late: 590  },
    4: { early: 400,  mid: 315,  late: 240  },
  },
  3: {
    1: { early: 4300, mid: 3150, late: 2100 },
    2: { early: 1600, mid: 1250, late: 930  },
    3: { early: 810,  mid: 630,  late: 480  },
    4: { early: 320,  mid: 250,  late: 190  },
  },
};

/** Raw market estimate before True adjustment (live map preferred at call sites). */
export function getPickMarketFallback(season, round, currentYear, tier = 'mid') {
  const offset = Number(season) - Number(currentYear);
  if (offset < 0) return 0;
  const valueOffset = offset >= 3 ? 2 : offset;
  const byRound = PICK_MARKET_FALLBACK[valueOffset];
  if (!byRound) return 0;
  const tiers = byRound[Number(round)];
  if (!tiers) return 0;
  const key = String(tier || 'mid').toLowerCase();
  return tiers[key] ?? tiers.mid ?? 0;
}

/**
 * Hwang True value for a draft pick.
 * Prefer live KTC Early/Mid/Late × True multiplier; fall back to static market × True.
 *
 * @param {string|number} season
 * @param {number}        round
 * @param {string|number} currentYear
 * @param {object}        [options]
 * @param {'Early'|'Mid'|'Late'|string} [options.tier='Mid']
 * @param {number|null} [options.pickInRound]
 * @param {Map|null} [options.ktcMap]
 * @param {number|null} [options.marketValue]
 */
export function getPickKtcValue(season, round, currentYear, options = {}) {
  const offset = Number(season) - Number(currentYear);
  if (offset < 0) return 0;

  const pickInRound = options.pickInRound ?? null;
  const tier = options.tier
    || (pickInRound != null ? tierFromPickInRound(pickInRound) : 'Mid');

  return getTruePickValue({
    season,
    round,
    tier,
    pickInRound,
    ktcMap: options.ktcMap ?? cachedKtcMap,
    marketValue: options.marketValue ?? null,
    fallbackMarket: (s, r, t) => getPickMarketFallback(s, r, currentYear, t),
  });
}

export { getMarketPickValue, tierFromPickInRound };

// ── CSV parsing ───────────────────────────────────────────────────────────────

function computePosRanks(rows, valueKey) {
  const byPos = {};
  for (const row of rows) {
    if (!row.position) continue;
    if (!byPos[row.position]) byPos[row.position] = [];
    byPos[row.position].push(row);
  }
  for (const pos in byPos) {
    byPos[pos].sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0));
    byPos[pos].forEach((row, idx) => { row[`posRank_${valueKey}`] = idx + 1; });
  }
}

/**
 * Fetch and parse ktc_values.csv.
 * Returns { map: Map<normalisedName, entry>, asOf: string }.
 *
 * Each entry shape:
 * {
 *   name, position, nflTeam,
 *   ktcValue_sf, overallRank_sf, posRank_sf,
 *   ktcValue_tep, overallRank_tep, posRank_tep,
 * }
 */
export async function fetchKtcData() {
  if (cachedKtcMap) return { map: cachedKtcMap, asOf: cachedAsOf };

  const res = await fetch('/data/ktc_values.csv');
  if (!res.ok) throw new Error('Failed to fetch ktc_values.csv');
  const text = await res.text();

  const lines = text.trim().split('\n');
  if (lines.length < 2) return { map: new Map(), asOf: null };

  const headers       = lines[0].split(',');
  const nameIdx       = headers.indexOf('name');
  const posIdx        = headers.indexOf('position');
  const teamIdx       = headers.indexOf('team');
  const sfValIdx      = headers.indexOf('ktc_value_2qb');
  const tepValIdx     = headers.indexOf('ktc_value_tep_2qb');
  const sfRankIdx     = headers.indexOf('rank_2qb');
  const tepRankIdx    = headers.indexOf('rank_tep_2qb');
  const asOfIdx       = headers.indexOf('as_of');

  const rows = [];
  let asOf = null;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const rawName      = (cols[nameIdx]   || '').trim();
    const ktcValue_sf  = parseInt(cols[sfValIdx],  10);
    const ktcValue_tep = parseInt(cols[tepValIdx], 10);
    if (!rawName || !Number.isFinite(ktcValue_sf)) continue;
    if (!asOf && asOfIdx >= 0) asOf = (cols[asOfIdx] || '').trim();

    rows.push({
      rawName,
      position:       (cols[posIdx]  || '').trim(),
      nflTeam:        (cols[teamIdx] || '').trim(),
      ktcValue_sf,
      ktcValue_tep:   Number.isFinite(ktcValue_tep) ? ktcValue_tep : ktcValue_sf,
      overallRank_sf:  sfRankIdx  >= 0 ? (parseInt(cols[sfRankIdx],  10) || null) : null,
      overallRank_tep: tepRankIdx >= 0 ? (parseInt(cols[tepRankIdx], 10) || null) : null,
    });
  }

  // Compute positional ranks for each format
  computePosRanks(rows, 'ktcValue_sf');
  computePosRanks(rows, 'ktcValue_tep');

  const map = new Map();
  for (const row of rows) {
    map.set(normaliseName(row.rawName), {
      name:           row.rawName,
      position:       row.position,
      nflTeam:        row.nflTeam,
      ktcValue_sf:    row.ktcValue_sf,
      ktcValue_tep:   row.ktcValue_tep,
      overallRank_sf:  row.overallRank_sf,
      overallRank_tep: row.overallRank_tep,
      posRank_sf:      row['posRank_ktcValue_sf']  ?? null,
      posRank_tep:     row['posRank_ktcValue_tep'] ?? null,
    });
  }

  cachedKtcMap = map;
  cachedAsOf   = asOf;
  return { map, asOf };
}

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Look up a player's KTC entry, returning values for the requested format.
 *
 * format: 'sf' | 'sf_tep'  (default 'sf_tep')
 * hints:  { position?, team?, age? } from the caller's data source (e.g. Sleeper).
 *         Used to disambiguate duplicate normalised names and as filters for the
 *         last-name fallback when no normalised match is found.
 *
 * Returns { ktcValue, overallRank, posRank, position, nflTeam, name } or null.
 */
export function getKtcEntryByName(playerName, ktcMap, format = 'sf_tep', hints = {}) {
  if (!ktcMap || !playerName) return null;

  // Fast path: O(1) normalised-name map lookup covers the vast majority of cases.
  const raw = ktcMap.get(normaliseName(playerName));

  let entry = raw;

  if (!entry) {
    // Fallback: smart search over all KTC entries.
    // Handles nicknames, punctuation mismatches the normaliser doesn't bridge,
    // and last-name-only matches when position/team hints are available.
    const { candidate } = findBestPlayerMatch(
      playerName,
      Array.from(ktcMap.values()),
      hints,
      { team: 'nflTeam' },   // KTC entries use nflTeam, not team
    );
    entry = candidate;
  }

  if (!entry) return null;

  const isTep = format === 'sf_tep';
  return {
    ktcValue:    isTep ? entry.ktcValue_tep   : entry.ktcValue_sf,
    overallRank: isTep ? entry.overallRank_tep : entry.overallRank_sf,
    posRank:     isTep ? entry.posRank_tep     : entry.posRank_sf,
    position:    entry.position,
    nflTeam:     entry.nflTeam,
    name:        entry.name,
  };
}

/**
 * Look up a player's KTC value by name.
 * Returns the integer value, or null if not found.
 */
export function getKtcValueByName(playerName, ktcMap, format = 'sf_tep') {
  const entry = getKtcEntryByName(playerName, ktcMap, format);
  return entry ? entry.ktcValue : null;
}

/**
 * Format a KTC value for display: "9,998" or "—" for null/zero.
 */
export function formatKtcValue(value) {
  if (value == null || value <= 0) return '—';
  return value.toLocaleString();
}

/** Human-readable label for a format key. */
export const KTC_FORMAT_LABELS = {
  sf:     'SF',
  sf_tep: 'SF TE+',
};
