/**
 * Build the rest-of-regular-season HProj field and replay it.
 * Weeks 1–14. Top 4 make the playoffs.
 */

import { PLAYOFF_FORMATS, playoffFormatForSeason } from '../scenarios/playoffStandings';
import { REG_SEASON_WEEKS } from '../scenarios/simulatorLineup';
import { PLAYOFF_LAST_WEEK } from './playoffHprojOdds';
import { computeProjectedPointsMap } from '../scores/projectionScoring';
import { getGameDisplayForTeam, mapPlayersToGames } from '../scores/GamesParser';
import {
  hprojPlayerPositions,
  liveScaleFromInProgressGames,
  lockedPtsFromCompletedGames,
  simulateTeamHproj,
  weekHasStartedGames,
} from '../scores/hprojTeamSim';
import { collectOutPlayerIds } from '../scores/liveOutlook';
import { StartSitSort } from '../players/StartSitDecider';
import { getWeekScoreBreakdown } from '../scores/ScoresParser';
import {
  PLAYOFF_SPOTS,
  opponentsFromProjections,
  resolveWeekProjection,
  simulatePlayoffField,
  sumBankedPoints,
} from './playoffHprojOdds';

export const PLAYOFF_WEEK_DRAWS = 640;
export const PLAYOFF_SEASON_ITERS = 8000;

function yieldToPaint() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function rosterPlayerIds(roster) {
  return (roster?.players || []).filter((id) => id && String(id) !== '0');
}

function liveLocks(score, labels, outIds, lockOpts) {
  const fromGames = lockedPtsFromCompletedGames(score, labels, lockOpts);
  if (score || !outIds) return fromGames;
  const locks = { ...fromGames };
  for (const id of outIds) locks[String(id)] = 0;
  return locks;
}

async function labelsForPlayers(playerIds, playersData, playerIdMap, scoreboard) {
  if (!scoreboard) return {};
  const mapping = await mapPlayersToGames(playerIds, playersData, playerIdMap, scoreboard, null);
  const labels = {};
  for (const pid of playerIds) {
    const item = mapping[pid] || mapping[String(pid)];
    const ev = item && item.event;
    const teamForWeek = item && item.team;
    const display = ev
      ? getGameDisplayForTeam(ev, teamForWeek)
      : { text: 'BYE', live: false, completed: false };
    labels[String(pid)] = { ...display, team: teamForWeek || null };
  }
  return labels;
}

/**
 * @param {object} input
 * @param {Array} input.rosters
 * @param {Array} input.weeksData
 * @param {object} input.playersData
 * @param {object} input.playerIdMap
 * @param {object} input.scoring
 * @param {object} [input.injuriesMap]
 * @param {Array<{ week: number, byPlayerId: object, scoreboard: object|null }>} input.weekBundles
 * @param {number} input.bankedThrough
 * @param {number} input.currentWeek
 * @param {number} [input.draws]
 * @param {number} [input.iterations]
 * @param {(label: string) => void} [input.onProgress]
 * @param {() => boolean} [input.cancelled]
 */
export async function runPlayoffHproj(input) {
  const rosters = (input.rosters || []).filter((r) => r && r.roster_id != null);
  const bankedThrough = Math.max(0, Math.min(REG_SEASON_WEEKS, Number(input.bankedThrough) || 0));
  const currentWeek = Number(input.currentWeek) || bankedThrough;
  const draws = Math.max(40, Number(input.draws) || PLAYOFF_WEEK_DRAWS);
  const iterations = Math.max(1, Number(input.iterations) || PLAYOFF_SEASON_ITERS);
  const cancelled = input.cancelled || (() => false);
  const onProgress = input.onProgress || (() => {});
  const playersData = input.playersData || {};
  const playerIdMap = input.playerIdMap || {};
  const scoring = input.scoring || {};
  const injuriesMap = input.injuriesMap || {};

  const allIds = [];
  const seen = new Set();
  for (const roster of rosters) {
    for (const id of rosterPlayerIds(roster)) {
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      allIds.push(id);
    }
  }

  const allBundles = (input.weekBundles || []).slice().sort((a, b) => a.week - b.week);
  const regBundles = allBundles.filter(
    (bundle) => bundle && bundle.week > bankedThrough && bundle.week <= REG_SEASON_WEEKS,
  );
  const playoffBundles = allBundles.filter(
    (bundle) => bundle && bundle.week > REG_SEASON_WEEKS && bundle.week <= PLAYOFF_LAST_WEEK,
  );

  let baseline = {};
  const weekPlans = [];
  for (const bundle of regBundles) {
    if (cancelled()) return null;
    onProgress(`Reading week ${bundle.week} projections`);
    const rawMap = computeProjectedPointsMap(bundle.byPlayerId || {}, scoring);
    const opponents = opponentsFromProjections(bundle.byPlayerId);
    const labels = await labelsForPlayers(allIds, playersData, playerIdMap, bundle.scoreboard);
    const resolved = resolveWeekProjection({
      rawMap,
      baseline,
      labels,
      opponents,
      rosterIds: allIds,
    });
    baseline = resolved.baseline;
    const live = bundle.week === currentWeek && weekHasStartedGames(labels);
    weekPlans.push({
      week: bundle.week,
      map: resolved.map,
      labels,
      source: live ? 'live' : resolved.source,
      carried: resolved.source === 'carried',
    });
  }

  const playoffPlans = [];
  for (const bundle of playoffBundles) {
    if (cancelled()) return null;
    onProgress(`Reading week ${bundle.week} projections`);
    const rawMap = computeProjectedPointsMap(bundle.byPlayerId || {}, scoring);
    const opponents = opponentsFromProjections(bundle.byPlayerId);
    const labels = await labelsForPlayers(allIds, playersData, playerIdMap, bundle.scoreboard);
    const resolved = resolveWeekProjection({
      rawMap,
      baseline,
      labels,
      opponents,
      rosterIds: allIds,
    });
    baseline = resolved.baseline;
    playoffPlans.push({
      week: bundle.week,
      map: resolved.map,
      labels,
      source: resolved.source,
      carried: resolved.source === 'carried',
    });
  }

  const livePlan = weekPlans.find((plan) => plan.source === 'live');
  const liveWeek = livePlan ? livePlan.week : null;
  const currentScores = liveWeek
    ? (getWeekScoreBreakdown(input.weeksData, liveWeek) || {})
    : null;

  const liveWeekActualByRoster = {};
  if (liveWeek && currentScores && input.playersData && input.playerIdMap) {
    for (const roster of rosters) {
      const rid = roster.roster_id;
      const raw = currentScores[rid] || currentScores[String(rid)];
      if (!raw) continue;
      try {
        const computed = StartSitSort(
          raw,
          input.playersData,
          input.playerIdMap,
          null,
          null,
          null,
        );
        if (computed && typeof computed.starterTotal === 'number') {
          liveWeekActualByRoster[rid] = Math.round(computed.starterTotal * 10) / 10;
          liveWeekActualByRoster[String(rid)] = liveWeekActualByRoster[rid];
        }
      } catch (_) {
        /* use scoreboard entry fallback below */
      }
      if (liveWeekActualByRoster[rid] == null) {
        const entry = (input.weeksData?.[liveWeek - 1] || []).find(
          (e) => e && Number(e.roster_id) === Number(rid),
        );
        if (entry && typeof entry.points === 'number' && Number.isFinite(entry.points)) {
          liveWeekActualByRoster[rid] = Math.round(entry.points * 10) / 10;
          liveWeekActualByRoster[String(rid)] = liveWeekActualByRoster[rid];
        }
      }
    }
  }

  const teamWeeks = rosters.map((roster) => ({
    roster,
    weeks: weekPlans.map((plan) => ({
      week: plan.week,
      source: plan.source,
      samples: [],
    })),
    playoffWeeks: playoffPlans.map((plan) => ({
      week: plan.week,
      source: plan.source,
      samples: [],
    })),
  }));

  async function simWeekPlan(plan, weekIndex, team, key) {
    if (cancelled()) return;
    const roster = team.roster;
    const playerIds = rosterPlayerIds(roster);
    const label = input.labelForRoster ? input.labelForRoster(roster) : `Roster ${roster.roster_id}`;
    onProgress(`Week ${plan.week} · ${label}`);
    const live = key === 'reg' && plan.source === 'live';
    const outIds = live
      ? collectOutPlayerIds(playerIds, injuriesMap, playersData, playerIdMap)
      : null;
    const score = live && currentScores
      ? (currentScores[roster.roster_id] || currentScores[String(roster.roster_id)])
      : null;
    const lockOpts = { projectedPtsById: plan.map, outPlayerIds: outIds };
    const sim = simulateTeamHproj({
      playerIds,
      projectedPtsById: plan.map,
      playerPositions: hprojPlayerPositions(playerIds, playersData),
      lockedPtsById: live ? liveLocks(score, plan.labels, outIds, lockOpts) : null,
      liveScaleById: live && score
        ? liveScaleFromInProgressGames(score, plan.labels, lockOpts)
        : null,
      iterations: draws,
      seed: `playoff:${roster.roster_id}:w${plan.week}:${plan.source}`,
    });
    const target = key === 'reg' ? team.weeks[weekIndex] : team.playoffWeeks[weekIndex];
    target.samples = sim.totals && sim.totals.length ? sim.totals : [0];
    await yieldToPaint();
  }

  for (let w = 0; w < weekPlans.length; w += 1) {
    const plan = weekPlans[w];
    for (const team of teamWeeks) {
      if (cancelled()) return null;
      await simWeekPlan(plan, w, team, 'reg');
    }
  }

  for (let w = 0; w < playoffPlans.length; w += 1) {
    const plan = playoffPlans[w];
    for (const team of teamWeeks) {
      if (cancelled()) return null;
      await simWeekPlan(plan, w, team, 'playoff');
    }
  }

  if (cancelled()) return null;
  onProgress('Replaying the rest of the season');
  await yieldToPaint();

  const season = Number(input.season) || null;
  const playoffFormat = playoffFormatForSeason(season);
  const simTeams = teamWeeks.map((team) => ({
    id: team.roster.roster_id,
    pointsSoFar: sumBankedPoints(input.weeksData, team.roster.roster_id, bankedThrough),
    weeks: team.weeks.map((week) => ({ samples: week.samples })),
    playoffWeeks: team.playoffWeeks.map((week) => ({ samples: week.samples })),
  }));
  const replaySeed = `playoff-field:${bankedThrough}:${weekPlans.map((plan) => plan.week).join(',')}:${playoffPlans.map((plan) => plan.week).join(',')}`;
  const field = simulatePlayoffField(simTeams, {
    iterations,
    spots: PLAYOFF_SPOTS,
    format: playoffFormat,
    seed: replaySeed,
  });

  const weekIndex = new Map(weekPlans.map((plan, index) => [index, plan]));
  const formatMeta = PLAYOFF_FORMATS[playoffFormat] || PLAYOFF_FORMATS.cumulative;
  return {
    bankedThrough,
    bankedWeeksEnd: bankedThrough,
    liveWeek,
    currentWeek,
    iterations: field.iterations,
    spots: field.spots,
    playoffFormat,
    playoffFormatLabel: formatMeta.label,
    cutP50: field.cutP50,
    weeksLeft: weekPlans.length,
    weeks: weekPlans.map((plan) => ({
      week: plan.week,
      source: plan.source,
      carried: plan.carried,
    })),
    playoffWeeks: playoffPlans.map((plan) => ({
      week: plan.week,
      carried: plan.carried,
    })),
    rows: field.rows.map((row) => ({
      ...row,
      rosterId: Number(row.id),
      liveWeekPts: liveWeek
        ? (liveWeekActualByRoster[row.id] ?? liveWeekActualByRoster[String(row.id)] ?? null)
        : null,
      weeks: row.weeks.map((summary, index) => ({
        ...summary,
        week: weekIndex.get(index)?.week,
        source: weekIndex.get(index)?.source,
      })),
    })),
    simTeams,
    replaySeed,
  };
}
