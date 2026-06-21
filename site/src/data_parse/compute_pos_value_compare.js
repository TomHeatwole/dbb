#!/usr/bin/env node
/**
 * compute_pos_value_compare.js
 *
 * Precomputes cross-position value vs HVORP comparisons (2021–2025) for:
 *   - Final KTC (preseason SF TE+)
 *   - Competitor Adjusted Value (final_ktc_redraft_value_index.csv)
 *
 * Writes per dataset:
 *   site/public/data/final_ktc_top300_empty_roster_pos_value_compare.csv
 *   site/public/data/final_ktc_comp_adj_top300_empty_roster_pos_value_compare.csv
 *   (+ matching _meta.json files)
 *
 * Usage (from project root):
 *   node site/src/data_parse/compute_pos_value_compare.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateFantasyPoints } from './fantasyCalculator.js';
import { fetchWeeklyStats } from './weeklyStatsLoader.js';
import {
  computeQbGroundedMultipliers,
  filterTopKtcPlayers,
  groupHvorpPctDelta,
  hvorpPctDelta,
  TOP_KTC_RANK,
} from '../posValueCompare/posValueCompareMetrics.js';
import { POS_VALUE_COMPARE_DATASETS } from '../posValueCompare/posValueCompareDatasets.js';
import { HVORP_VALUE_ADJUSTMENTS } from '../lookups/HvorpValueAdjustmentLookup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DATA_DIR = path.join(PROJECT_ROOT, 'site/public/data');
const FINAL_KTC_CSV = path.join(DATA_DIR, 'final_ktc_values.csv');
const COMP_ADJ_CSV = path.join(DATA_DIR, 'final_ktc_redraft_value_index.csv');

const ANALYSIS_YEARS = [2021, 2022, 2023, 2024, 2025];
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const DEFAULT_VALUE_TOLERANCE = 200;

const DATASET_BUILDERS = {
  final_ktc: {
    config: POS_VALUE_COMPARE_DATASETS.final_ktc,
    loadByYear: loadFinalKtcByYear,
  },
  comp_adj: {
    config: POS_VALUE_COMPARE_DATASETS.comp_adj,
    loadByYear: loadCompAdjByYear,
  },
};

const STAT_FIELD_MAPPING = {
  pass_yd: 'passing_yards',
  pass_td: 'passing_tds',
  pass_int: 'passing_interceptions',
  pass_2pt: 'passing_2pt_conversions',
  rush_yd: 'rushing_yards',
  rush_td: 'rushing_tds',
  rush_2pt: 'rushing_2pt_conversions',
  fum_lost: 'rushing_fumbles_lost',
  rec: 'receptions',
  rec_yd: 'receiving_yards',
  rec_td: 'receiving_tds',
  rec_2pt: 'receiving_2pt_conversions',
  fum_rec_td: 'receiving_tds',
  fgm: 'fg_made',
  fgmiss: 'fg_missed',
  fgm_50_59: 'fg_made_50_59',
  fgm_60_: 'fg_made_60_',
  xpm: 'pat_made',
  xpmiss: 'pat_missed',
  def_st_td: 'special_teams_tds',
  st_td: 'special_teams_tds',
  def_td: 'def_tds',
  def_int: 'def_interceptions',
  def_fr: 'def_fumbles',
  def_sack: 'def_sacks',
  def_safe: 'def_safeties',
  sack_fum_lost: 'sack_fumbles_lost',
};

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

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function playerKey(year, name, position) {
  return `${year}|${(name || '').trim().toLowerCase()}|${(position || '').trim().toUpperCase()}`;
}

function pairKey(posA, posB) {
  return `${posA}_vs_${posB}`;
}

function valuesMatch(valueA, valueB, tolerance = DEFAULT_VALUE_TOLERANCE) {
  if (valueA == null || valueB == null) return false;
  const avg = (valueA + valueB) / 2;
  const dynamicTol = Math.max(tolerance, avg * 0.02);
  return Math.abs(valueA - valueB) <= dynamicTol;
}

function mapSleeperStats(sleeperStats, position) {
  const mapped = { position: position || '' };
  for (const [sleeperField, scoreField] of Object.entries(STAT_FIELD_MAPPING)) {
    if (sleeperStats[sleeperField] !== undefined) {
      mapped[scoreField] = (mapped[scoreField] || 0) + sleeperStats[sleeperField];
    }
  }
  if (sleeperStats.fum_lost !== undefined && !mapped.rushing_fumbles_lost) {
    mapped.rushing_fumbles_lost = sleeperStats.fum_lost;
  }
  return mapped;
}

async function loadScoringConfig() {
  const raw = await fs.readFile(path.join(DATA_DIR, 'score_format.json'), 'utf8');
  return JSON.parse(raw);
}

async function loadPlayersData() {
  const raw = await fs.readFile(path.join(DATA_DIR, 'players.txt'), 'utf8');
  return JSON.parse(raw);
}

async function loadSleeperIdLookup() {
  const text = await fs.readFile(FINAL_KTC_CSV, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);
  const lookup = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvRow(lines[i]);
    const year = parseInt(cols[idx('year')], 10);
    const name = (cols[idx('name')] || '').trim();
    const position = (cols[idx('position')] || '').trim().toUpperCase();
    const sleeperId = (cols[idx('sleeper_id')] || '').trim();
    if (!Number.isFinite(year) || !name || !sleeperId || !POSITIONS.includes(position)) continue;
    lookup.set(playerKey(year, name, position), sleeperId);
  }

  return lookup;
}

async function loadFinalKtcByYear() {
  const text = await fs.readFile(FINAL_KTC_CSV, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);
  const byYear = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvRow(lines[i]);
    const year = parseInt(cols[idx('year')], 10);
    if (!ANALYSIS_YEARS.includes(year)) continue;
    const name = (cols[idx('name')] || '').trim();
    const position = (cols[idx('position')] || '').trim().toUpperCase();
    const sleeperId = (cols[idx('sleeper_id')] || '').trim();
    const value = parseInt(cols[idx('ktc_value')], 10);
    if (!name || !sleeperId || !POSITIONS.includes(position) || !Number.isFinite(value)) continue;

    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({ name, position, value, playerId: sleeperId });
  }

  for (const [year, rows] of byYear.entries()) {
    byYear.set(year, filterTopKtcPlayers(rows, TOP_KTC_RANK));
  }

  return byYear;
}

async function loadCompAdjByYear() {
  const sleeperLookup = await loadSleeperIdLookup();
  const text = await fs.readFile(COMP_ADJ_CSV, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);
  const byYear = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvRow(lines[i]);
    const year = parseInt(cols[idx('year')], 10);
    if (!ANALYSIS_YEARS.includes(year)) continue;
    const name = (cols[idx('name')] || '').trim();
    const position = (cols[idx('position')] || '').trim().toUpperCase();
    const value = parseInt(cols[idx('competitor_adjusted_value')], 10);
    if (!name || !POSITIONS.includes(position) || !Number.isFinite(value)) continue;

    const playerId = sleeperLookup.get(playerKey(year, name, position)) || '';
    if (!playerId) continue;

    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({ name, position, value, playerId });
  }

  for (const [year, rows] of byYear.entries()) {
    byYear.set(year, filterTopKtcPlayers(rows, TOP_KTC_RANK));
  }

  return byYear;
}

async function buildSeasonWeeklyPoints(season, playersData, scoringConfig) {
  const weeks = Array.from({ length: 17 }, (_, i) => i + 1);
  const playerWeeklyPoints = Array.from({ length: 17 }, () => ({}));

  for (const week of weeks) {
    const weeklyStats = await fetchWeeklyStats(season, week);
    const weekIdx = week - 1;
    const weekPts = playerWeeklyPoints[weekIdx];

    for (const [pid, stats] of Object.entries(weeklyStats || {})) {
      if (!stats || typeof stats !== 'object') continue;
      const player = playersData[pid];
      const position = player?.position || '';
      const mapped = mapSleeperStats(stats, position);
      weekPts[pid] = calculateFantasyPoints(mapped, scoringConfig);
    }

    if (week !== weeks[weeks.length - 1]) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  return playerWeeklyPoints;
}

function seasonTotalPoints(playerId, playerWeeklyPoints) {
  let total = 0;
  for (const week of playerWeeklyPoints) {
    total += week[playerId] ?? 0;
  }
  return Math.round(total * 10) / 10;
}

function buildPlayersWithHvorp(players, playerWeeklyPoints) {
  const result = [];
  for (const player of players) {
    const total = seasonTotalPoints(player.playerId, playerWeeklyPoints);
    if (total <= 0) continue;
    result.push({
      ...player,
      hvorp: total,
      totalScore: total,
    });
  }
  return result;
}

function findValueMatchedPairs(playersWithHvorp) {
  const byPosition = Object.fromEntries(POSITIONS.map((p) => [p, []]));
  for (const player of playersWithHvorp) {
    byPosition[player.position].push(player);
  }

  const comparisons = [];
  for (let i = 0; i < POSITIONS.length; i += 1) {
    for (let j = i + 1; j < POSITIONS.length; j += 1) {
      const posA = POSITIONS[i];
      const posB = POSITIONS[j];
      for (const playerA of byPosition[posA]) {
        for (const playerB of byPosition[posB]) {
          if (!valuesMatch(playerA.value, playerB.value)) continue;
          const delta = Math.round((playerA.hvorp - playerB.hvorp) * 10) / 10;
          comparisons.push({
            season: null,
            posA,
            posB,
            pairKey: pairKey(posA, posB),
            playerA: playerA.name,
            playerB: playerB.name,
            playerIdA: playerA.playerId,
            playerIdB: playerB.playerId,
            valueA: playerA.value,
            valueB: playerB.value,
            valueGap: Math.round((playerA.value - playerB.value) * 10) / 10,
            hvorpA: playerA.hvorp,
            hvorpB: playerB.hvorp,
            delta,
            pctDelta: hvorpPctDelta(playerA.hvorp, playerB.hvorp, delta),
          });
        }
      }
    }
  }
  return comparisons;
}

function aggregateComparisons(comparisons) {
  const byPair = {};
  for (let i = 0; i < POSITIONS.length; i += 1) {
    for (let j = i + 1; j < POSITIONS.length; j += 1) {
      const posA = POSITIONS[i];
      const posB = POSITIONS[j];
      byPair[pairKey(posA, posB)] = {
        posA,
        posB,
        label: `${posA} vs ${posB}`,
        count: 0,
        avgDelta: null,
        avgPctDelta: null,
        comparisons: [],
      };
    }
  }

  for (const row of comparisons) {
    const bucket = byPair[row.pairKey];
    if (!bucket) continue;
    bucket.count += 1;
    bucket.avgDelta = bucket.avgDelta == null ? row.delta : bucket.avgDelta + row.delta;
    bucket.comparisons.push(row);
  }

  for (const bucket of Object.values(byPair)) {
    if (bucket.count > 0) {
      bucket.avgDelta = Math.round((bucket.avgDelta / bucket.count) * 10) / 10;
      bucket.avgPctDelta = groupHvorpPctDelta(bucket.comparisons);
      delete bucket.comparisons;
    }
  }

  const avgDeltaOverall = comparisons.length
    ? Math.round(
      (comparisons.reduce((s, c) => s + c.delta, 0) / comparisons.length) * 10,
    ) / 10
    : null;

  return {
    byPair,
    avgDeltaOverall,
    avgPctDeltaOverall: groupHvorpPctDelta(comparisons),
    totalComparisons: comparisons.length,
  };
}

async function writeDataset(config, allComparisons, seasonMeta, aggregate) {
  const outputCsv = path.join(DATA_DIR, `${config.basename}.csv`);
  const outputMeta = path.join(DATA_DIR, `${config.basename}_meta.json`);

  const csvHeader = [
    'season', 'pos_a', 'pos_b', 'pair_key', 'player_a', 'player_b',
    'player_id_a', 'player_id_b', 'value_a', 'value_b', 'value_gap',
    'hvorp_a', 'hvorp_b', 'delta',
  ].join(',');

  const csvLines = [csvHeader];
  for (const row of allComparisons) {
    csvLines.push([
      row.season,
      row.posA,
      row.posB,
      row.pairKey,
      csvEscape(row.playerA),
      csvEscape(row.playerB),
      row.playerIdA,
      row.playerIdB,
      row.valueA,
      row.valueB,
      row.valueGap,
      row.hvorpA,
      row.hvorpB,
      row.delta,
    ].join(','));
  }

  const meta = {
    dataset_id: config.datasetId,
    value_dataset: config.id,
    comparisons_csv: `${config.basename}.csv`,
    generated_at: new Date().toISOString(),
    years: ANALYSIS_YEARS,
    top_ktc_rank: TOP_KTC_RANK,
    value_source: config.valueSource,
    value_tolerance: DEFAULT_VALUE_TOLERANCE,
    value_tolerance_pct: 0.02,
    base_roster_size: 0,
    hvorp_method: 'empty_roster_optimal_lineup (season points)',
    pct_method: 'symmetric per pair; summary weighted by abs(delta)',
    total_comparisons: allComparisons.length,
    avg_delta_overall: aggregate.avgDeltaOverall,
    avg_pct_delta_overall: aggregate.avgPctDeltaOverall,
    seasons: seasonMeta,
    by_pair_all_seasons: Object.fromEntries(
      Object.entries(aggregate.byPair).map(([k, v]) => [k, {
        count: v.count,
        avgDelta: v.avgDelta,
        avgPctDelta: v.avgPctDelta,
      }]),
    ),
  };

  await fs.writeFile(outputCsv, `${csvLines.join('\n')}\n`, 'utf8');
  await fs.writeFile(outputMeta, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  console.log(`\nWrote ${allComparisons.length.toLocaleString()} rows → ${outputCsv}`);
  console.log(`Wrote metadata → ${outputMeta}`);

  await writeHvorpMultiplierCsv(config, allComparisons);
}

function formatMultiplierCsv(grounded) {
  const lines = ['position,multiplier'];
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const entry = grounded.byPosition?.[pos];
    if (entry?.multiplier != null && Number.isFinite(entry.multiplier)) {
      lines.push(`${pos},${entry.multiplier}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function writeHvorpMultiplierCsv(config, allComparisons) {
  const adjustmentKey = config.hvorpAdjustmentKey;
  const adjustmentCfg = HVORP_VALUE_ADJUSTMENTS[adjustmentKey];
  if (!adjustmentCfg) return;

  const grounded = computeQbGroundedMultipliers(allComparisons);
  const outputPath = path.join(DATA_DIR, path.basename(adjustmentCfg.multipliersCsv));
  await fs.writeFile(outputPath, formatMultiplierCsv(grounded), 'utf8');

  const summary = ['QB', 'RB', 'WR', 'TE']
    .filter((pos) => grounded.byPosition?.[pos]?.multiplier != null)
    .map((pos) => `${pos}×${grounded.byPosition[pos].multiplier}`)
    .join(', ');
  console.log(`Wrote HVORP multipliers → ${outputPath}`);
  console.log(`  ${summary}`);
}

async function buildDataset({ config, loadByYear }, getWeeklyPoints, playersData) {
  console.log(`\n=== ${config.label} ===`);
  const byYear = await loadByYear();
  const allComparisons = [];
  const seasonMeta = [];

  for (const year of ANALYSIS_YEARS) {
    const players = byYear.get(year) || [];
    if (players.length === 0) {
      console.warn(`  ${year}: no value rows — skipping`);
      continue;
    }

    console.log(`  ${year}: ${players.length} players in pool…`);
    const playerWeeklyPoints = await getWeeklyPoints(year);
    const withHvorp = buildPlayersWithHvorp(players, playerWeeklyPoints);
    const comparisons = findValueMatchedPairs(withHvorp).map((c) => ({ ...c, season: year }));
    const agg = aggregateComparisons(comparisons);

    allComparisons.push(...comparisons);
    seasonMeta.push({
      season: year,
      valuePlayers: players.length,
      playersEvaluated: withHvorp.length,
      totalComparisons: comparisons.length,
      avgDeltaOverall: agg.avgDeltaOverall,
      avgPctDeltaOverall: agg.avgPctDeltaOverall,
      byPair: Object.fromEntries(
        Object.entries(agg.byPair).map(([k, v]) => [k, {
          count: v.count,
          avgDelta: v.avgDelta,
          avgPctDelta: v.avgPctDelta,
        }]),
      ),
    });

    console.log(
      `  ${year}: ${withHvorp.length} players scored, ${comparisons.length} matched pairs`,
    );
  }

  const aggregate = aggregateComparisons(allComparisons);
  await writeDataset(config, allComparisons, seasonMeta, aggregate);
}

async function main() {
  console.log('Loading scoring config…');
  const [playersData, scoringConfig] = await Promise.all([
    loadPlayersData(),
    loadScoringConfig(),
  ]);

  const weeklyPointsCache = new Map();
  async function getWeeklyPoints(year) {
    if (!weeklyPointsCache.has(year)) {
      console.log(`  Fetching ${year} weekly stats (17 weeks)…`);
      weeklyPointsCache.set(
        year,
        await buildSeasonWeeklyPoints(year, playersData, scoringConfig),
      );
    }
    return weeklyPointsCache.get(year);
  }

  for (const builder of Object.values(DATASET_BUILDERS)) {
    await buildDataset(builder, getWeeklyPoints, playersData);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
