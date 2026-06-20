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
  FP_ECR_SOURCES,
} from './rankingsSources';
import { normalisePlayerName } from '../utils/playerNameMatcher';

export { formatKtcValue };

let playersDataCache = null;
/** @type {Map<string, Map<string, object[]>>} */
const ktcHistoricalCache = new Map();
let ktcDatesCache = null;
let teNamesCache = null;
let ktcDraftYearsCache = null;

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

async function loadTeNameSet() {
  if (teNamesCache) return teNamesCache;
  const res = await fetch('/data/ktc_historical_name_ids.csv');
  if (!res.ok) {
    teNamesCache = new Set();
    return teNamesCache;
  }
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  const nameIdx = headers.indexOf('name');
  const posIdx = headers.indexOf('position');
  const names = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    if ((cols[posIdx] || '').trim() === 'TE') {
      names.add((cols[nameIdx] || '').trim());
    }
  }
  teNamesCache = names;
  return teNamesCache;
}

function isTeRow(row, teNames) {
  if (row.position === 'TE') return true;
  return teNames.has(row.name);
}

function enrichFromSleeper(row, playersData) {
  if (!row.sleeperId || !playersData) return row;
  const p = playersData[row.sleeperId];
  if (!p) return row;
  return {
    ...row,
    position: row.position || p.position || (p.fantasy_positions && p.fantasy_positions[0]) || '',
    team: row.team || p.team || p.team_abbr || '',
  };
}

function isPickName(name) {
  return PICK_RE.test(name || '');
}

function rowIdentityKey(row) {
  if (row.sleeperId) return `id:${row.sleeperId}`;
  return `name:${row.name}`;
}

function cloneHistoricalRow(row) {
  return { ...row };
}

function assignRanks(rows, valueKey = 'value') {
  const sorted = [...rows].sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0));
  return sorted.map((row, idx) => ({ ...row, rank: idx + 1 }));
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

/** Date list for a historical variant (TE+ uses dates present in both files). */
export async function getKtcHistoricalDateList(variant) {
  const datesJson = await fetchKtcHistoricalDates();
  if (variant === 'sf_tep') {
    const nonTep = new Set(datesJson.sf_non_tep?.dates || []);
    return (datesJson.sf_tep?.dates || []).filter((d) => nonTep.has(d));
  }
  const key = variant === 'sf_tep' ? 'sf_tep' : 'sf_non_tep';
  return datesJson[key]?.dates || [];
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

/**
 * Build a full SF TE+ board for one date:
 * non-TEP values for non-TEs, TE+ values where scraped, non-TEP fallback for other TEs.
 */
async function stitchKtcTepHistorical(date, playersData) {
  const teNames = await loadTeNameSet();
  const [nonTepByDate, tepByDate] = await Promise.all([
    loadKtcHistoricalIndex('sf_non_tep'),
    loadKtcHistoricalIndex('sf_tep'),
  ]);

  const tepByKey = new Map();
  for (const row of tepByDate.get(date) || []) {
    const enriched = enrichFromSleeper(cloneHistoricalRow(row), playersData);
    tepByKey.set(rowIdentityKey(enriched), {
      ...enriched,
      position: enriched.position || 'TE',
    });
  }

  const combinedByKey = new Map();
  let teFallbackCount = 0;

  for (const row of (nonTepByDate.get(date) || []).map((r) => cloneHistoricalRow(r))) {
    const enriched = enrichFromSleeper(row, playersData);
    const key = rowIdentityKey(enriched);

    if (isPickName(enriched.name)) {
      combinedByKey.set(key, enriched);
      continue;
    }

    if (tepByKey.has(key)) {
      continue;
    }

    if (isTeRow(enriched, teNames)) {
      combinedByKey.set(key, {
        ...enriched,
        position: enriched.position || 'TE',
      });
      teFallbackCount += 1;
      continue;
    }

    combinedByKey.set(key, enriched);
  }

  for (const [key, row] of tepByKey) {
    combinedByKey.set(key, row);
  }

  const combined = Array.from(combinedByKey.values());
  assignRanks(combined);
  computePosRanks(combined);

  return {
    rows: combined,
    teTepCount: tepByKey.size,
    teFallbackCount,
  };
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

export async function loadKtcHistoricalRankings(variant, date) {
  const cfg = KTC_HISTORICAL_VARIANTS[variant];
  const playersData = await loadPlayersData();

  let rows;
  let teTepCount = null;
  let teFallbackCount = null;
  if (variant === 'sf_tep') {
    const stitched = await stitchKtcTepHistorical(date, playersData);
    rows = stitched.rows;
    teTepCount = stitched.teTepCount;
    teFallbackCount = stitched.teFallbackCount;
  } else {
    const byDate = await loadKtcHistoricalIndex(variant);
    rows = (byDate.get(date) || []).map((row) => enrichFromSleeper(cloneHistoricalRow(row), playersData));
  }

  if (rows.length === 0) {
    throw new Error(`No KTC data for ${date}`);
  }

  return {
    rows,
    meta: {
      date,
      sourceLabel: cfg.label,
      rowCount: rows.length,
      stitched: variant === 'sf_tep',
      teTepCount,
      teFallbackCount,
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
    case 'ktc_historical':
      return loadKtcHistoricalRankings(sourceOption.variant, date);
    case 'ktc_rookie':
      return loadKtcRookieValuesRankings(sourceOption.rookieKey, year);
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
  return [];
}

export function sourceUsesYear(sourceOption) {
  return sourceOption?.kind === 'adp' || sourceOption?.kind === 'ktc_rookie';
}

export function sourceUsesDate(sourceOption) {
  return sourceOption?.kind === 'ktc_historical';
}
