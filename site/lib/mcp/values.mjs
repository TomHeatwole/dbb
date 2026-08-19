/**
 * values.mjs — server-side Hwang value engine.
 *
 * Node port of the frontend value stack so HwangAI / MCP tools evaluate
 * trades with the exact same math as the site's trade calculator.
 *
 * KEEP IN SYNC with the frontend sources of truth:
 *   site/src/lookups/hwangPositionCoefficients.js   (coefficients)
 *   site/src/tradeCalculator/ktcValueAdjustment.js  (KTC-style VA formula)
 *   site/src/lookups/HwangValueAdjustmentLookup.js  (stitched KTC + multipliers)
 *   site/src/lookups/RedraftValueLookup.js          (competitor/rebuilder CSV)
 *   site/src/lookups/KtcLookup.js                   (pick market fallback)
 *   site/src/lookups/TruePickValueLookup.js         (True pick multipliers)
 *   site/public/data/true_rookie_pick_chart.json
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { DATA_DIR, CURRENT_YEAR } from './config.mjs';
import { normalisePlayerName } from './helpers.mjs';
import { loadKtcData, loadFantasyCalcData, loadFfbData } from './dataLoader.mjs';

// ─── Hwang position coefficients (keep in sync with hwangPositionCoefficients.js)

export const HWANG_MULTIPLIER_VREF = 5000;

export const HWANG_POSITION_COEFFICIENTS = {
  market: {
    QB: 1.0,
    RB: 1.12,
    WR: 0.96,
    TE: 1.0,
  },
  true: {
    QB: { c: 0.932, k: -0.175, flat: 0.97 },
    RB: { c: 1.112, k: -0.029, flat: 1.11 },
    WR: { c: 0.899, k: 0.029, flat: 0.90 },
    TE: { c: 0.976, k: 0.069, flat: 0.95 },
  },
  trueComp: {
    QB: { c: 0.932, k: -0.175, flat: 0.97 },
    RB: { c: 1.112, k: -0.011, flat: 1.12 },
    WR: { c: 0.899, k: 0.011, flat: 0.90 },
    TE: { c: 0.974, k: 0.050, flat: 0.96 },
  },
};

/** Which coefficient set powers Hwang-Adjusted Competitor / Rebuild values. */
export const HWANG_COMPOSITE_COEFFICIENT_KEY = 'trueComp';

export function hwangMultiplierAt(entry, value) {
  if (entry == null) return 1;
  if (typeof entry === 'number') return entry;
  const v = Math.max(Number(value) || 0, 100);
  return entry.c * ((v / HWANG_MULTIPLIER_VREF) ** entry.k);
}

export function getHwangCoefficientMap(adjustmentKey) {
  const coeffs = HWANG_POSITION_COEFFICIENTS[adjustmentKey];
  if (!coeffs) return null;
  return new Map(Object.entries(coeffs).map(([pos, m]) => [pos.toUpperCase(), m]));
}

// ─── Value sources ────────────────────────────────────────────────────────────

export const VALUE_SOURCES = [
  'ktc_sf',
  'ktc_sf_tep',
  'hwang_market_value',
  'hwang_true_value',
  'competitor_adjusted',
  'rebuilder_adjusted',
  'hwang_competitor_adjusted',
  'hwang_rebuilder_adjusted',
  'fantasycalc',
  'ffb',
];

export const VALUE_SOURCE_LABELS = {
  ktc_sf: 'KTC SF',
  ktc_sf_tep: 'KTC SF TE+',
  hwang_market_value: 'Hwang Market',
  hwang_true_value: 'Hwang True',
  competitor_adjusted: 'Competitor Adj',
  rebuilder_adjusted: 'Rebuild Adj',
  hwang_competitor_adjusted: 'Hwang Adj Competitor',
  hwang_rebuilder_adjusted: 'Hwang Adj Rebuild',
  fantasycalc: 'FantasyCalc',
  ffb: 'FFB',
};

// ─── KTC-style trade Value Adjustment (reverse-engineered ~2022 formula) ──────

export const KTC_HIGHEST_VALUE_OVERALL = 9999;

export function rawTradeValue(playerValue, highestValueInTrade, highestValueOverall = KTC_HIGHEST_VALUE_OVERALL) {
  const p = Number(playerValue);
  const t = Number(highestValueInTrade);
  const v = Number(highestValueOverall);
  if (!(p > 0) || !(t > 0) || !(v > 0)) return 0;
  return (
    p * (
      0.10
      + 0.04 * (p / v) ** 8
      + 0.11 * (p / t) ** 1.3
      + 0.22 * (p / (v + 2000)) ** 1.28
    )
  );
}

export function findPlayerValueForRawGap(targetRaw, currentHighestInTrade, highestValueOverall = KTC_HIGHEST_VALUE_OVERALL) {
  if (!(targetRaw > 0)) return 0;
  let low = 0;
  let high = highestValueOverall;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    const hypotheticalTradeMax = Math.max(currentHighestInTrade, mid);
    const raw = rawTradeValue(mid, hypotheticalTradeMax, highestValueOverall);
    if (raw < targetRaw) low = mid;
    else high = mid;
  }
  return Math.round((low + high) / 2);
}

/**
 * Evaluate a two-sided trade with KTC-style raw scoring + displayed adjustment.
 * VA only applies to stud-consolidation trades (uneven asset counts where the
 * side holding the best asset receives fewer pieces).
 */
export function evaluateKtcStyleTrade(teamA, teamB, highestValueOverall = KTC_HIGHEST_VALUE_OVERALL) {
  const valuesA = (teamA || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const valuesB = (teamB || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const allValues = [...valuesA, ...valuesB];

  const empty = {
    ordinaryA: 0, ordinaryB: 0, rawA: 0, rawB: 0, tradeMax: 0,
    playerToEven: 0, adjustmentForA: 0, adjustmentForB: 0,
    adjustedTotalA: 0, adjustedTotalB: 0,
    rawWinner: null, isEven: true, appliesAdjustment: false,
  };
  if (allValues.length === 0) return empty;

  const tradeMax = Math.max(...allValues);
  const ordinaryA = valuesA.reduce((s, v) => s + v, 0);
  const ordinaryB = valuesB.reduce((s, v) => s + v, 0);
  const countA = valuesA.length;
  const countB = valuesB.length;

  const rawA = valuesA.reduce((s, v) => s + rawTradeValue(v, tradeMax, highestValueOverall), 0);
  const rawB = valuesB.reduce((s, v) => s + rawTradeValue(v, tradeMax, highestValueOverall), 0);
  const rawWinner = Math.abs(rawA - rawB) < 0.5 ? null : (rawA > rawB ? 'A' : 'B');

  const base = {
    ...empty,
    ordinaryA, ordinaryB, rawA, rawB, tradeMax,
    adjustedTotalA: ordinaryA, adjustedTotalB: ordinaryB,
    rawWinner, isEven: rawWinner == null,
  };

  if (countA === countB) return base;

  const maxA = countA ? Math.max(...valuesA) : 0;
  const maxB = countB ? Math.max(...valuesB) : 0;
  const studSide = maxA >= maxB ? 'A' : 'B';
  const studCount = studSide === 'A' ? countA : countB;
  const otherCount = studSide === 'A' ? countB : countA;
  if (studCount >= otherCount) return base;
  if (rawWinner == null) return base;

  const aIsRawWinner = rawWinner === 'A';
  const rawGap = Math.abs(rawA - rawB);
  const playerToEven = findPlayerValueForRawGap(rawGap, tradeMax, highestValueOverall);

  const hypotheticalA = ordinaryA + (aIsRawWinner ? 0 : playerToEven);
  const hypotheticalB = ordinaryB + (aIsRawWinner ? playerToEven : 0);
  const displayedAdjustment = Math.abs(hypotheticalA - hypotheticalB);

  const adjustmentForA = studSide === 'A' ? displayedAdjustment : 0;
  const adjustmentForB = studSide === 'B' ? displayedAdjustment : 0;

  return {
    ...base,
    playerToEven,
    adjustmentForA,
    adjustmentForB,
    adjustedTotalA: ordinaryA + adjustmentForA,
    adjustedTotalB: ordinaryB + adjustmentForB,
    appliesAdjustment: displayedAdjustment > 0,
    isEven: false,
  };
}

// ─── Draft pick market fallback + Hwang True multipliers ─────────────────────
// Keys: yearOffset (season − currentYear), round (1–4), tier.
// True prices = market × multiplier from true_rookie_pick_chart.json.

export const PICK_VALUES = {
  0: {
    1: { early: 9200, mid: 6200, late: 3800 },
    2: { early: 2900, mid: 2300, late: 1700 },
    3: { early: 1500, mid: 1150, late: 850 },
    4: { early: 650, mid: 480, late: 320 },
  },
  1: {
    1: { early: 6800, mid: 5000, late: 3100 },
    2: { early: 2400, mid: 1850, late: 1350 },
    3: { early: 1200, mid: 930, late: 700 },
    4: { early: 510, mid: 400, late: 300 },
  },
  2: {
    1: { early: 5400, mid: 3900, late: 2600 },
    2: { early: 1950, mid: 1550, late: 1150 },
    3: { early: 980, mid: 770, late: 590 },
    4: { early: 400, mid: 315, late: 240 },
  },
  3: {
    1: { early: 4300, mid: 3150, late: 2100 },
    2: { early: 1600, mid: 1250, late: 930 },
    3: { early: 810, mid: 630, late: 480 },
    4: { early: 320, mid: 250, late: 190 },
  },
};

const ROUND_ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
const TIER_CANON = { early: 'Early', mid: 'Mid', late: 'Late', Early: 'Early', Mid: 'Mid', Late: 'Late' };

let truePickChartCache = null;

export function loadTruePickChart() {
  if (truePickChartCache) return truePickChartCache;
  const path = join(DATA_DIR, 'true_rookie_pick_chart.json');
  if (!existsSync(path)) {
    truePickChartCache = { multiplierByTier: {}, avgTrueByTier: {}, multiplierByRound: {} };
    return truePickChartCache;
  }
  truePickChartCache = JSON.parse(readFileSync(path, 'utf8'));
  return truePickChartCache;
}

export function getTruePickMultiplier({ round, tier = 'Mid', slot = null } = {}) {
  const chart = loadTruePickChart();
  if (slot && chart.multiplierBySlot?.[slot] != null) return chart.multiplierBySlot[slot];
  const t = TIER_CANON[tier] || 'Mid';
  const ord = ROUND_ORD[Number(round)];
  if (ord && chart.multiplierByTier?.[`${t} ${ord}`] != null) {
    return chart.multiplierByTier[`${t} ${ord}`];
  }
  return chart.multiplierByRound?.[String(round)] ?? null;
}

export function getTruePickAvgValue({ round, tier = 'Mid', slot = null } = {}) {
  const chart = loadTruePickChart();
  if (slot && chart.avgTrueBySlot?.[slot] != null) return chart.avgTrueBySlot[slot];
  const t = TIER_CANON[tier] || 'Mid';
  const ord = ROUND_ORD[Number(round)];
  if (!ord) return null;
  return chart.avgTrueByTier?.[`${t} ${ord}`] ?? null;
}

/** Apply True multiplier to a market pick quote. */
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

export function getPickMarketFallback(season, round, currentYear = CURRENT_YEAR, tier = 'mid') {
  const offset = Number(season) - Number(currentYear);
  if (offset < 0) return 0;
  const valueOffset = offset >= 3 ? 2 : offset;
  const byRound = PICK_VALUES[valueOffset];
  if (!byRound) return 0;
  const tiers = byRound[Number(round)];
  if (!tiers) return 0;
  const key = String(tier || 'mid').toLowerCase();
  return tiers[key] ?? tiers.mid ?? 0;
}

/**
 * Hwang True pick value. Prefer live KTC market × True multiplier.
 */
export function getPickKtcValue(season, round, currentYear = CURRENT_YEAR, options = {}) {
  const offset = Number(season) - Number(currentYear);
  if (offset < 0) return 0;
  const tier = options.tier || 'Mid';
  let market = options.marketValue;
  if (market == null && options.ktcMap) {
    const ord = ROUND_ORD[Number(round)];
    const t = TIER_CANON[tier] || 'Mid';
    if (ord) {
      const entry = options.ktcMap.get(normalisePlayerName(`${season} ${t} ${ord}`));
      market = entry?.ktcValue_tep || entry?.ktcValue_sf || null;
    }
  }
  if (market == null) {
    market = getPickMarketFallback(season, round, currentYear, tier);
  }
  return applyTruePickAdjustment(market, { round, tier, slot: options.slot || null });
}

/** True-adjusted pick board for soft-mode pick equivalents (next draft year). */
export function getTruePickValueBoard(yearOffset = 1, currentYear = CURRENT_YEAR) {
  const year = Number(currentYear) + Number(yearOffset);
  const { map: ktcMap } = loadKtcData();
  const board = [];
  for (const round of [1, 2, 3, 4]) {
    for (const tier of ['Early', 'Mid', 'Late']) {
      board.push({
        label: `${year} ${tier.toLowerCase()} ${ROUND_ORD[round]}`,
        value: getPickKtcValue(year, round, currentYear, { tier, ktcMap }),
        round,
        tier,
      });
    }
  }
  return board.sort((a, b) => a.value - b.value);
}

// ─── Ranking helpers ──────────────────────────────────────────────────────────

export function assignPosValueRanks(entries, valueKey, rankKey) {
  const byPos = {};
  for (const entry of entries) {
    const value = entry[valueKey];
    if (value == null || value <= 0 || !entry.position) continue;
    if (!byPos[entry.position]) byPos[entry.position] = [];
    byPos[entry.position].push(entry);
  }
  for (const group of Object.values(byPos)) {
    group.sort((a, b) => b[valueKey] - a[valueKey]);
    group.forEach((entry, idx) => { entry[rankKey] = idx + 1; });
  }
}

export function assignOverallValueRanks(entries, valueKey, rankKey) {
  const ranked = entries
    .filter((e) => e[valueKey] != null && e[valueKey] > 0)
    .sort((a, b) => b[valueKey] - a[valueKey]);
  ranked.forEach((entry, idx) => { entry[rankKey] = idx + 1; });
}

// ─── ktc_redraft_value_index.csv (competitor / rebuilder values) ─────────────

let redraftCache = null;

function parseCsvRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; } else { inQuotes = false; }
      } else current += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { fields.push(current); current = ''; }
    else current += c;
  }
  fields.push(current.replace(/\r$/, ''));
  return fields;
}

const intOrNull = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const floatOrNull = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

/** Returns { byName: Map<normName, entry>, asOf, adpSource }. */
export function loadRedraftValueData() {
  if (redraftCache) return redraftCache;

  const text = readFileSync(join(DATA_DIR, 'ktc_redraft_value_index.csv'), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.trim().split('\n');
  const byName = new Map();
  let asOf = null;
  let adpSource = null;

  if (lines.length >= 2) {
    const headers = parseCsvRow(lines[0]);
    const idx = (name) => headers.indexOf(name);

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvRow(lines[i]);
      const name = (cols[idx('name')] || '').trim();
      if (!name) continue;

      const competitorAdjusted = intOrNull(
        (cols[idx('competitor_adjusted_value')] || cols[idx('redraft_adjusted_value')] || '').trim(),
      );
      const rebuilderAdjusted = intOrNull((cols[idx('rebuilder_adjusted_value')] || '').trim());
      if (competitorAdjusted == null && rebuilderAdjusted == null) continue;

      if (!asOf) asOf = (cols[idx('as_of')] || '').trim() || null;
      if (!adpSource) adpSource = (cols[idx('adp_source')] || '').trim() || null;

      byName.set(normalisePlayerName(name), {
        name,
        position: (cols[idx('position')] || '').trim(),
        nflTeam: (cols[idx('team')] || '').trim(),
        ktcValue: intOrNull((cols[idx('ktc_value')] || '').trim()),
        competitorAdjustedValue: competitorAdjusted,
        rebuilderAdjustedValue: rebuilderAdjusted,
        redraftValueIndex: floatOrNull((cols[idx('redraft_value_index')] || '').trim()),
        rebuildValueIndex: floatOrNull((cols[idx('rebuild_value_index')] || '').trim()),
      });
    }
  }

  redraftCache = { byName, asOf, adpSource };
  return redraftCache;
}

// ─── Per-source value lookups ─────────────────────────────────────────────────

/** Stitched SF TE+ baseline: TE uses TE+ column, other positions use SF 2QB. */
export function getStitchedKtcTepSfValue(entry) {
  if (!entry) return null;
  const pos = (entry.position || '').toUpperCase();
  const value = pos === 'TE' ? entry.ktcValue_tep : entry.ktcValue_sf;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function applyHwangKtcAdjustment(baseValue, position, multipliers) {
  if (baseValue == null || !Number.isFinite(baseValue)) return null;
  const pos = (position || '').toUpperCase();
  const multiplier = hwangMultiplierAt(multipliers?.get(pos), baseValue);
  return Math.round(baseValue * multiplier);
}

function buildRows(entries, getBaseValue, multipliers = null) {
  const rows = [];
  for (const entry of entries || []) {
    const baseValue = getBaseValue(entry);
    if (baseValue == null || !Number.isFinite(baseValue) || baseValue <= 0) continue;
    const value = multipliers
      ? applyHwangKtcAdjustment(baseValue, entry.position, multipliers)
      : Math.round(baseValue);
    if (value == null || value <= 0) continue;
    const name = entry.name;
    if (!name) continue;
    rows.push({
      name,
      normName: normalisePlayerName(name),
      position: (entry.position || '').toUpperCase(),
      nflTeam: entry.nflTeam || entry.team || '',
      baseValue,
      value,
      overallRank: null,
      posRank: null,
    });
  }
  assignPosValueRanks(rows, 'value', 'posRank');
  assignOverallValueRanks(rows, 'value', 'overallRank');
  const byName = new Map();
  for (const row of rows) byName.set(row.normName, row);
  return { byName, rows };
}

let lookupsCache = null;

/**
 * Build (and cache) a lookup per value source:
 *   { [source]: { byName: Map<normName, row>, rows } }
 */
export function getValueLookups() {
  if (lookupsCache) return lookupsCache;

  const { map: ktcMap } = loadKtcData();
  const ktcEntries = Array.from(ktcMap.values())
    // Exclude draft-pick pseudo entries from player value pools
    .filter((e) => !/^\d{4}\s+(early|mid|late)\s+/i.test(e.name || ''));

  const marketMult = getHwangCoefficientMap('market');
  const trueMult = getHwangCoefficientMap('true');
  const compositeMult = getHwangCoefficientMap(HWANG_COMPOSITE_COEFFICIENT_KEY);

  const lookups = {
    ktc_sf: buildRows(ktcEntries, (e) => e.ktcValue_sf),
    ktc_sf_tep: buildRows(ktcEntries, (e) => e.ktcValue_tep),
    hwang_market_value: buildRows(ktcEntries, getStitchedKtcTepSfValue, marketMult),
    hwang_true_value: buildRows(ktcEntries, getStitchedKtcTepSfValue, trueMult),
  };

  try {
    const { byName: redraftByName } = loadRedraftValueData();
    const redraftEntries = Array.from(redraftByName.values());
    lookups.competitor_adjusted = buildRows(redraftEntries, (e) => e.competitorAdjustedValue);
    lookups.rebuilder_adjusted = buildRows(redraftEntries, (e) => e.rebuilderAdjustedValue);
    lookups.hwang_competitor_adjusted = buildRows(redraftEntries, (e) => e.competitorAdjustedValue, compositeMult);
    lookups.hwang_rebuilder_adjusted = buildRows(redraftEntries, (e) => e.rebuilderAdjustedValue, compositeMult);
  } catch {
    // redraft CSV unavailable — those sources resolve to nothing
  }

  try {
    const { byName: fcByName } = loadFantasyCalcData();
    lookups.fantasycalc = buildRows(Array.from(fcByName.values()), (e) => e.value);
  } catch { /* optional */ }

  try {
    const { byName: ffbByName } = loadFfbData();
    lookups.ffb = buildRows(
      Array.from(ffbByName.values()).map((e) => ({ ...e, position: '' })),
      (e) => Math.max(0, 390 - e.rank),
    );
  } catch { /* optional */ }

  lookupsCache = lookups;
  return lookups;
}

/**
 * Look up a player's row in a source lookup with a last-name + position fallback.
 */
export function lookupValueEntry(name, source, hints = {}) {
  const lookups = getValueLookups();
  const lookup = lookups[source];
  if (!lookup) return null;

  const norm = normalisePlayerName(name);
  const direct = lookup.byName.get(norm);
  if (direct) return direct;

  if (hints.position) {
    const lastName = norm.split(' ').pop();
    for (const row of lookup.rows) {
      if (
        row.normName.split(' ').pop() === lastName &&
        row.position === (hints.position || '').toUpperCase()
      ) {
        return row;
      }
    }
  }
  return null;
}
