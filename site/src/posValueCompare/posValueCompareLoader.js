/**
 * Data loading for Pos Value Compare sandbox feature.
 * Reads precomputed baselines built by compute_pos_value_compare.js.
 */

import { POSITIONS, DEFAULT_VALUE_TOLERANCE } from './computePosValueCompare';
import {
  DEFAULT_DATASET_ID,
  getPosValueCompareDataset,
  POS_VALUE_COMPARE_DATASETS,
} from './posValueCompareDatasets';
import {
  groupHvorpPctDelta,
  hvorpPctDelta,
  TOP_KTC_RANK,
} from './posValueCompareMetrics';

export { TOP_KTC_RANK, POS_VALUE_COMPARE_DATASETS, DEFAULT_DATASET_ID };

export const ANALYSIS_YEARS = [2021, 2022, 2023, 2024, 2025];

const cacheByDataset = new Map();

function parseCsvRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
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
  fields.push(current.replace(/\r$/, ''));
  return fields;
}

function parseComparisonRow(cols, idx) {
  const season = parseInt(cols[idx('season')], 10);
  const hvorpA = parseFloat(cols[idx('hvorp_a')]);
  const hvorpB = parseFloat(cols[idx('hvorp_b')]);
  const delta = parseFloat(cols[idx('delta')]);
  if (!Number.isFinite(season) || !Number.isFinite(delta)) return null;

  const posA = (cols[idx('pos_a')] || '').trim();
  const posB = (cols[idx('pos_b')] || '').trim();
  const valueA = parseInt(cols[idx('value_a')] ?? cols[idx('ktc_value_a')], 10);
  const valueB = parseInt(cols[idx('value_b')] ?? cols[idx('ktc_value_b')], 10);

  return {
    season,
    posA,
    posB,
    pairKey: (cols[idx('pair_key')] || '').trim() || `${posA}_vs_${posB}`,
    playerA: (cols[idx('player_a')] || '').trim(),
    playerB: (cols[idx('player_b')] || '').trim(),
    playerIdA: (cols[idx('player_id_a')] || '').trim(),
    playerIdB: (cols[idx('player_id_b')] || '').trim(),
    valueA,
    valueB,
    valueGap: parseFloat(cols[idx('value_gap')]),
    hvorpA,
    hvorpB,
    delta,
    pctDelta: hvorpPctDelta(hvorpA, hvorpB, delta),
  };
}

function aggregateComparisons(comparisons) {
  const byPair = {};
  for (let i = 0; i < POSITIONS.length; i += 1) {
    for (let j = i + 1; j < POSITIONS.length; j += 1) {
      const posA = POSITIONS[i];
      const posB = POSITIONS[j];
      byPair[`${posA}_vs_${posB}`] = {
        posA,
        posB,
        label: `${posA} vs ${posB}`,
        comparisons: [],
        avgDelta: null,
        avgPctDelta: null,
        count: 0,
      };
    }
  }

  for (const row of comparisons) {
    const bucket = byPair[row.pairKey];
    if (!bucket) continue;
    bucket.comparisons.push(row);
  }

  for (const bucket of Object.values(byPair)) {
    bucket.count = bucket.comparisons.length;
    if (bucket.count > 0) {
      const sum = bucket.comparisons.reduce((s, c) => s + c.delta, 0);
      bucket.avgDelta = Math.round((sum / bucket.count) * 10) / 10;
      bucket.avgPctDelta = groupHvorpPctDelta(bucket.comparisons);
    }
  }

  const avgDeltaOverall = comparisons.length
    ? Math.round(
      (comparisons.reduce((s, c) => s + c.delta, 0) / comparisons.length) * 10,
    ) / 10
    : null;
  const avgPctDeltaOverall = groupHvorpPctDelta(comparisons);

  return {
    byPair,
    comparisons,
    avgDeltaOverall,
    avgPctDeltaOverall,
    totalComparisons: comparisons.length,
  };
}

function buildSeasonResults(comparisons, meta) {
  const seasonMetaByYear = {};
  for (const row of meta?.seasons || []) {
    seasonMetaByYear[row.season] = row;
  }

  const bySeason = new Map();
  for (const row of comparisons) {
    if (!bySeason.has(row.season)) bySeason.set(row.season, []);
    bySeason.get(row.season).push(row);
  }

  return ANALYSIS_YEARS.filter((y) => bySeason.has(y)).map((season) => {
    const seasonComparisons = bySeason.get(season);
    const agg = aggregateComparisons(seasonComparisons);
    const seasonMeta = seasonMetaByYear[season] || {};
    return {
      season,
      baseRosterSize: meta?.base_roster_size ?? 0,
      playersEvaluated: seasonMeta.playersEvaluated ?? 0,
      valueTolerance: meta?.value_tolerance ?? DEFAULT_VALUE_TOLERANCE,
      comparisons: seasonComparisons,
      byPair: agg.byPair,
      avgDeltaOverall: agg.avgDeltaOverall,
      avgPctDeltaOverall: agg.avgPctDeltaOverall,
      totalComparisons: agg.totalComparisons,
    };
  });
}

async function parseComparisonsCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);
  const comparisons = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvRow(lines[i]);
    const row = parseComparisonRow(cols, idx);
    if (row) comparisons.push(row);
  }

  return comparisons;
}

/**
 * Load precomputed multi-season comparison dataset.
 * @param {string} [datasetId] — 'final_ktc' | 'comp_adj'
 */
export async function loadPosValueCompareData(datasetId = DEFAULT_DATASET_ID) {
  if (cacheByDataset.has(datasetId)) return cacheByDataset.get(datasetId);

  const config = getPosValueCompareDataset(datasetId);
  const comparisonsCsv = `/data/${config.basename}.csv`;
  const metaJson = `/data/${config.basename}_meta.json`;

  const [csvRes, metaRes] = await Promise.all([
    fetch(comparisonsCsv),
    fetch(metaJson),
  ]);

  if (!csvRes.ok) {
    throw new Error(
      `${config.basename}.csv not found — run: node site/src/data_parse/compute_pos_value_compare.js`,
    );
  }

  const comparisons = await parseComparisonsCsv(await csvRes.text());
  const meta = metaRes.ok ? await metaRes.json() : null;

  const seasonResults = buildSeasonResults(comparisons, meta);
  const aggregate = aggregateComparisons(comparisons);

  const results = {
    datasetId,
    dataset: config,
    years: meta?.years || ANALYSIS_YEARS,
    seasonResults,
    aggregate,
    valueTolerance: meta?.value_tolerance ?? DEFAULT_VALUE_TOLERANCE,
    topKtcRank: meta?.top_ktc_rank ?? TOP_KTC_RANK,
    baseRoster: [],
    meta,
    generatedAt: meta?.generated_at ?? null,
  };

  cacheByDataset.set(datasetId, results);
  return results;
}

export { DEFAULT_VALUE_TOLERANCE };
