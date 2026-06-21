/**
 * Loaders for the sandbox Rankings Viewer.
 * Returns a normalised { rows, meta } shape for each source.
 */

import { formatKtcValue } from '../lookups/KtcLookup';
import { fetchFantasyCalcData } from '../lookups/FantasyCalcLookup';
import { fetchFfbData } from '../lookups/FfbLookup';
import {
  ADP_TYPES,
  KTC_CURRENT_FORMATS,
  KTC_HISTORICAL_VARIANTS,
  KTC_ROOKIE_CLASS_YEARS,
  KTC_ROOKIE_VALUES,
  FINAL_KTC_YEARS,
  HWANG_ADP_YEARS,
  FP_ECR_SOURCES,
} from './rankingsSources';
import { normalisePlayerName } from '../utils/playerNameMatcher';
import { loadRedraftRankLookup } from '../redraftValueIndex/redraftRankLookupLoader';
import { assignPosValueRanks, assignOverallValueRanks } from '../lookups/RedraftValueLookup';
import { loadHwangAdjustedKtcRankings } from './hwangValueAdjustmentLoader';
import { loadHvorpAdjustedRankings } from './hvorpValueAdjustmentLoader';

export { formatKtcValue };

let playersDataCache = null;
/** @type {Map<string, Map<string, object[]>>} */
const ktcHistoricalCache = new Map();
let ktcDatesCache = null;
let ktcDraftYearsCache = null;
let ktcRedraftValueCache = null;
/** @type {Map<number, object[]> | null} */
let hwangAdpByYearCache = null;
/** @type {Map<number, object[]> | null} */
let finalKtcValuesCache = null;
/** @type {object[] | null} */
let finalKtcRedraftCache = null;
/** @type {Map<number, Map<string, object>> | null} */
let finalKtcRedraftLookupCache = null;

const REDRAFT_VALUE_CSV = '/data/ktc_redraft_value_index.csv';
const HWANG_ADP_CSV = '/data/hwang_adjusted_positional_adp.csv';
const FINAL_KTC_CSV = '/data/final_ktc_values.csv';
const FINAL_KTC_REDRAFT_CSV = '/data/final_ktc_redraft_value_index.csv';
const FINAL_KTC_REDRAFT_LOOKUP_CSV = '/data/final_ktc_redraft_rank_lookup.csv';

const PICK_RE = /^\d{4}\s+(Early|Mid|Late)\s/i;

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

async function loadPlayersData() {
  if (playersDataCache) return playersDataCache;
  const res = await fetch('/data/players.txt');
  if (!res.ok) throw new Error('Failed to fetch players.txt');
  playersDataCache = await res.json();
  return playersDataCache;
}

function buildPlayerLookup(playersData) {
  const map = new Map();
  for (const [id, p] of Object.entries(playersData || {})) {
    const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
    const norm = normalisePlayerName(name);
    const pos = (p.position || '').trim().toUpperCase();
    if (!norm || !pos) continue;
    const key = `${norm}|${pos}`;
    if (!map.has(key)) map.set(key, id);
  }
  return map;
}

function resolveSleeperId(row, playersData) {
  const direct = (row.sleeperId || '').trim();
  if (direct) return direct;
  if (!row.name || !row.position || !playersData) return '';
  const lookup = buildPlayerLookup(playersData);
  return lookup.get(`${normalisePlayerName(row.name)}|${row.position.toUpperCase()}`) || '';
}

function enrichFromSleeper(row, playersData) {
  if (!playersData) return row;

  const sleeperId = resolveSleeperId(row, playersData);
  const merged = { ...row, sleeperId: sleeperId || row.sleeperId || '' };
  const p = merged.sleeperId ? playersData[merged.sleeperId] : null;

  const csvTeam = (row.team || '').trim();
  const sleeperTeam = (p?.team || p?.team_abbr || '').trim().toUpperCase();
  let team = csvTeam;
  if ((!team || team === 'FA') && sleeperTeam) {
    team = sleeperTeam;
  }

  if (!p) {
    return { ...merged, team: team || csvTeam };
  }

  return {
    ...merged,
    position: merged.position || p.position || (p.fantasy_positions && p.fantasy_positions[0]) || '',
    team: team || p.team || p.team_abbr || '',
  };
}

function isPickName(name) {
  return PICK_RE.test(name || '');
}

function cloneHistoricalRow(row) {
  return { ...row };
}

function assignRanks(rows, valueKey = 'value') {
  const sorted = [...rows].sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0));
  sorted.forEach((row, idx) => {
    row.rank = idx + 1;
  });
  return rows;
}

function computePosRanks(rows) {
  const byPos = {};
  for (const row of rows) {
    const pos = row.position || 'UNK';
    if (!byPos[pos]) byPos[pos] = [];
    byPos[pos].push(row);
  }
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => (b.value || 0) - (a.value || 0));
    byPos[pos].forEach((row, idx) => {
      row.posRank = idx + 1;
    });
  }
  return rows;
}

export async function loadAdpRankings(adpType, year) {
  const cfg = ADP_TYPES[adpType];
  if (!cfg || !cfg.years.includes(Number(year))) {
    throw new Error(`ADP ${adpType} is not available for ${year}`);
  }

  const path = `/data/adp/fantasypros_adp_${adpType}_${year}.csv`;
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ADP file for ${year}`);

  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { rows: [], meta: { year, sourceLabel: cfg.label } };

  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const rank = parseInt(cols[idx('rank')], 10);
    const name = (cols[idx('name')] || '').trim();
    if (!name || !Number.isFinite(rank)) continue;

    rows.push({
      rank,
      name,
      position: (cols[idx('position')] || '').trim(),
      team: (cols[idx('team')] || '').trim(),
      posRank: parseInt(cols[idx('pos_rank')], 10) || null,
      value: parseFloat(cols[idx('avg')]) || null,
      sleeperId: (cols[idx('sleeper_id')] || '').trim(),
    });
  }

  rows.sort((a, b) => a.rank - b.rank);
  return {
    rows,
    meta: {
      year: String(year),
      sourceLabel: cfg.label,
      rowCount: rows.length,
    },
  };
}

export async function loadKtcRedraftAdjustedRankings() {
  if (ktcRedraftValueCache) return ktcRedraftValueCache;

  const [res, rankLookup] = await Promise.all([
    fetch(REDRAFT_VALUE_CSV),
    loadRedraftRankLookup(),
  ]);
  if (!res.ok) throw new Error('Failed to fetch ktc_redraft_value_index.csv');

  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) {
    return { rows: [], meta: { sourceLabel: 'KTC — Competitor Adjusted Value', rowCount: 0 } };
  }

  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);

  const playersData = await loadPlayersData();
  let asOf = null;
  let adpSource = null;
  let premiumRetention = null;
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const name = (cols[idx('name')] || '').trim();
    const position = (cols[idx('position')] || '').trim();
    if (!name) continue;

    const adjustedRaw = (cols[idx('competitor_adjusted_value')] || cols[idx('redraft_adjusted_value')] || '').trim();
    const adjusted = adjustedRaw ? parseInt(adjustedRaw, 10) : null;
    if (!Number.isFinite(adjusted)) continue;

    if (!asOf) asOf = (cols[idx('as_of')] || '').trim() || null;
    if (!adpSource) adpSource = (cols[idx('adp_source')] || '').trim() || null;

    const stackRankRaw = (cols[idx('adp_stack_rank')] || cols[idx('adp_pos_rank')] || '').trim();
    const stackRank = stackRankRaw ? parseInt(stackRankRaw, 10) : null;
    const adpEffRaw = (cols[idx('adp_eff_rank')] || '').trim();
    const adpEffRank = adpEffRaw ? parseFloat(adpEffRaw) : null;
    const adpAvgRaw = (cols[idx('adp_avg')] || '').trim();
    const adpAvg = adpAvgRaw ? parseFloat(adpAvgRaw) : null;
    const bbAvgRaw = (cols[idx('bb_avg_adp')] || '').trim();
    const bbAvgAdp = bbAvgRaw ? parseFloat(bbAvgRaw) : null;
    const rowPremiumRetentionRaw = (cols[idx('premium_retention')] || '').trim();
    const rowPremiumRetention = rowPremiumRetentionRaw ? parseFloat(rowPremiumRetentionRaw) : null;

    const base = {
      name,
      position,
      team: (cols[idx('team')] || '').trim(),
      value: adjusted,
      ktcValue: parseInt(cols[idx('ktc_value')], 10) || null,
      redraftValueIndex: parseFloat(cols[idx('redraft_value_index')]) || null,
      ktcPosRank: parseInt(cols[idx('ktc_pos_rank')], 10) || null,
      adpPosRank: stackRank,
      adpEffRank: Number.isFinite(adpEffRank) ? adpEffRank : null,
      adpAvg: Number.isFinite(adpAvg) ? adpAvg : null,
      bbAvgAdp: Number.isFinite(bbAvgAdp) ? bbAvgAdp : null,
      premiumRetention: Number.isFinite(rowPremiumRetention) ? rowPremiumRetention : null,
      sleeperId: '',
    };
    if (base.ktcPosRank != null && base.adpEffRank != null) {
      base.rankDelta = Math.round((base.adpEffRank - base.ktcPosRank) * 100) / 100;
    } else if (base.ktcPosRank != null && base.adpPosRank != null) {
      base.rankDelta = base.adpPosRank - base.ktcPosRank;
    }
    const rebuilderRaw = (cols[idx('rebuilder_adjusted_value')] || '').trim();
    const rebuilderParsed = rebuilderRaw ? parseInt(rebuilderRaw, 10) : null;
    if (Number.isFinite(rebuilderParsed)) {
      base.rebuilderAdjustedValue = rebuilderParsed;
    }
    base.rebuildValueIndex = parseFloat(cols[idx('rebuild_value_index')]) || null;
    rows.push(enrichFromSleeper(base, playersData));
    if (premiumRetention == null && base.premiumRetention != null) {
      premiumRetention = base.premiumRetention;
    }
  }

  assignRanks(rows);
  computePosRanks(rows);
  assignOverallValueRanks(rows, 'rebuilderAdjustedValue', 'rebuilderOverallRank');
  assignPosValueRanks(rows, 'rebuilderAdjustedValue', 'rebuilderPosRank');
  rows.sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

  const result = {
    rows,
    meta: {
      sourceLabel: 'KTC — Competitor Adjusted Value',
      asOf,
      adpSource,
      usesHwangAdp: (adpSource || '').includes('hwang_adjusted'),
      premiumRetention,
      rowCount: rows.length,
      rankLookup,
    },
  };

  ktcRedraftValueCache = result;
  return result;
}

export async function loadHwangAdjustedAdpRankings(year) {
  const yearNum = Number(year);
  if (!HWANG_ADP_YEARS.includes(yearNum)) {
    throw new Error(`Hwang adjusted ADP is not available for ${year}`);
  }

  if (!hwangAdpByYearCache) {
    const res = await fetch(HWANG_ADP_CSV);
    if (!res.ok) throw new Error('Failed to fetch hwang_adjusted_positional_adp.csv');

    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) {
      hwangAdpByYearCache = new Map();
    } else {
      const headers = parseCsvRow(lines[0]);
      const idx = (name) => headers.indexOf(name);
      const hasYearCol = idx('year') >= 0;
      const byYear = new Map();

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvRow(lines[i]);
        const rowYear = hasYearCol
          ? parseInt((cols[idx('year')] || '').trim(), 10)
          : HWANG_ADP_YEARS[HWANG_ADP_YEARS.length - 1];
        const name = (cols[idx('name')] || '').trim();
        const position = (cols[idx('position')] || '').trim();
        if (!Number.isFinite(rowYear) || !name) continue;

        const hwangAdp = parseFloat((cols[idx('hwang_adjusted_adp')] || '').trim());
        if (!Number.isFinite(hwangAdp)) continue;

        const parseOptionalInt = (col) => {
          const raw = (cols[idx(col)] || '').trim();
          if (!raw) return null;
          const n = parseInt(raw, 10);
          return Number.isFinite(n) ? n : null;
        };
        const parseOptionalFloat = (col) => {
          const raw = (cols[idx(col)] || '').trim();
          if (!raw) return null;
          const n = parseFloat(raw);
          return Number.isFinite(n) ? n : null;
        };

        const base = {
          year: rowYear,
          rank: parseInt(cols[idx('overall_rank')], 10) || null,
          name,
          position,
          team: (cols[idx('team')] || '').trim(),
          value: hwangAdp,
          posRank: parseOptionalInt('hwang_pos_rank'),
          bbAvgAdp: parseOptionalFloat('bb_avg_adp'),
          bbStackRank: parseOptionalInt('bb_stack_rank'),
          bbEffRank: parseOptionalFloat('bb_eff_rank'),
          halfStackRank: parseOptionalInt('half_stack_rank'),
          stdStackRank: parseOptionalInt('std_stack_rank'),
          scoringRankShift: parseOptionalInt('scoring_rank_shift'),
          hwangEffRank: parseOptionalFloat('hwang_eff_rank'),
          adpDelta: parseOptionalFloat('adp_delta'),
          adpSource: (cols[idx('adp_source')] || '').trim() || null,
          scoringSource: (cols[idx('scoring_source')] || '').trim() || null,
          sleeperId: (cols[idx('sleeper_id')] || '').trim(),
        };

        if (!byYear.has(rowYear)) byYear.set(rowYear, []);
        byYear.get(rowYear).push(base);
      }

      hwangAdpByYearCache = byYear;
    }
  }

  const playersData = await loadPlayersData();
  const yearRows = hwangAdpByYearCache?.get(yearNum) || [];
  if (yearRows.length === 0) {
    throw new Error(`No Hwang adjusted ADP data for ${year}`);
  }

  const rows = yearRows
    .map((row) => enrichFromSleeper({ ...row }, playersData))
    .sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

  const adpSource = rows.find((r) => r.adpSource)?.adpSource
    || `hwang_adjusted_positional_adp_${yearNum}`;
  const scoringSource = rows.find((r) => r.scoringSource)?.scoringSource || null;

  return {
    rows,
    meta: {
      sourceLabel: 'Hwang Adjusted Positional ADP',
      year: String(yearNum),
      adpSource,
      scoringSource,
      rowCount: rows.length,
    },
  };
}

export async function loadKtcCurrentRankings(format) {
  const cfg = KTC_CURRENT_FORMATS[format];
  if (!cfg) throw new Error(`Unknown KTC format: ${format}`);

  const res = await fetch('/data/ktc_values.csv');
  if (!res.ok) throw new Error('Failed to fetch ktc_values.csv');
  const text = await res.text();

  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const idx = (name) => headers.indexOf(name);
  const asOfIdx = idx('as_of');
  const isTepFormat = format === 'tep_1qb' || format === 'tep_sf';
  const baseValueKey = format === '1qb' || format === 'tep_1qb'
    ? 'ktc_value_1qb'
    : 'ktc_value_2qb';
  const tepValueKey = format === 'tep_1qb' ? 'ktc_value_tep_1qb' : 'ktc_value_tep_2qb';
  const valueIdx = idx(cfg.valueKey);
  const rankIdx = idx(cfg.rankKey);

  let asOf = null;
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const name = (cols[idx('name')] || '').trim();
    const position = (cols[idx('position')] || '').trim();
    if (!name) continue;
    if (!asOf && asOfIdx >= 0) asOf = (cols[asOfIdx] || '').trim();

    let value;
    if (isTepFormat) {
      const valueKey = position === 'TE' ? tepValueKey : baseValueKey;
      value = parseInt(cols[idx(valueKey)], 10);
    } else {
      value = parseInt(cols[valueIdx], 10);
    }
    if (!Number.isFinite(value)) continue;

    rows.push({
      name,
      position,
      team: (cols[idx('team')] || '').trim(),
      value,
      rank: isTepFormat ? null : (rankIdx >= 0 ? (parseInt(cols[rankIdx], 10) || null) : null),
      sleeperId: '',
    });
  }

  if (isTepFormat) {
    assignRanks(rows);
    computePosRanks(rows);
  } else {
    computePosRanks(rows);
  }
  rows.sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

  return {
    rows,
    meta: {
      asOf,
      sourceLabel: cfg.label,
      rowCount: rows.length,
      stitched: isTepFormat,
    },
  };
}

export async function fetchKtcHistoricalDates() {
  if (ktcDatesCache) return ktcDatesCache;
  const res = await fetch('/data/ktc_historical_dates.json');
  if (!res.ok) throw new Error('Failed to fetch ktc_historical_dates.json');
  ktcDatesCache = await res.json();
  return ktcDatesCache;
}

/** Date list for a historical variant. SF TE+ uses merged sf_ktc_values_historical.csv. */
export async function getKtcHistoricalDateList(variant) {
  const datesJson = await fetchKtcHistoricalDates();
  const key = variant === 'sf_tep' ? 'sf_tep' : 'sf_non_tep';
  return datesJson[key]?.dates || datesJson.sf_ktc?.dates || [];
}

async function loadKtcHistoricalIndex(variant) {
  const cfg = KTC_HISTORICAL_VARIANTS[variant];
  if (!cfg) throw new Error(`Unknown KTC historical variant: ${variant}`);

  if (ktcHistoricalCache.has(variant)) {
    return ktcHistoricalCache.get(variant);
  }

  const res = await fetch(cfg.file);
  if (!res.ok) throw new Error(`Failed to fetch ${cfg.file}`);

  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const byDate = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    if (cols.length < 3) continue;
    const date = cols[0];
    const name = cols[1];
    const value = parseInt(cols[2], 10);
    if (!date || !name || !Number.isFinite(value)) continue;

    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({
      name,
      value,
      sleeperId: (cols[4] || '').trim(),
      position: '',
      team: '',
    });
  }

  for (const rows of byDate.values()) {
    assignRanks(rows);
  }

  ktcHistoricalCache.set(variant, byDate);
  return byDate;
}

async function loadKtcDraftYearMap() {
  if (ktcDraftYearsCache) return ktcDraftYearsCache;
  const res = await fetch('/data/ktc_draft_years.json');
  if (!res.ok) throw new Error('Failed to fetch ktc_draft_years.json');
  ktcDraftYearsCache = await res.json();
  return ktcDraftYearsCache;
}

function getDraftYear(row, draftMap, playersData) {
  if (row.sleeperId && draftMap.bySleeperId?.[row.sleeperId]) {
    return Number(draftMap.bySleeperId[row.sleeperId]);
  }
  if (row.name && draftMap.byName?.[row.name]) {
    return Number(draftMap.byName[row.name]);
  }
  const norm = normalisePlayerName(row.name);
  if (norm && draftMap.byNormalisedName?.[norm]) {
    return Number(draftMap.byNormalisedName[norm]);
  }
  if (row.sleeperId && playersData?.[row.sleeperId]?.metadata?.rookie_year) {
    return Number(playersData[row.sleeperId].metadata.rookie_year);
  }
  return null;
}

function rookieSnapshotDate(classYear, cfg) {
  const month = String(cfg.snapshotMonth || 5).padStart(2, '0');
  const day = String(cfg.snapshotDay || 20).padStart(2, '0');
  return `${classYear}-${month}-${day}`;
}

async function loadKtcCurrentRookieClassRows(classYearNum, draftMap, playersData) {
  const res = await fetch('/data/ktc_values.csv');
  if (!res.ok) throw new Error('Failed to fetch ktc_values.csv');
  const text = await res.text();
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const idx = (name) => headers.indexOf(name);
  const asOfIdx = idx('as_of');

  let asOf = null;
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const name = (cols[idx('name')] || '').trim();
    const value = parseInt(cols[idx('ktc_value_2qb')], 10);
    if (!name || !Number.isFinite(value)) continue;
    if (!asOf && asOfIdx >= 0) asOf = (cols[asOfIdx] || '').trim();

    const base = {
      name,
      position: (cols[idx('position')] || '').trim(),
      team: (cols[idx('team')] || '').trim(),
      value,
      sleeperId: '',
    };
    const enriched = enrichFromSleeper(base, playersData);
    if (getDraftYear(enriched, draftMap, playersData) !== classYearNum) continue;
    rows.push(enriched);
  }

  assignRanks(rows);
  computePosRanks(rows);
  return { rows, asOf };
}

export async function loadKtcRookieValuesRankings(rookieKey, classYear) {
  const cfg = KTC_ROOKIE_VALUES[rookieKey];
  if (!cfg) throw new Error(`Unknown KTC rookie source: ${rookieKey}`);

  const classYearNum = Number(classYear);
  if (!KTC_ROOKIE_CLASS_YEARS.includes(classYearNum)) {
    throw new Error(`Draft class ${classYear} is not available`);
  }

  const snapshotDate = rookieSnapshotDate(classYearNum, cfg);
  const [draftMap, playersData] = await Promise.all([
    loadKtcDraftYearMap(),
    loadPlayersData(),
  ]);

  const byDate = await loadKtcHistoricalIndex(cfg.variant);
  const dayRows = byDate.get(snapshotDate) || [];

  let rows = [];
  let usedFallback = false;
  let asOf = null;

  if (dayRows.length > 0) {
    rows = dayRows
      .filter((row) => !isPickName(row.name))
      .map((row) => enrichFromSleeper(cloneHistoricalRow(row), playersData))
      .filter((row) => getDraftYear(row, draftMap, playersData) === classYearNum);
  }

  if (rows.length === 0) {
    // 2025+ draft classes are not yet columns in the community historical sheet.
    const current = await loadKtcCurrentRookieClassRows(classYearNum, draftMap, playersData);
    rows = current.rows;
    asOf = current.asOf;
    usedFallback = true;
  }

  if (rows.length === 0) {
    throw new Error(`No ${classYear} draft class players found`);
  }

  if (!usedFallback) {
    assignRanks(rows);
    computePosRanks(rows);
  }

  return {
    rows,
    meta: {
      sourceLabel: cfg.label,
      year: String(classYearNum),
      date: usedFallback ? asOf : snapshotDate,
      snapshotLabel: usedFallback
        ? `current KTC (May ${cfg.snapshotDay || 20}, ${classYearNum} not in historical sheet)`
        : `May ${cfg.snapshotDay || 20}, ${classYearNum}`,
      rowCount: rows.length,
      usedCurrentFallback: usedFallback,
    },
  };
}

async function loadFinalKtcValuesIndex() {
  if (finalKtcValuesCache) return finalKtcValuesCache;

  const res = await fetch(FINAL_KTC_CSV);
  if (!res.ok) throw new Error('Failed to fetch final_ktc_values.csv');

  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    finalKtcValuesCache = new Map();
    return finalKtcValuesCache;
  }

  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);
  const byYear = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const year = parseInt((cols[idx('year')] || '').trim(), 10);
    const name = (cols[idx('name')] || '').trim();
    const value = parseInt((cols[idx('ktc_value')] || '').trim(), 10);
    if (!Number.isFinite(year) || !name || !Number.isFinite(value)) continue;

    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({
      name,
      value,
      position: (cols[idx('position')] || '').trim(),
      sleeperId: (cols[idx('sleeper_id')] || '').trim(),
      team: '',
      date: (cols[idx('date')] || '').trim(),
    });
  }

  for (const rows of byYear.values()) {
    assignRanks(rows);
    computePosRanks(rows);
  }

  finalKtcValuesCache = byYear;
  return byYear;
}

async function loadFinalKtcRedraftIndex() {
  if (finalKtcRedraftCache) return finalKtcRedraftCache;

  const res = await fetch(FINAL_KTC_REDRAFT_CSV);
  if (!res.ok) throw new Error('Failed to fetch final_ktc_redraft_value_index.csv');

  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    finalKtcRedraftCache = [];
    return finalKtcRedraftCache;
  }

  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);
  finalKtcRedraftCache = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const year = parseInt((cols[idx('year')] || '').trim(), 10);
    const name = (cols[idx('name')] || '').trim();
    const position = (cols[idx('position')] || '').trim();
    if (!Number.isFinite(year) || !name) continue;

    const adjustedRaw = (cols[idx('competitor_adjusted_value')] || '').trim();
    const adjusted = adjustedRaw ? parseInt(adjustedRaw, 10) : null;
    if (!Number.isFinite(adjusted)) continue;

    const parseOptionalInt = (col) => {
      const raw = (cols[idx(col)] || '').trim();
      if (!raw) return null;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    };
    const parseOptionalFloat = (col) => {
      const raw = (cols[idx(col)] || '').trim();
      if (!raw) return null;
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : null;
    };

    const stackRank = parseOptionalInt('adp_stack_rank');
    const adpEffRank = parseOptionalFloat('adp_eff_rank');
    const ktcPosRank = parseOptionalInt('ktc_pos_rank');

    const base = {
      year,
      ktcSnapshotDate: (cols[idx('ktc_snapshot_date')] || '').trim(),
      name,
      position,
      team: (cols[idx('team')] || '').trim(),
      value: adjusted,
      ktcValue: parseOptionalInt('ktc_value'),
      redraftValueIndex: parseOptionalFloat('redraft_value_index'),
      ktcPosRank,
      adpPosRank: stackRank,
      adpEffRank,
      adpAvg: parseOptionalFloat('adp_avg'),
      bbAvgAdp: parseOptionalFloat('bb_avg_adp'),
      sleeperId: '',
      adpSource: (cols[idx('adp_source')] || '').trim() || null,
    };
    if (ktcPosRank != null && adpEffRank != null) {
      base.rankDelta = Math.round((adpEffRank - ktcPosRank) * 100) / 100;
    } else if (ktcPosRank != null && stackRank != null) {
      base.rankDelta = stackRank - ktcPosRank;
    }
    const rebuilderParsed = parseOptionalInt('rebuilder_adjusted_value');
    if (rebuilderParsed != null) base.rebuilderAdjustedValue = rebuilderParsed;
    base.rebuildValueIndex = parseOptionalFloat('rebuild_value_index');
    finalKtcRedraftCache.push(base);
  }

  return finalKtcRedraftCache;
}

async function loadFinalKtcRedraftRankLookup(year) {
  const yearNum = Number(year);
  if (finalKtcRedraftLookupCache?.has(yearNum)) {
    return finalKtcRedraftLookupCache.get(yearNum);
  }

  const res = await fetch(FINAL_KTC_REDRAFT_LOOKUP_CSV);
  if (!res.ok) throw new Error('Failed to fetch final_ktc_redraft_rank_lookup.csv');

  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);

  if (!finalKtcRedraftLookupCache) finalKtcRedraftLookupCache = new Map();

  const byYear = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const rowYear = parseInt((cols[idx('year')] || '').trim(), 10);
    const position = (cols[idx('position')] || '').trim();
    const rank = parseInt((cols[idx('rank')] || '').trim(), 10);
    if (!Number.isFinite(rowYear) || !position || !Number.isFinite(rank)) continue;

    if (!byYear.has(rowYear)) byYear.set(rowYear, new Map());
    const map = byYear.get(rowYear);

    const weightedRaw = (cols[idx('weighted_hist_avg')] || '').trim();
    const finalKtcRaw = (cols[idx('final_ktc_at_rank')] || '').trim();
    const blendedRaw = (cols[idx('blended_lookup_value')] || '').trim();

    map.set(`${position}:${rank}`, {
      position,
      rank,
      weighted_hist_avg: weightedRaw ? parseFloat(weightedRaw) : null,
      current_ktc_at_rank: finalKtcRaw ? parseInt(finalKtcRaw, 10) : null,
      blended_lookup_value: blendedRaw ? parseFloat(blendedRaw) : null,
    });
  }

  for (const [y, map] of byYear.entries()) {
    finalKtcRedraftLookupCache.set(y, map);
  }

  return finalKtcRedraftLookupCache.get(yearNum) || new Map();
}

export async function loadFinalKtcRedraftAdjustedRankings(year) {
  const yearNum = Number(year);
  if (!FINAL_KTC_YEARS.includes(yearNum)) {
    throw new Error(`Final KTC redraft values are not available for ${year}`);
  }

  const [allRows, rankLookup, playersData] = await Promise.all([
    loadFinalKtcRedraftIndex(),
    loadFinalKtcRedraftRankLookup(yearNum),
    loadPlayersData(),
  ]);

  const yearRows = allRows.filter((row) => row.year === yearNum);
  if (yearRows.length === 0) {
    throw new Error(`No final KTC redraft data for ${year}`);
  }

  const rows = yearRows.map((row) => enrichFromSleeper({ ...row }, playersData));
  assignRanks(rows);
  computePosRanks(rows);
  assignOverallValueRanks(rows, 'rebuilderAdjustedValue', 'rebuilderOverallRank');
  assignPosValueRanks(rows, 'rebuilderAdjustedValue', 'rebuilderPosRank');
  rows.sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

  const snapshotDate = rows[0]?.ktcSnapshotDate || '';

  return {
    rows,
    meta: {
      sourceLabel: 'Final KTC — Competitor Adjusted Value',
      year: String(yearNum),
      date: snapshotDate,
      snapshotLabel: `${yearNum} preseason snapshot (${snapshotDate}) · 50% hist + 50% final KTC lookup`,
      adpSource: `hwang_adjusted_positional_adp_${yearNum}`,
      usesHwangAdp: true,
      rowCount: rows.length,
      rankLookup,
    },
  };
}

export async function loadFinalKtcValuesRankings(year) {
  const yearNum = Number(year);
  if (!FINAL_KTC_YEARS.includes(yearNum)) {
    throw new Error(`Final KTC values are not available for ${year}`);
  }

  const [byYear, playersData] = await Promise.all([
    loadFinalKtcValuesIndex(),
    loadPlayersData(),
  ]);

  const dayRows = byYear.get(yearNum) || [];
  if (dayRows.length === 0) {
    throw new Error(`No final KTC data for ${year}`);
  }

  const rows = dayRows.map((row) => enrichFromSleeper(cloneHistoricalRow(row), playersData));
  const snapshotDate = rows[0]?.date || '';

  return {
    rows,
    meta: {
      sourceLabel: 'Final KTC Values — SF TE+',
      date: snapshotDate,
      snapshotLabel: `${yearNum} preseason snapshot (${snapshotDate})`,
      rowCount: rows.length,
    },
  };
}

export async function loadKtcHistoricalRankings(variant, date) {
  const cfg = KTC_HISTORICAL_VARIANTS[variant];
  const playersData = await loadPlayersData();

  const byDate = await loadKtcHistoricalIndex(variant);
  const rows = (byDate.get(date) || []).map((row) => enrichFromSleeper(cloneHistoricalRow(row), playersData));

  if (rows.length === 0) {
    throw new Error(`No KTC data for ${date}`);
  }

  computePosRanks(rows);

  return {
    rows,
    meta: {
      date,
      sourceLabel: cfg.label,
      rowCount: rows.length,
      stitched: false,
    },
  };
}

export async function loadFantasyCalcRankings() {
  const { bySleeperId } = await fetchFantasyCalcData();
  const rows = Array.from(bySleeperId.values()).map((entry) => ({
    rank: entry.overallRank,
    name: entry.name,
    position: entry.position,
    team: entry.team,
    value: entry.value,
    posRank: entry.posRank,
    sleeperId: entry.sleeperId,
  }));
  rows.sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

  return {
    rows,
    meta: {
      sourceLabel: 'FantasyCalc Dynasty',
      rowCount: rows.length,
    },
  };
}

export async function loadFfbRankings() {
  const { bySleeperId } = await fetchFfbData();
  const playersData = await loadPlayersData();

  const rows = Array.from(bySleeperId.values()).map((entry) => {
    const base = {
      rank: entry.rank,
      name: entry.name,
      value: null,
      posRank: null,
      sleeperId: entry.sleeperId,
      position: '',
      team: '',
    };
    return enrichFromSleeper(base, playersData);
  });
  rows.sort((a, b) => a.rank - b.rank);

  return {
    rows,
    meta: {
      sourceLabel: 'FFB Dynasty Rankings',
      rowCount: rows.length,
    },
  };
}

async function loadSingleFpCsv(path, position) {
  const res = await fetch(path);
  if (!res.ok) return [];
  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',');
  const rankIdx = headers.indexOf('rank');
  const nameIdx = headers.indexOf('name');
  const teamIdx = headers.indexOf('team');
  const posIdx = headers.indexOf('position');
  const sleeperIdx = headers.indexOf('sleeper_id');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const rank = parseInt(cols[rankIdx], 10);
    const name = (cols[nameIdx] || '').trim();
    if (!name || !Number.isFinite(rank)) continue;

    rows.push({
      rank,
      name,
      position: (cols[posIdx] || position || '').trim(),
      team: (cols[teamIdx] || '').trim(),
      value: null,
      posRank: null,
      sleeperId: (cols[sleeperIdx] || '').trim(),
    });
  }
  return rows;
}

export async function loadFpRankings(fpKey) {
  const cfg = FP_ECR_SOURCES[fpKey];
  if (!cfg) throw new Error(`Unknown FantasyPros source: ${fpKey}`);

  let rows = [];
  if (fpKey === 'all') {
    const parts = await Promise.all(
      Object.entries(FP_ECR_SOURCES)
        .filter(([key]) => key !== 'all')
        .map(([, c]) => loadSingleFpCsv(c.path, c.position)),
    );
    rows = parts.flat().sort((a, b) => a.rank - b.rank);
  } else {
    rows = await loadSingleFpCsv(cfg.path, cfg.position);
    rows.sort((a, b) => a.rank - b.rank);
  }

  return {
    rows,
    meta: {
      sourceLabel: cfg.label,
      rowCount: rows.length,
    },
  };
}

export async function loadRankings(sourceOption, { year, date } = {}) {
  switch (sourceOption.kind) {
    case 'adp':
      return loadAdpRankings(sourceOption.adpType, year);
    case 'ktc_current':
      return loadKtcCurrentRankings(sourceOption.format);
    case 'ktc_redraft_adjusted':
      return loadKtcRedraftAdjustedRankings();
    case 'hwang_adjusted_adp':
      return loadHwangAdjustedAdpRankings(year);
    case 'hwang_market_value_adjusted_ktc':
      return loadHwangAdjustedKtcRankings('market');
    case 'hwang_true_value_adjusted_ktc':
      return loadHwangAdjustedKtcRankings('true');
    case 'ktc_historical':
      return loadKtcHistoricalRankings(sourceOption.variant, date);
    case 'ktc_rookie':
      return loadKtcRookieValuesRankings(sourceOption.rookieKey, year);
    case 'final_ktc_values':
      return loadFinalKtcValuesRankings(year);
    case 'final_ktc_redraft_adjusted':
      return loadFinalKtcRedraftAdjustedRankings(year);
    case 'hvorp_values_empty_roster_final_ktc':
      return loadHvorpAdjustedRankings('final_ktc', year, loadFinalKtcValuesRankings);
    case 'hvorp_values_empty_roster_competitor_adjusted_final_ktc':
      return loadHvorpAdjustedRankings('comp_adj_final_ktc', year, loadFinalKtcRedraftAdjustedRankings);
    case 'fantasycalc':
      return loadFantasyCalcRankings();
    case 'ffb':
      return loadFfbRankings();
    case 'fp':
      return loadFpRankings(sourceOption.fpKey);
    default:
      throw new Error(`Unsupported source kind: ${sourceOption.kind}`);
  }
}

export function getYearsForSource(sourceOption) {
  if (sourceOption.kind === 'adp') {
    return ADP_TYPES[sourceOption.adpType]?.years || [];
  }
  if (sourceOption.kind === 'ktc_rookie') {
    return KTC_ROOKIE_CLASS_YEARS;
  }
  if (
    sourceOption.kind === 'final_ktc_values'
    || sourceOption.kind === 'final_ktc_redraft_adjusted'
    || sourceOption.kind === 'hvorp_values_empty_roster_final_ktc'
    || sourceOption.kind === 'hvorp_values_empty_roster_competitor_adjusted_final_ktc'
  ) {
    return FINAL_KTC_YEARS;
  }
  if (sourceOption.kind === 'hwang_adjusted_adp') {
    return HWANG_ADP_YEARS;
  }
  return [];
}

export function sourceUsesYear(sourceOption) {
  return sourceOption?.kind === 'adp'
    || sourceOption?.kind === 'ktc_rookie'
    || sourceOption?.kind === 'final_ktc_values'
    || sourceOption?.kind === 'final_ktc_redraft_adjusted'
    || sourceOption?.kind === 'hvorp_values_empty_roster_final_ktc'
    || sourceOption?.kind === 'hvorp_values_empty_roster_competitor_adjusted_final_ktc'
    || sourceOption?.kind === 'hwang_adjusted_adp';
}

export function sourceUsesDate(sourceOption) {
  return sourceOption?.kind === 'ktc_historical';
}
