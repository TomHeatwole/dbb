/**
 * True Rookie Pick Value — map top-48 Hwang True rookies (May 20 snapshot)
 * onto same-year Early/Mid/Late pick assets in draft order.
 */

import { normalisePlayerName } from '../utils/playerNameMatcher';
import {
  applyHwangKtcAdjustment,
  loadHwangPositionMultipliers,
  hwangMultiplierAt,
} from '../lookups/HwangValueAdjustmentLookup';
import { KTC_ROOKIE_VALUES } from '../rankingsViewer/rankingsSources';

const FILLED_CSV = '/data/sf_ktc_values_historical_filled.csv';
const PICKS_CSV = '/data/sf_non_tep_ktc_values_historical.csv';
const DRAFT_YEARS_JSON = '/data/ktc_draft_years.json';
const LIVE_KTC_CSV = '/data/ktc_values.csv';

/** Years with filled TE+ rookie_draft snapshots, plus live fallback for current class. */
export const TRUE_ROOKIE_PICK_YEARS = [2021, 2022, 2023, 2024, 2025, 2026];

export const TOP_ROOKIES = 48;

/** 12-team board → 4 rounds × 12 = 48 slots; KTC Early/Mid/Late = 4 picks each. */
export const TEAMS_PER_ROUND = 12;

/** Rolling window for the generic True pick chart. */
export const AVERAGE_SEASON_WINDOW = 5;

export const ROUND_LABELS = {
  1: 'First',
  2: 'Second',
  3: 'Third',
  4: 'Fourth',
};

const ROUND_ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
const TIER_ORDER = ['Early', 'Mid', 'Late'];
const PICK_NAME_RE = /^\d{4}\s+(Early|Mid|Late)\s+(1st|2nd|3rd|4th)$/i;

function meanRounded(values) {
  if (!values.length) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / values.length);
}

/** True ÷ market; null when either side is missing / non-positive. */
function trueToMarketMultiplier(avgTrue, avgMarket) {
  if (avgTrue == null || avgMarket == null || avgMarket <= 0) return null;
  return avgTrue / avgMarket;
}

function pushTrueAndMarket(trueMap, marketMap, key, trueValue, pickValue) {
  if (!trueMap.has(key)) trueMap.set(key, []);
  trueMap.get(key).push(trueValue);
  if (pickValue != null && pickValue > 0) {
    if (!marketMap.has(key)) marketMap.set(key, []);
    marketMap.get(key).push(pickValue);
  }
}

function summarizeTrueMarket(trueValues, marketValues, pairedTrueValues) {
  const avgTrueValue = meanRounded(trueValues);
  const avgMarketValue = meanRounded(marketValues);
  // Multiplier uses True only from seasons that also have a market pick price,
  // so the ratio is same-window (KTC named picks start ~2024).
  const avgTrueForMult = meanRounded(pairedTrueValues);
  return {
    avgTrueValue,
    avgMarketValue,
    multiplier: trueToMarketMultiplier(avgTrueForMult, avgMarketValue),
    sampleSize: trueValues.length,
    marketSampleSize: marketValues.length,
  };
}

let cache = null;

function parseCsvRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function parseIntField(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function rookieSnapshotDate(classYear) {
  const cfg = KTC_ROOKIE_VALUES.sf;
  const month = String(cfg.snapshotMonth || 5).padStart(2, '0');
  const day = String(cfg.snapshotDay || 20).padStart(2, '0');
  return `${classYear}-${month}-${day}`;
}

function getDraftYear(row, draftMap) {
  const sid = (row.sleeperId || '').trim();
  if (sid && draftMap.bySleeperId?.[sid] != null) {
    return Number(draftMap.bySleeperId[sid]);
  }
  const name = (row.name || '').trim();
  if (name && draftMap.byName?.[name] != null) {
    return Number(draftMap.byName[name]);
  }
  const norm = normalisePlayerName(name);
  if (norm && draftMap.byNormalisedName?.[norm] != null) {
    return Number(draftMap.byNormalisedName[norm]);
  }
  return null;
}

/**
 * Map overall slot 1..48 → 12-team pick label + KTC Early/Mid/Late asset.
 * Early = 1–4, Mid = 5–8, Late = 9–12 within each round.
 */
export function slotToPick(classYear, overallSlot) {
  const slot = Number(overallSlot);
  const round = Math.ceil(slot / TEAMS_PER_ROUND);
  const pickInRound = ((slot - 1) % TEAMS_PER_ROUND) + 1;
  const tier = pickInRound <= 4 ? 'Early' : pickInRound <= 8 ? 'Mid' : 'Late';
  const roundOrd = ROUND_ORD[round] || `${round}th`;
  return {
    overallSlot: slot,
    round,
    pickInRound,
    draftSlot: `${round}.${String(pickInRound).padStart(2, '0')}`,
    tier,
    pickName: `${classYear} ${tier} ${roundOrd}`,
  };
}

function pickValueOnDate(picksByDateName, date, pickName) {
  if (!date || !pickName) return null;
  const value = picksByDateName.get(`${date}|${pickName}`);
  return value != null ? value : null;
}

/**
 * Prefer exact May 20 same-year pick; else nearest date within ±45 days that has it.
 */
function resolvePickValue(picksByDateName, pickDatesByName, classYear, pickName) {
  const target = rookieSnapshotDate(classYear);
  const exact = pickValueOnDate(picksByDateName, target, pickName);
  if (exact != null) {
    return { value: exact, date: target, dayOffset: 0 };
  }

  const dates = pickDatesByName.get(pickName);
  if (!dates?.length) return { value: null, date: null, dayOffset: null };

  const targetMs = Date.parse(`${target}T12:00:00`);
  let best = null;
  for (const date of dates) {
    const offsetDays = Math.round((Date.parse(`${date}T12:00:00`) - targetMs) / 86400000);
    if (Math.abs(offsetDays) > 45) continue;
    const value = pickValueOnDate(picksByDateName, date, pickName);
    if (value == null) continue;
    if (
      !best
      || Math.abs(offsetDays) < Math.abs(best.dayOffset)
      || (Math.abs(offsetDays) === Math.abs(best.dayOffset) && offsetDays < best.dayOffset)
    ) {
      best = { value, date, dayOffset: offsetDays };
    }
  }
  return best || { value: null, date: null, dayOffset: null };
}

async function loadRawData() {
  if (cache) return cache;

  const [filledRes, picksRes, draftRes, liveRes] = await Promise.all([
    fetch(FILLED_CSV),
    fetch(PICKS_CSV),
    fetch(DRAFT_YEARS_JSON),
    fetch(LIVE_KTC_CSV),
  ]);

  if (!filledRes.ok) throw new Error('Failed to fetch filled historical KTC board');
  if (!picksRes.ok) throw new Error('Failed to fetch historical pick values');
  if (!draftRes.ok) throw new Error('Failed to fetch ktc_draft_years.json');
  if (!liveRes.ok) throw new Error('Failed to fetch live ktc_values.csv');

  const [filledText, picksText, draftMap, liveText] = await Promise.all([
    filledRes.text(),
    picksRes.text(),
    draftRes.json(),
    liveRes.text(),
  ]);

  const filledRows = parseCsv(filledText);
  const rookiesByYear = new Map();
  for (const year of TRUE_ROOKIE_PICK_YEARS) {
    rookiesByYear.set(year, []);
  }

  for (const row of filledRows) {
    if ((row.snapshot_kind || '').trim() !== 'rookie_draft') continue;
    const year = parseIntField(row.year);
    if (!rookiesByYear.has(year)) continue;
    const name = (row.name || '').trim();
    const position = (row.position || '').trim().toUpperCase();
    const ktcValue = parseIntField(row.ktc_value);
    if (!name || !['QB', 'RB', 'WR', 'TE'].includes(position) || ktcValue == null || ktcValue <= 0) {
      continue;
    }
    const player = {
      name,
      position,
      ktcValue,
      sleeperId: (row.sleeper_id || '').trim(),
      overallRank: parseIntField(row.overall_rank),
      positionalRank: parseIntField(row.positional_rank),
      resolvedDate: (row.resolved_date || '').trim(),
      snapshotLabel: (row.snapshot_label || '').trim(),
      source: 'filled',
    };
    if (getDraftYear(player, draftMap) !== year) continue;
    rookiesByYear.get(year).push(player);
  }

  // Live board fallback for years with no filled class (e.g. 2026).
  const liveLines = liveText.trim().split(/\r?\n/);
  const liveHeaders = liveLines[0].split(',');
  const liveIdx = (name) => liveHeaders.indexOf(name);
  let liveAsOf = null;
  const liveClassByYear = new Map();

  for (let i = 1; i < liveLines.length; i++) {
    const cols = liveLines[i].split(',');
    const name = (cols[liveIdx('name')] || '').trim();
    const position = (cols[liveIdx('position')] || '').trim().toUpperCase();
    if (!name || !['QB', 'RB', 'WR', 'TE'].includes(position)) continue;
    if (!liveAsOf && liveIdx('as_of') >= 0) {
      liveAsOf = (cols[liveIdx('as_of')] || '').trim();
    }
    const sf = parseIntField(cols[liveIdx('ktc_value_2qb')]);
    const tep = parseIntField(cols[liveIdx('ktc_value_tep_2qb')]);
    const ktcValue = position === 'TE' ? (tep ?? sf) : sf;
    if (ktcValue == null || ktcValue <= 0) continue;
    const player = {
      name,
      position,
      ktcValue,
      sleeperId: '',
      overallRank: null,
      positionalRank: null,
      resolvedDate: liveAsOf,
      snapshotLabel: liveAsOf ? `Live KTC (${liveAsOf})` : 'Live KTC',
      source: 'live',
    };
    const draftYear = getDraftYear(player, draftMap);
    if (!TRUE_ROOKIE_PICK_YEARS.includes(draftYear)) continue;
    if (!liveClassByYear.has(draftYear)) liveClassByYear.set(draftYear, []);
    liveClassByYear.get(draftYear).push(player);
  }

  for (const year of TRUE_ROOKIE_PICK_YEARS) {
    if ((rookiesByYear.get(year) || []).length > 0) continue;
    const liveRows = liveClassByYear.get(year) || [];
    rookiesByYear.set(year, liveRows);
  }

  const picksByDateName = new Map();
  const pickDatesByName = new Map();
  for (const row of parseCsv(picksText)) {
    const name = (row.name || '').trim();
    if (!PICK_NAME_RE.test(name)) continue;
    const date = (row.date || '').trim();
    const value = parseIntField(row.ktc_value);
    if (!date || value == null) continue;
    picksByDateName.set(`${date}|${name}`, value);
    if (!pickDatesByName.has(name)) pickDatesByName.set(name, []);
    pickDatesByName.get(name).push(date);
  }

  cache = { rookiesByYear, picksByDateName, pickDatesByName, draftMap, liveAsOf };
  return cache;
}

function buildYearModel(year, rookies, multipliers, picksByDateName, pickDatesByName) {
  const scored = rookies
    .map((row) => {
      const multiplier = hwangMultiplierAt(multipliers.get(row.position), row.ktcValue);
      const trueValue = applyHwangKtcAdjustment(row.ktcValue, row.position, multipliers);
      return {
        ...row,
        multiplier,
        trueValue,
      };
    })
    .filter((row) => row.trueValue != null && row.trueValue > 0)
    .sort((a, b) => {
      if (b.trueValue !== a.trueValue) return b.trueValue - a.trueValue;
      if (b.ktcValue !== a.ktcValue) return b.ktcValue - a.ktcValue;
      return a.name.localeCompare(b.name);
    });

  const top = scored.slice(0, TOP_ROOKIES);
  const usedLiveFallback = top.some((r) => r.source === 'live');
  const snapshotDate = usedLiveFallback
    ? (top[0]?.resolvedDate || null)
    : rookieSnapshotDate(year);

  const rows = top.map((player, idx) => {
    const overallSlot = idx + 1;
    const pick = slotToPick(year, overallSlot);
    const pickResolved = resolvePickValue(
      picksByDateName,
      pickDatesByName,
      year,
      pick.pickName,
    );
    const pickValue = pickResolved.value;
    const delta = pickValue != null ? player.trueValue - pickValue : null;
    return {
      ...player,
      ...pick,
      pickValue,
      pickValueDate: pickResolved.date,
      pickValueDayOffset: pickResolved.dayOffset,
      delta,
      ktcTrueDelta: player.trueValue - player.ktcValue,
    };
  });

  const withPickValues = rows.filter((r) => r.pickValue != null).length;

  return {
    year,
    snapshotDate,
    snapshotLabel: usedLiveFallback
      ? `Live KTC (May 20 ${year} class not in filled board)`
      : `Rookie Draft (${rookieSnapshotDate(year)})`,
    usedLiveFallback,
    classSize: scored.length,
    rows,
    pickValuesAvailable: withPickValues,
    pickValuesMissing: rows.length - withPickValues,
  };
}

/**
 * Average True values across the most recent N seasons into generic pick charts:
 * per-slot (1.01…), per-round (First…), and per Early/Mid/Late × round.
 * Also averages same-window market pick KTC and True÷market multipliers.
 */
export function buildAveragePickChart(byYear, years, windowSize = AVERAGE_SEASON_WINDOW) {
  const available = (years || []).filter((y) => byYear.has(y)).sort((a, b) => a - b);
  const avgYears = available.slice(-windowSize);
  if (avgYears.length === 0) {
    return {
      years: [],
      marketYears: [],
      slots: [],
      rounds: [],
      tiers: [],
    };
  }

  const slotTrue = new Map();
  const slotMarket = new Map();
  const slotPairedTrue = new Map();
  const roundTrue = new Map();
  const roundMarket = new Map();
  const roundPairedTrue = new Map();
  const tierTrue = new Map();
  const tierMarket = new Map();
  const tierPairedTrue = new Map();
  const marketYears = new Set();

  for (const year of avgYears) {
    const model = byYear.get(year);
    // One market quote per tier asset per year (slots in a tier share Early/Mid/Late KTC).
    const tierMarketSeen = new Set();
    let yearHasMarket = false;

    for (const row of model.rows) {
      if (row.trueValue == null) continue;
      const tierKey = `${row.tier} ${ROUND_ORD[row.round]}`;
      const hasMarket = row.pickValue != null && row.pickValue > 0;
      if (hasMarket) yearHasMarket = true;

      pushTrueAndMarket(slotTrue, slotMarket, row.draftSlot, row.trueValue, hasMarket ? row.pickValue : null);
      if (hasMarket) {
        if (!slotPairedTrue.has(row.draftSlot)) slotPairedTrue.set(row.draftSlot, []);
        slotPairedTrue.get(row.draftSlot).push(row.trueValue);
      }

      pushTrueAndMarket(roundTrue, roundMarket, row.round, row.trueValue, hasMarket ? row.pickValue : null);
      if (hasMarket) {
        if (!roundPairedTrue.has(row.round)) roundPairedTrue.set(row.round, []);
        roundPairedTrue.get(row.round).push(row.trueValue);
      }

      pushTrueAndMarket(tierTrue, tierMarket, tierKey, row.trueValue, null);
      if (hasMarket) {
        if (!tierPairedTrue.has(tierKey)) tierPairedTrue.set(tierKey, []);
        tierPairedTrue.get(tierKey).push(row.trueValue);
        // Deduplicate market: four Early 1sts share one KTC quote each year.
        if (!tierMarketSeen.has(tierKey)) {
          tierMarketSeen.add(tierKey);
          if (!tierMarket.has(tierKey)) tierMarket.set(tierKey, []);
          tierMarket.get(tierKey).push(row.pickValue);
        }
      }
    }

    if (yearHasMarket) marketYears.add(year);
  }

  const slots = [];
  for (let overallSlot = 1; overallSlot <= TOP_ROOKIES; overallSlot += 1) {
    const meta = slotToPick(avgYears[0], overallSlot);
    const summary = summarizeTrueMarket(
      slotTrue.get(meta.draftSlot) || [],
      slotMarket.get(meta.draftSlot) || [],
      slotPairedTrue.get(meta.draftSlot) || [],
    );
    slots.push({
      draftSlot: meta.draftSlot,
      overallSlot,
      round: meta.round,
      pickInRound: meta.pickInRound,
      tier: meta.tier,
      tierLabel: `${meta.tier} ${ROUND_ORD[meta.round]}`,
      ...summary,
      valuesByYear: Object.fromEntries(
        avgYears.map((year) => {
          const row = byYear.get(year)?.rows.find((r) => r.draftSlot === meta.draftSlot);
          return [year, row?.trueValue ?? null];
        }),
      ),
    });
  }

  const rounds = [1, 2, 3, 4].map((round) => {
    const summary = summarizeTrueMarket(
      roundTrue.get(round) || [],
      roundMarket.get(round) || [],
      roundPairedTrue.get(round) || [],
    );
    return {
      round,
      label: ROUND_LABELS[round],
      ...summary,
    };
  });

  const tiers = [];
  for (const round of [1, 2, 3, 4]) {
    for (const tier of TIER_ORDER) {
      const key = `${tier} ${ROUND_ORD[round]}`;
      const summary = summarizeTrueMarket(
        tierTrue.get(key) || [],
        tierMarket.get(key) || [],
        tierPairedTrue.get(key) || [],
      );
      tiers.push({
        key,
        tier,
        round,
        roundOrd: ROUND_ORD[round],
        label: key,
        ...summary,
      });
    }
  }

  return {
    years: avgYears,
    marketYears: [...marketYears].sort((a, b) => a - b),
    windowSize,
    slots,
    rounds,
    tiers,
  };
}

/**
 * Load all years and return { byYear: Map, years, multipliers, averageChart }.
 */
export async function loadTrueRookiePickValueData() {
  const [{ rookiesByYear, picksByDateName, pickDatesByName }, multipliers] = await Promise.all([
    loadRawData(),
    loadHwangPositionMultipliers('true'),
  ]);

  const byYear = new Map();
  for (const year of TRUE_ROOKIE_PICK_YEARS) {
    const rookies = rookiesByYear.get(year) || [];
    if (rookies.length === 0) continue;
    byYear.set(
      year,
      buildYearModel(year, rookies, multipliers, picksByDateName, pickDatesByName),
    );
  }

  const years = TRUE_ROOKIE_PICK_YEARS.filter((y) => byYear.has(y));
  let averageChart = buildAveragePickChart(byYear, years, AVERAGE_SEASON_WINDOW);

  // Prefer the published chart used site-wide (Trade Calculator, rosters, HwangAI).
  try {
    const publishedRes = await fetch('/data/true_rookie_pick_chart.json');
    if (publishedRes.ok) {
      const published = await publishedRes.json();
      if (published?.tiers?.length && published?.slots?.length) {
        averageChart = {
          years: published.years || averageChart.years,
          marketYears: published.marketYears || averageChart.marketYears,
          windowSize: published.windowSize || AVERAGE_SEASON_WINDOW,
          slots: published.slots,
          rounds: published.rounds,
          tiers: published.tiers,
        };
      }
    }
  } catch (_) {
    /* keep computed chart */
  }

  return {
    byYear,
    years,
    multipliers,
    averageChart,
  };
}
