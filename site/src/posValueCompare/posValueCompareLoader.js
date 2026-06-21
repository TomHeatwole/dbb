/**
 * Data loading for Pos Value Compare sandbox feature.
 */

import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { fetchMultipleWeeksStats } from '../data_parse/weeklyStatsLoader';
import { getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { buildSleeperBasePoints } from '../scenarios/sleeperScoring';
import { loadFinalKtcValuesRankings } from '../rankingsViewer/rankingsViewerLoader';
import {
  computePosValueCompare,
  DEFAULT_VALUE_TOLERANCE,
  EMPTY_ROSTER,
} from './computePosValueCompare';

export const ANALYSIS_YEARS = [2021, 2022, 2023, 2024, 2025];

function buildPlayerWeeklyPoints(weeksParsedData, sleeperWeeklyStats, scoringConfig, playersData) {
  const base = (sleeperWeeklyStats && scoringConfig)
    ? buildSleeperBasePoints(sleeperWeeklyStats, scoringConfig, playersData)
    : Array.from({ length: 17 }, () => ({}));

  return (weeksParsedData || []).map((weekEntries, weekIdx) => {
    const weekPts = { ...base[weekIdx] };
    (weekEntries || []).forEach((entry) => {
      for (const [pid, pts] of Object.entries(entry?.players_points || {})) {
        weekPts[pid] = pts;
      }
    });
    return weekPts;
  });
}

async function loadScoringContext(season) {
  const allWeeks = Array.from({ length: 17 }, (_, i) => i + 1);

  const [weeksData, idMap, players, scoringConfig, sleeperWeeklyStats] = await Promise.all([
    fetchScoresData(season),
    fetchPlayerIdMap(),
    fetch('/data/players.txt').then((r) => r.json()).catch(() => null),
    fetch('/data/score_format.json').then((r) => r.json()).catch(() => null),
    fetchMultipleWeeksStats(season, allWeeks, 0).catch(() => null),
  ]);

  const sleeperWeeklyStatsArray = sleeperWeeklyStats
    ? Array.from({ length: 17 }, (_, i) => sleeperWeeklyStats[i + 1] || null)
    : null;

  const playerWeeklyPoints = buildPlayerWeeklyPoints(
    weeksData,
    sleeperWeeklyStatsArray,
    scoringConfig,
    players,
  );
  const playerSeasonTotalsMap = getPlayerSeasonTotalsMap(weeksData);

  return {
    playerWeeklyPoints,
    playersData: players,
    playerIdMap: idMap,
    playerSeasonTotalsMap,
  };
}

/**
 * Preseason KTC board → { name, position, value, playerId } for one season.
 */
export async function loadSeasonValuePlayers(season) {
  const { rows } = await loadFinalKtcValuesRankings(season);
  return rows
    .filter((row) => row.sleeperId && row.position && Number.isFinite(row.value))
    .map((row) => ({
      name: row.name,
      position: row.position.toUpperCase(),
      value: row.value,
      playerId: row.sleeperId,
    }));
}

export async function runSeasonPosValueCompare(season, options = {}) {
  const {
    baseRoster = EMPTY_ROSTER,
    valueTolerance = DEFAULT_VALUE_TOLERANCE,
  } = options;

  const [players, scoringContext] = await Promise.all([
    loadSeasonValuePlayers(season),
    loadScoringContext(season),
  ]);

  return computePosValueCompare({
    players,
    baseRoster,
    valueTolerance,
    season,
    ...scoringContext,
  });
}

function mergePairGroups(seasonResults) {
  const merged = {};
  for (const result of seasonResults) {
    for (const [key, group] of Object.entries(result.byPair || {})) {
      if (!merged[key]) {
        merged[key] = {
          ...group,
          comparisons: [],
          count: 0,
          avgDelta: null,
        };
      }
      merged[key].comparisons.push(...group.comparisons.map((c) => ({
        ...c,
        season: result.season,
      })));
    }
  }

  for (const group of Object.values(merged)) {
    group.count = group.comparisons.length;
    if (group.count > 0) {
      const sum = group.comparisons.reduce((s, c) => s + c.delta, 0);
      group.avgDelta = Math.round((sum / group.count) * 10) / 10;
    }
  }

  const allComparisons = seasonResults.flatMap((r) =>
    r.comparisons.map((c) => ({ ...c, season: r.season })),
  );
  const avgDeltaOverall = allComparisons.length
    ? Math.round(
      (allComparisons.reduce((s, c) => s + c.delta, 0) / allComparisons.length) * 10,
    ) / 10
    : null;

  return {
    byPair: merged,
    comparisons: allComparisons,
    avgDeltaOverall,
    totalComparisons: allComparisons.length,
  };
}

/**
 * Run analysis for 2021–2025 (configurable via years param).
 */
export async function runMultiSeasonPosValueCompare(years = ANALYSIS_YEARS, onProgress) {
  const seasonResults = [];

  for (let i = 0; i < years.length; i += 1) {
    const year = years[i];
    if (onProgress) onProgress({ phase: 'season', year, index: i, total: years.length });
    const result = await runSeasonPosValueCompare(year);
    seasonResults.push(result);
  }

  const aggregate = mergePairGroups(seasonResults);

  return {
    years,
    seasonResults,
    aggregate,
    valueTolerance: DEFAULT_VALUE_TOLERANCE,
    baseRoster: EMPTY_ROSTER,
  };
}

export { DEFAULT_VALUE_TOLERANCE, EMPTY_ROSTER };
