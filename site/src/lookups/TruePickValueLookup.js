/**
 * Hwang True rookie-pick pricing.
 *
 * Chart (5-season avg True ÷ market) lives in /data/true_rookie_pick_chart.json.
 * Regenerate with: node scripts/build_true_rookie_pick_chart.mjs
 *
 * Site-wide pick display = live (or fallback) KTC Early/Mid/Late quote × True multiplier.
 */

import { normalisePlayerName } from '../utils/playerNameMatcher';

const CHART_URL = '/data/true_rookie_pick_chart.json';

const ROUND_ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
const TIER_CANON = {
  early: 'Early',
  mid: 'Mid',
  late: 'Late',
  Early: 'Early',
  Mid: 'Mid',
  Late: 'Late',
};

/** @type {object | null} */
let chartCache = null;
/** @type {Promise<object> | null} */
let chartPromise = null;

/**
 * 10-team Hwang league: early 1–3 / mid 4–7 / late 8–10.
 * (KTC named assets are still Early/Mid/Late; this maps roster pick slots onto them.)
 */
export function tierFromPickInRound(pickInRound, teamsPerRound = 10) {
  const n = Number(pickInRound);
  if (!Number.isFinite(n) || n < 1) return 'Mid';
  if (teamsPerRound >= 12) {
    if (n <= 4) return 'Early';
    if (n <= 8) return 'Mid';
    return 'Late';
  }
  if (n <= 3) return 'Early';
  if (n <= 7) return 'Mid';
  return 'Late';
}

export function formatPickAssetName(season, round, tier = 'Mid') {
  const ord = ROUND_ORD[Number(round)];
  if (!ord) return null;
  const t = TIER_CANON[tier] || 'Mid';
  return `${season} ${t} ${ord}`;
}

export function formatDraftSlot(round, pickInRound) {
  const r = Number(round);
  const p = Number(pickInRound);
  if (!Number.isFinite(r) || !Number.isFinite(p) || p < 1) return null;
  return `${r}.${String(p).padStart(2, '0')}`;
}

export async function loadTruePickChart() {
  if (chartCache) return chartCache;
  if (!chartPromise) {
    chartPromise = fetch(CHART_URL)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch true_rookie_pick_chart.json');
        chartCache = await res.json();
        return chartCache;
      })
      .catch((err) => {
        chartPromise = null;
        throw err;
      });
  }
  return chartPromise;
}

/** Sync accessor after loadTruePickChart() has resolved (or null). */
export function getTruePickChart() {
  return chartCache;
}

export function getTruePickMultiplier({ round, tier = 'Mid', slot = null } = {}) {
  const chart = chartCache;
  if (!chart) return null;

  if (slot && chart.multiplierBySlot?.[slot] != null) {
    return chart.multiplierBySlot[slot];
  }

  const t = TIER_CANON[tier] || 'Mid';
  const ord = ROUND_ORD[Number(round)];
  if (ord) {
    const key = `${t} ${ord}`;
    if (chart.multiplierByTier?.[key] != null) return chart.multiplierByTier[key];
  }

  const byRound = chart.multiplierByRound?.[String(round)];
  return byRound != null ? byRound : null;
}

export function getTruePickAvgValue({ round, tier = 'Mid', slot = null } = {}) {
  const chart = chartCache;
  if (!chart) return null;
  if (slot && chart.avgTrueBySlot?.[slot] != null) return chart.avgTrueBySlot[slot];
  const t = TIER_CANON[tier] || 'Mid';
  const ord = ROUND_ORD[Number(round)];
  if (!ord) return null;
  return chart.avgTrueByTier?.[`${t} ${ord}`] ?? null;
}

/**
 * Look up live KTC market quote for a named pick asset (SF TE+).
 */
export function getMarketPickValue(ktcMap, season, round, tier = 'Mid') {
  if (!ktcMap) return null;
  const name = formatPickAssetName(season, round, tier);
  if (!name) return null;
  const entry = ktcMap.get(normalisePlayerName(name));
  if (!entry) return null;
  const value = entry.ktcValue_tep ?? entry.ktcValue_sf;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * True pick value = market × True multiplier.
 * Falls back to avg True absolute when market or multiplier is missing.
 */
export function applyTruePickAdjustment(marketValue, { round, tier = 'Mid', slot = null } = {}) {
  const mult = getTruePickMultiplier({ round, tier, slot });
  if (marketValue != null && marketValue > 0 && mult != null) {
    return Math.round(marketValue * mult);
  }
  const avgTrue = getTruePickAvgValue({ round, tier, slot });
  if (avgTrue != null) return avgTrue;
  if (marketValue != null && marketValue > 0) return Math.round(marketValue);
  return 0;
}

/**
 * Resolve a pick to its Hwang True value.
 *
 * @param {object} args
 * @param {string|number} args.season
 * @param {number} args.round
 * @param {string|number} [args.currentYear]
 * @param {'Early'|'Mid'|'Late'|string} [args.tier]
 * @param {number|null} [args.pickInRound] — draft slot within round (1.0N)
 * @param {Map|null} [args.ktcMap] — live KTC map for market quotes
 * @param {number|null} [args.marketValue] — override market quote
 * @param {function} [args.fallbackMarket] — (season, round, tier) => number
 */
export function getTruePickValue({
  season,
  round,
  tier: tierArg = null,
  pickInRound = null,
  ktcMap = null,
  marketValue = null,
  fallbackMarket = null,
} = {}) {
  const slot = pickInRound != null ? formatDraftSlot(round, pickInRound) : null;
  const tier = tierArg
    || (pickInRound != null ? tierFromPickInRound(pickInRound) : 'Mid');

  let market = marketValue;
  if (market == null) {
    market = getMarketPickValue(ktcMap, season, round, tier);
  }
  if (market == null && typeof fallbackMarket === 'function') {
    market = fallbackMarket(season, round, tier);
  }

  return applyTruePickAdjustment(market, { round, tier, slot });
}
