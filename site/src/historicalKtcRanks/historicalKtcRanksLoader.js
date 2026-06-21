/**
 * Loaders for Historical KTC Ranks sandbox module.
 * Uses the same snapshot dates as Final KTC Values and Rookie Draft KTC Values.
 */

import {
  DDL_STARTUP_ADP_YEARS,
  FINAL_KTC_YEARS,
  KTC_ROOKIE_CLASS_YEARS,
  KTC_ROOKIE_VALUES,
} from '../rankingsViewer/rankingsSources';
import { normalisePlayerName } from '../utils/playerNameMatcher';

const RANKS_CSV = '/data/sf_ktc_pos_ranks_historical.csv';
const PLAYERS_CSV = '/data/sf_ktc_rank_history_players.csv';
const VALUES_CSV = '/data/sf_ktc_values_historical.csv';
const FILLED_CSV = '/data/sf_ktc_values_historical_filled.csv';
const FILLED_METADATA_CSV = '/data/sf_ktc_values_historical_filled_metadata.csv';
const FINAL_KTC_CSV = '/data/final_ktc_values.csv';
const STARTUP_ADP_CSV = '/data/ddl_startup_adp_historical.csv';

const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const MAX_FALLBACK_DAYS = 30;

export const SNAPSHOT_TYPES = {
  final_ktc: {
    id: 'final_ktc',
    label: 'Final KTC (preseason)',
    years: FINAL_KTC_YEARS.filter((y) => y >= 2021),
  },
  rookie_draft: {
    id: 'rookie_draft',
    label: 'Rookie Draft KTC (May 20)',
    years: KTC_ROOKIE_CLASS_YEARS.filter((y) => y >= 2021),
  },
  monthly: {
    id: 'monthly',
    label: 'Monthly (10th)',
    years: [2021, 2022, 2023, 2024, 2025],
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  },
};

export const FILL_SOURCE_LABELS = {
  historical: 'Historical',
  adp: 'ADP fill',
  unknown: 'Unknown',
};

export const DATA_MODES = {
  raw: { id: 'raw', label: 'Raw (rank scrape + values)' },
  filled: { id: 'filled', label: 'Filled board (imputed)' },
};

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
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };
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
  return { headers, rows };
}

function parseIntField(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloatField(raw) {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function playerKey(name, position, sleeperId) {
  const sid = (sleeperId || '').trim();
  if (sid) return `sid:${sid}`;
  return `${normalisePlayerName(name)}|${(position || '').toUpperCase()}`;
}

function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Search target date, then +/- 1, 2, … days until predicate returns truthy.
 */
export function resolveDateWithFallback(targetDate, hasDataFn, maxDays = MAX_FALLBACK_DAYS) {
  if (!targetDate) return null;
  if (hasDataFn(targetDate)) {
    return { date: targetDate, dayOffset: 0 };
  }
  for (let offset = 1; offset <= maxDays; offset += 1) {
    for (const sign of [-1, 1]) {
      const candidate = addDays(targetDate, sign * offset);
      if (hasDataFn(candidate)) {
        return { date: candidate, dayOffset: sign * offset };
      }
    }
  }
  return null;
}

function rookieSnapshotDate(classYear) {
  const cfg = KTC_ROOKIE_VALUES.sf;
  const month = String(cfg.snapshotMonth || 5).padStart(2, '0');
  const day = String(cfg.snapshotDay || 20).padStart(2, '0');
  return `${classYear}-${month}-${day}`;
}

async function loadFinalKtcDatesByYear() {
  const res = await fetch(FINAL_KTC_CSV);
  if (!res.ok) throw new Error(`Failed to fetch ${FINAL_KTC_CSV}`);
  const { rows } = parseCsv(await res.text());
  const byYear = new Map();
  for (const row of rows) {
    const year = parseIntField(row.year);
    const date = (row.date || '').trim();
    if (year != null && date && !byYear.has(year)) {
      byYear.set(year, date);
    }
  }
  return byYear;
}

/** Startup ADP is keyed by season year (Jan–Aug window), aligned to snapshot year. */
export function getStartupAdpSeason(year) {
  const season = Number(year);
  return DDL_STARTUP_ADP_YEARS.includes(season) ? season : null;
}

export function getSnapshotTargetDate(snapshotType, year, finalKtcDatesByYear, month = null) {
  const yearNum = Number(year);
  if (snapshotType === 'final_ktc') {
    return finalKtcDatesByYear.get(yearNum) || null;
  }
  if (snapshotType === 'rookie_draft') {
    return rookieSnapshotDate(yearNum);
  }
  if (snapshotType === 'monthly') {
    const monthNum = Number(month);
    if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) return null;
    const day = 10;
    return `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

const FILLED_KIND_PRIORITY = { final_ktc: 3, rookie_draft: 2, monthly: 1 };

function buildValuesByDateFromFilled(filledRows) {
  const bestByDateName = new Map();
  for (const row of filledRows) {
    const date = (row.resolved_date || '').trim();
    const name = (row.name || '').trim();
    const kind = (row.snapshot_kind || '').trim();
    const value = parseIntField(row.ktc_value);
    if (!date || !name || value == null || value <= 0) continue;
    const key = `${date}|${name}`;
    const prev = bestByDateName.get(key);
    if (prev && (FILLED_KIND_PRIORITY[kind] || 0) <= (FILLED_KIND_PRIORITY[prev.kind] || 0)) continue;
    bestByDateName.set(key, { date, name, value, kind });
  }

  const valuesByDate = new Map();
  for (const { date, name, value } of bestByDateName.values()) {
    if (!valuesByDate.has(date)) valuesByDate.set(date, new Map());
    valuesByDate.get(date).set(name, value);
  }
  return valuesByDate;
}

function filledSnapshotKey(target, kind) {
  return `${kind}|${target}`;
}

function parseFilledSnapshotRow(row) {
  return {
    target: (row.snapshot_target || '').trim(),
    kind: (row.snapshot_kind || '').trim(),
    label: (row.snapshot_label || '').trim(),
    resolvedDate: (row.resolved_date || '').trim(),
    year: parseIntField(row.year),
  };
}

function parseFilledBoardRow(row) {
  const position = (row.position || '').trim().toUpperCase();
  const slot = parseIntField(row.positional_rank);
  return {
    kind: 'player',
    slot,
    slotLabel: slot != null ? `${position}${slot}` : '',
    name: (row.name || '').trim(),
    position,
    positionalRank: slot,
    overallRank: parseIntField(row.overall_rank),
    ktcValue: parseIntField(row.ktc_value),
    ktcPlayerId: (row.ktc_player_id || '').trim(),
    sleeperId: (row.sleeper_id || '').trim(),
    snapshotTarget: (row.snapshot_target || '').trim(),
    snapshotKind: (row.snapshot_kind || '').trim(),
    snapshotLabel: (row.snapshot_label || '').trim(),
    resolvedDate: (row.resolved_date || '').trim(),
    inKtcRanks: true,
  };
}

function parseMetadataRow(row) {
  return {
    snapshotTarget: (row.snapshot_target || '').trim(),
    snapshotKind: (row.snapshot_kind || '').trim(),
    position: (row.position || '').trim().toUpperCase(),
    slot: parseIntField(row.positional_rank),
    fillSource: (row.fill_source || '').trim(),
    assignedName: (row.assigned_name || '').trim(),
    adpOverall: (row.adp_overall || '').trim(),
    adpPosRank: (row.adp_pos_rank || '').trim(),
    anchorUpperSlot: (row.anchor_upper_slot || '').trim(),
    anchorUpperName: (row.anchor_upper_name || '').trim(),
    anchorUpperValue: (row.anchor_upper_value || '').trim(),
    anchorUpperAdp: (row.anchor_upper_adp || '').trim(),
    anchorLowerSlot: (row.anchor_lower_slot || '').trim(),
    anchorLowerName: (row.anchor_lower_name || '').trim(),
    anchorLowerValue: (row.anchor_lower_value || '').trim(),
    anchorLowerAdp: (row.anchor_lower_adp || '').trim(),
    interpolateFraction: (row.interpolate_fraction || '').trim(),
    baselineValue: (row.baseline_value || '').trim(),
    rawComputedValue: (row.raw_computed_value || '').trim(),
    clamped: row.clamped === '1',
    clampReason: (row.clamp_reason || '').trim(),
    valueResolvedDate: (row.value_resolved_date || '').trim(),
    rankResolvedDate: (row.rank_resolved_date || '').trim(),
  };
}

export function formatFillMetadata(meta) {
  if (!meta) return '';
  if (meta.fillSource === 'historical') {
    const parts = ['Community-sheet KTC value'];
    if (meta.valueResolvedDate) parts.push(`value date ${meta.valueResolvedDate}`);
    return parts.join(' · ');
  }
  if (meta.fillSource === 'adp') {
    const parts = [];
    if (meta.clampReason === 'interpolated') {
      parts.push('ADP-interpolated between known KTC neighbors');
      if (meta.anchorUpperSlot && meta.anchorLowerSlot) {
        parts.push(
          `${meta.position}${meta.anchorUpperSlot} (${meta.anchorUpperValue}) ↔ `
          + `${meta.position}${meta.anchorLowerSlot} (${meta.anchorLowerValue})`,
        );
      }
      if (meta.interpolateFraction) {
        parts.push(`${(parseFloat(meta.interpolateFraction) * 100).toFixed(0)}% toward upper anchor`);
      }
    } else if (meta.clampReason?.startsWith('cap_')) {
      parts.push(`Capped at ${meta.anchorUpperName || 'upper anchor'} value`);
    } else if (meta.clampReason?.startsWith('floor_')) {
      parts.push(`Floored at ${meta.anchorLowerName || 'lower anchor'} value`);
    } else {
      parts.push('Assigned from startup ADP pool');
    }
    if (meta.adpOverall) parts.push(`ADP OVR ${meta.adpOverall}`);
    if (meta.clamped && meta.clampReason && !['interpolated', 'cap_above_upper_adp', 'floor_below_lower_adp'].includes(meta.clampReason.split(';')[0])) {
      parts.push(`clamped: ${meta.clampReason}`);
    }
    return parts.join(' · ');
  }
  if (meta.fillSource === 'unknown') {
    const parts = ['No ADP left — 2026 slot baseline'];
    if (meta.baselineValue) parts.push(`baseline ${meta.baselineValue}`);
    if (meta.clamped) parts.push(`clamped: ${meta.clampReason || 'monotone order'}`);
    return parts.join(' · ');
  }
  return meta.fillSource || '';
}

export function summarizeFilledCoverage(rows) {
  const counts = { historical: 0, adp: 0, unknown: 0, other: 0 };
  for (const row of rows) {
    const src = row.fillSource || 'other';
    if (counts[src] != null) counts[src] += 1;
    else counts.other += 1;
  }
  return {
    total: rows.length,
    ...counts,
  };
}

export function buildFilledSlotBoard(filledRows, metadataBySlot, position, adpIndex) {
  const pos = position === 'ALL' ? null : position;
  const filtered = pos
    ? filledRows.filter((r) => r.position === pos)
    : filledRows.filter((r) => POSITIONS.includes(r.position));

  const buildOne = (rows, posLabel) => {
    const bySlot = new Map();
    for (const row of rows) {
      if (row.slot != null) bySlot.set(row.slot, row);
    }
    const maxSlot = rows.reduce((max, row) => Math.max(max, row.slot || 0), 0);
    const board = [];
    for (let slot = 1; slot <= maxSlot; slot += 1) {
      const player = bySlot.get(slot);
      if (player) {
        const meta = metadataBySlot.get(`${posLabel}${slot}`);
        const adp = lookupStartupAdp(adpIndex, player);
        board.push({
          ...player,
          fillSource: meta?.fillSource || 'historical',
          fillMeta: meta || null,
          startupAdp: adp?.adp ?? null,
          startupAdpPosRank: adp?.posRank ?? null,
          startupAdpSlotLabel: adp?.adpSlotLabel ?? null,
          inStartupAdp: Boolean(adp),
        });
      } else {
        board.push({
          kind: 'gap',
          slot,
          slotLabel: `${posLabel}${slot}`,
          position: posLabel,
          name: null,
        });
      }
    }
    return board;
  };

  if (pos) {
    return buildOne(filtered, pos);
  }

  return {
    mode: 'all',
    boards: POSITIONS.map((p) => ({
      position: p,
      rows: buildOne(filtered.filter((r) => r.position === p), p),
    })),
  };
}

export function getFilledRowsForSnapshot(filledBySnapshot, snapshotTarget, snapshotKind) {
  const key = filledSnapshotKey(snapshotTarget, snapshotKind);
  return filledBySnapshot.get(key) || [];
}

export function getFilledMetadataForSnapshot(filledMetadataBySnapshot, snapshotTarget, snapshotKind) {
  const key = filledSnapshotKey(snapshotTarget, snapshotKind);
  return filledMetadataBySnapshot.get(key) || new Map();
}

export async function loadHistoricalKtcRanksData() {
  if (cache) return cache;

  const [
    ranksRes,
    playersRes,
    valuesRes,
    startupAdpRes,
    finalKtcDatesByYear,
    filledRes,
    filledMetaRes,
  ] = await Promise.all([
    fetch(RANKS_CSV),
    fetch(PLAYERS_CSV),
    fetch(VALUES_CSV),
    fetch(STARTUP_ADP_CSV),
    loadFinalKtcDatesByYear(),
    fetch(FILLED_CSV),
    fetch(FILLED_METADATA_CSV),
  ]);

  if (!ranksRes.ok) {
    throw new Error(
      `Missing ${RANKS_CSV}. Run: bash scripts/fetch_sf_ktc_rank_history.sh`
    );
  }
  if (!playersRes.ok) {
    throw new Error(
      `Missing ${PLAYERS_CSV}. Run: bash scripts/fetch_sf_ktc_rank_history.sh`
    );
  }
  if (!valuesRes.ok && !filledRes.ok) {
    throw new Error(`Failed to fetch historical KTC values (${VALUES_CSV})`);
  }
  if (!startupAdpRes.ok) {
    throw new Error(`Failed to fetch ${STARTUP_ADP_CSV}`);
  }

  const filledAvailable = filledRes.ok && filledMetaRes.ok;
  if (!filledAvailable) {
    console.warn(
      'Filled historical KTC CSVs not found. Run: python3 scripts/build_sf_ktc_values_historical_filled.py',
    );
  }

  const { rows: rankRows } = parseCsv(await ranksRes.text());
  const { rows: playerRows } = parseCsv(await playersRes.text());
  const { rows: valueRows } = valuesRes.ok ? parseCsv(await valuesRes.text()) : [];
  const filledCsvText = filledRes.ok ? await filledRes.text() : '';
  const filledMetaText = filledMetaRes.ok ? await filledMetaRes.text() : '';
  const { rows: startupAdpRows } = parseCsv(await startupAdpRes.text());

  const startupAdpBySeason = new Map();
  for (const row of startupAdpRows) {
    const season = parseIntField(row.season);
    const name = (row.name || '').trim();
    const position = (row.position || '').trim().toUpperCase();
    const adp = parseFloatField(row.adp);
    const posRank = parseIntField(row.pos_rank);
    if (season == null || !name || !position || adp == null || posRank == null) continue;
    if (!POSITIONS.includes(position)) continue;

    const entry = {
      name,
      position,
      adp,
      overallRank: parseIntField(row.overall_rank),
      posRank,
      adpSlotLabel: `${position}${posRank}`,
      sleeperId: (row.sleeper_id || '').trim(),
      team: (row.team || '').trim(),
      windowStart: (row.window_start || '').trim(),
      windowEnd: (row.window_end || '').trim(),
    };

    if (!startupAdpBySeason.has(season)) startupAdpBySeason.set(season, []);
    startupAdpBySeason.get(season).push(entry);
  }

  const ranksByDate = new Map();
  for (const row of rankRows) {
    const date = (row.date || '').trim();
    const name = (row.name || '').trim();
    const position = (row.position || '').trim().toUpperCase();
    const positionalRank = parseIntField(row.positional_rank);
    const overallRank = parseIntField(row.overall_rank);
    if (!date || !name || !position || positionalRank == null) continue;

    const entry = {
      date,
      name,
      position,
      positionalRank,
      overallRank,
      ktcPlayerId: (row.ktc_player_id || '').trim(),
      ktcSlug: (row.ktc_slug || '').trim(),
      sleeperId: (row.sleeper_id || '').trim(),
      rankBasis: (row.rank_basis || '').trim(),
    };

    if (!ranksByDate.has(date)) ranksByDate.set(date, []);
    ranksByDate.get(date).push(entry);
  }

  const valuesByDate = filledAvailable
    ? buildValuesByDateFromFilled(parseCsv(filledCsvText).rows)
    : (() => {
      const map = new Map();
      for (const row of valueRows) {
        const date = (row.date || '').trim();
        const name = (row.name || '').trim();
        const value = parseIntField(row.ktc_value);
        if (!date || !name || value == null || value <= 0) continue;
        if (!map.has(date)) map.set(date, new Map());
        map.get(date).set(name, value);
      }
      return map;
    })();

  const players = playerRows.map((row) => ({
    name: (row.name || '').trim(),
    position: (row.position || '').trim().toUpperCase(),
    ktcPlayerId: (row.ktc_player_id || '').trim(),
    ktcSlug: (row.ktc_slug || '').trim(),
    sleeperId: (row.sleeper_id || '').trim(),
    team: (row.team || '').trim(),
    rankBasis: (row.rank_basis || '').trim(),
    historyDays: parseIntField(row.history_days),
    historyStart: (row.history_start || '').trim(),
    historyEnd: (row.history_end || '').trim(),
  }));

  const filledBySnapshot = new Map();
  const filledMetadataBySnapshot = new Map();
  const filledSnapshots = [];
  const filledSnapshotSet = new Set();

  if (filledAvailable) {
    const { rows: filledRows } = parseCsv(filledCsvText);
    const { rows: metaRows } = parseCsv(filledMetaText);

    for (const row of filledRows) {
      const boardRow = parseFilledBoardRow(row);
      const key = filledSnapshotKey(boardRow.snapshotTarget, boardRow.snapshotKind);
      if (!filledBySnapshot.has(key)) filledBySnapshot.set(key, []);
      filledBySnapshot.get(key).push(boardRow);

      if (!filledSnapshotSet.has(key)) {
        filledSnapshotSet.add(key);
        filledSnapshots.push(parseFilledSnapshotRow(row));
      }
    }

    for (const row of metaRows) {
      const meta = parseMetadataRow(row);
      const key = filledSnapshotKey(meta.snapshotTarget, meta.snapshotKind);
      if (!filledMetadataBySnapshot.has(key)) {
        filledMetadataBySnapshot.set(key, new Map());
      }
      filledMetadataBySnapshot.get(key).set(`${meta.position}${meta.slot}`, meta);
    }

    filledSnapshots.sort((a, b) => a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind));
  }

  cache = {
    ranksByDate,
    valuesByDate,
    startupAdpBySeason,
    finalKtcDatesByYear,
    players,
    playerCount: players.length,
    recordCount: rankRows.length,
    filledAvailable,
    filledBySnapshot,
    filledMetadataBySnapshot,
    filledSnapshots,
  };
  return cache;
}

export function getStartupAdpRows(data, season) {
  if (season == null) return [];
  return data.startupAdpBySeason.get(Number(season)) || [];
}

export function buildStartupAdpIndex(adpRows) {
  const byKey = new Map();
  for (const row of adpRows) {
    byKey.set(playerKey(row.name, row.position, row.sleeperId), row);
    const nameKey = playerKey(row.name, row.position);
    if (!byKey.has(nameKey)) byKey.set(nameKey, row);
  }
  return byKey;
}

export function buildRankIndex(rankRows) {
  const byKey = new Map();
  for (const row of rankRows) {
    const key = playerKey(row.name, row.position, row.sleeperId);
    if (!byKey.has(key)) byKey.set(key, row);
    const nameKey = playerKey(row.name, row.position);
    if (!byKey.has(nameKey)) byKey.set(nameKey, row);
  }
  return byKey;
}

export function lookupStartupAdp(adpIndex, { name, position, sleeperId }) {
  if (!adpIndex) return null;
  const sidKey = (sleeperId || '').trim();
  if (sidKey) {
    const hit = adpIndex.get(`sid:${sidKey}`);
    if (hit) return hit;
  }
  return adpIndex.get(playerKey(name, position)) || null;
}

export function lookupRankRow(rankIndex, { name, position, sleeperId }) {
  if (!rankIndex) return null;
  const sidKey = (sleeperId || '').trim();
  if (sidKey) {
    const hit = rankIndex.get(`sid:${sidKey}`);
    if (hit) return hit;
  }
  return rankIndex.get(playerKey(name, position)) || null;
}

function attachStartupAdp(row, adpIndex) {
  if (row.kind === 'gap') return row;
  const adp = lookupStartupAdp(adpIndex, row);
  if (!adp) {
    return { ...row, startupAdp: null, startupAdpPosRank: null, startupAdpSlotLabel: null };
  }
  return {
    ...row,
    startupAdp: adp.adp,
    startupAdpPosRank: adp.posRank,
    startupAdpSlotLabel: adp.adpSlotLabel,
    inStartupAdp: true,
  };
}

function attachKtcRank(row, rankIndex, valuesByDate, targetDate) {
  if (row.kind === 'gap') return row;
  const rank = lookupRankRow(rankIndex, row);
  if (!rank) {
    return {
      ...row,
      inKtcRanks: false,
      ktcHistoricalSlot: null,
      ktcHistoricalSlotLabel: null,
      overallRank: null,
      ktcValue: null,
    };
  }
  const { value, valueDate, valueDayOffset } = lookupValueWithFallback(
    valuesByDate,
    rank.name,
    targetDate,
  );
  return {
    ...row,
    inKtcRanks: true,
    name: rank.name,
    position: rank.position,
    ktcHistoricalSlot: rank.positionalRank,
    ktcHistoricalSlotLabel: `${rank.position}${rank.positionalRank}`,
    overallRank: rank.overallRank,
    ktcValue: value,
    valueDate,
    valueDayOffset,
    sleeperId: rank.sleeperId || row.sleeperId,
  };
}

export function resolveRankRowsForSnapshot(data, targetDate) {
  const resolved = resolveDateWithFallback(
    targetDate,
    (d) => (data.ranksByDate.get(d) || []).length > 0,
  );
  if (!resolved) {
    return { targetDate, resolvedDate: null, dayOffset: null, rows: [] };
  }
  return {
    targetDate,
    resolvedDate: resolved.date,
    dayOffset: resolved.dayOffset,
    rows: data.ranksByDate.get(resolved.date) || [],
  };
}

export function lookupValueWithFallback(valuesByDate, name, targetDate) {
  const hasValue = (d) => {
    const day = valuesByDate.get(d);
    return day != null && day.has(name);
  };

  const resolved = resolveDateWithFallback(targetDate, hasValue);
  if (!resolved) {
    return { value: null, valueDate: null, valueDayOffset: null };
  }
  return {
    value: valuesByDate.get(resolved.date).get(name),
    valueDate: resolved.date,
    valueDayOffset: resolved.dayOffset,
  };
}

/**
 * Build a positional rank board ordered by KTC historical slot (with gap rows).
 */
export function buildKtcSlotBoard(
  rowsForDate,
  position,
  valuesByDate,
  targetDate,
  adpIndex,
) {
  const pos = position === 'ALL' ? null : position;
  const filtered = pos
    ? rowsForDate.filter((r) => r.position === pos)
    : [...rowsForDate];

  const enrich = (rows) => rows.map((row) => {
    const withAdp = attachStartupAdp(row, adpIndex);
    if (withAdp.kind === 'gap') return withAdp;
    return {
      ...withAdp,
      ktcHistoricalSlot: withAdp.positionalRank,
      ktcHistoricalSlotLabel: withAdp.slotLabel,
      inKtcRanks: true,
    };
  });

  const attachValues = (rows) => enrich(rows).map((row) => {
    if (row.kind === 'gap') return row;
    const { value, valueDate, valueDayOffset } = lookupValueWithFallback(
      valuesByDate,
      row.name,
      targetDate,
    );
    return { ...row, ktcValue: value, valueDate, valueDayOffset };
  });

  if (pos) {
    return attachValues(buildSinglePositionBoard(filtered, pos));
  }

  return {
    mode: 'all',
    boards: POSITIONS.map((p) => ({
      position: p,
      rows: attachValues(buildSinglePositionBoard(filtered.filter((r) => r.position === p), p)),
    })),
  };
}

/** @deprecated alias */
export function buildRankBoard(rowsForDate, position, valuesByDate, targetDate, adpIndex) {
  return buildKtcSlotBoard(rowsForDate, position, valuesByDate, targetDate, adpIndex);
}

/**
 * Build a board ordered by Startup ADP positional slot (includes ADP-only players).
 */
export function buildAdpSlotBoard(
  adpRows,
  position,
  rankIndex,
  valuesByDate,
  targetDate,
  adpIndex,
) {
  const pos = position === 'ALL' ? null : position;
  const filtered = pos
    ? adpRows.filter((r) => r.position === pos)
    : adpRows.filter((r) => POSITIONS.includes(r.position));

  const buildOne = (rows, posLabel) => {
    const bySlot = new Map();
    for (const row of rows) {
      if (!bySlot.has(row.posRank)) bySlot.set(row.posRank, row);
    }
    const maxRank = rows.reduce((max, row) => Math.max(max, row.posRank), 0);
    const board = [];

    for (let slot = 1; slot <= maxRank; slot += 1) {
      const adpPlayer = bySlot.get(slot);
      if (adpPlayer) {
        const base = {
          kind: 'player',
          slot,
          slotLabel: `${posLabel}${slot}`,
          name: adpPlayer.name,
          position: adpPlayer.position,
          sleeperId: adpPlayer.sleeperId,
          startupAdp: adpPlayer.adp,
          startupAdpPosRank: adpPlayer.posRank,
          startupAdpSlotLabel: adpPlayer.adpSlotLabel,
          inStartupAdp: true,
        };
        board.push(attachKtcRank(base, rankIndex, valuesByDate, targetDate));
      } else {
        board.push({
          kind: 'gap',
          slot,
          slotLabel: `${posLabel}${slot}`,
          position: posLabel,
          name: null,
          startupAdpPosRank: slot,
          inStartupAdp: false,
          inKtcRanks: false,
        });
      }
    }
    return board.map((row) => attachStartupAdp(row, adpIndex));
  };

  if (pos) {
    return buildOne(filtered, pos);
  }

  return {
    mode: 'all',
    boards: POSITIONS.map((p) => ({
      position: p,
      rows: buildOne(filtered.filter((r) => r.position === p), p),
    })),
  };
}

/**
 * Align KTC-slot and ADP-slot boards side-by-side by slot number.
 */
export function buildSideBySideRows(ktcBoard, adpBoard, position) {
  const maxSlot = Math.max(
    ktcBoard.reduce((m, r) => Math.max(m, r.slot || 0), 0),
    adpBoard.reduce((m, r) => Math.max(m, r.slot || 0), 0),
  );

  const ktcBySlot = new Map(ktcBoard.map((r) => [r.slot, r]));
  const adpBySlot = new Map(adpBoard.map((r) => [r.slot, r]));
  const rows = [];

  for (let slot = 1; slot <= maxSlot; slot += 1) {
    const ktc = ktcBySlot.get(slot) || {
      kind: 'gap',
      slot,
      slotLabel: `${position}${slot}`,
      position,
      name: null,
      inKtcRanks: false,
    };
    const adp = adpBySlot.get(slot) || {
      kind: 'gap',
      slot,
      slotLabel: `${position}${slot}`,
      position,
      name: null,
      inStartupAdp: false,
    };

    const ktcGap = ktc.kind === 'gap';
    const adpGap = adp.kind === 'gap';
    const adpOnly = !adpGap && adp.inKtcRanks === false;
    const ktcFillsFromAdp = ktcGap && !adpGap;

    rows.push({
      slot,
      ktc,
      adp,
      compareKind: ktcFillsFromAdp ? 'adp_candidate' : adpOnly ? 'adp_only' : 'both',
    });
  }

  return rows;
}

export function summarizeCompareCoverage(ktcBoard, adpBoard) {
  const ktcPlayers = ktcBoard.filter((r) => r.kind === 'player');
  const adpPlayers = adpBoard.filter((r) => r.kind === 'player');
  const ktcGaps = countGaps(ktcBoard);
  const adpOnly = adpPlayers.filter((r) => r.inKtcRanks === false).length;
  const withAdp = ktcPlayers.filter((r) => r.startupAdp != null).length;
  const withValue = ktcPlayers.filter((r) => r.ktcValue != null).length;
  const gapFilledByAdp = buildSideBySideRows(ktcBoard, adpBoard, ktcBoard[0]?.position || 'TE')
    .filter((r) => r.compareKind === 'adp_candidate').length;

  return {
    rankCount: ktcPlayers.length,
    adpCount: adpPlayers.length,
    withValue,
    withAdp,
    ktcGaps,
    adpOnly,
    gapFilledByAdp,
    missingValue: ktcPlayers.length - withValue,
  };
}

function buildSinglePositionBoard(rows, position) {
  const bySlot = new Map();
  for (const row of rows) {
    if (!bySlot.has(row.positionalRank)) {
      bySlot.set(row.positionalRank, row);
    }
  }

  const maxRank = rows.reduce((max, row) => Math.max(max, row.positionalRank), 0);
  const board = [];

  for (let slot = 1; slot <= maxRank; slot += 1) {
    const player = bySlot.get(slot);
    if (player) {
      board.push({
        kind: 'player',
        slot,
        slotLabel: `${position}${slot}`,
        ...player,
      });
    } else {
      board.push({
        kind: 'gap',
        slot,
        slotLabel: `${position}${slot}`,
        position,
        name: null,
        positionalRank: slot,
        overallRank: null,
      });
    }
  }

  return board;
}

export function summarizeSnapshotCoverage(rowsForDate, valuesByDate, targetDate, adpIndex) {
  let withValue = 0;
  let missingValue = 0;
  let withAdp = 0;

  for (const row of rowsForDate) {
    const { value } = lookupValueWithFallback(valuesByDate, row.name, targetDate);
    if (value != null) withValue += 1;
    else missingValue += 1;
    if (lookupStartupAdp(adpIndex, row)) withAdp += 1;
  }

  return {
    rankCount: rowsForDate.length,
    withValue,
    missingValue,
    withAdp,
  };
}

export function countGaps(boardRows) {
  return boardRows.filter((r) => r.kind === 'gap').length;
}

export function formatDayOffset(offset) {
  if (offset == null || offset === 0) return null;
  const n = Math.abs(offset);
  return `${offset > 0 ? '+' : '−'}${n}d`;
}

export { POSITIONS, MAX_FALLBACK_DAYS };
