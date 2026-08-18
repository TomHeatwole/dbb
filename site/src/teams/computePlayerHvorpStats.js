/**
 * Roster-context HVORP for the team Player Analytics tab.
 *
 * HVORP = optimal starter points with the player minus optimal starter points
 * without them (leave-one-out). Rate stats divide by games with a score so
 * missed weeks don't dilute the per-game number.
 */

import { computeOptimalWeek } from '../scenarios/computeScenarioEval';

export const PLAYOFF_START_WEEK = 15;
const MAX_WEEKS = 17;

function round1(n) {
  return Math.round((n || 0) * 10) / 10;
}

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}

export function buildPlayerWeeklyPointsFromMatchups(weeksParsedData) {
  return (weeksParsedData || []).map((weekEntries) => {
    const weekPts = {};
    (weekEntries || []).forEach((entry) => {
      for (const [pid, pts] of Object.entries(entry?.players_points || {})) {
        weekPts[pid] = pts;
      }
    });
    return weekPts;
  });
}

function weekHasScores(weekEntries) {
  return Array.isArray(weekEntries) && weekEntries.some((e) => e && e.players_points);
}

/**
 * @returns {Array<{
 *   playerId: string,
 *   totalScore: number,
 *   hvorp: number,
 *   hvorpPerGame: number|null,
 *   playoffHvorp: number,
 *   playoffHvorpPerGame: number|null,
 *   gamesPlayed: number,
 *   playoffGamesPlayed: number,
 *   weeksStarted: number,
 *   weeksBenched: number,
 *   ppg: number|null,
 *   weekly: Array<{ week: number, pts: number, hvorp: number, started: boolean, played: boolean, isPlayoff: boolean }>,
 * }>}
 */
export function computeTeamPlayerHvorpStats({
  rosterPlayerIds,
  weeksParsedData,
  playersData,
  playerIdMap,
  playerSeasonTotalsMap,
  weekCount,
}) {
  const playerList = (rosterPlayerIds || []).filter((pid) => pid && pid !== '0');
  const playerWeeklyPoints = buildPlayerWeeklyPointsFromMatchups(weeksParsedData);
  const completed = Number.isFinite(weekCount) ? weekCount : playerWeeklyPoints.length;
  const n = Math.max(0, Math.min(MAX_WEEKS, completed, playerWeeklyPoints.length));

  const statsByPlayer = {};
  for (const pid of playerList) {
    statsByPlayer[pid] = {
      playerId: pid,
      totalScore: 0,
      hvorp: 0,
      playoffHvorp: 0,
      gamesPlayed: 0,
      playoffGamesPlayed: 0,
      weeksStarted: 0,
      weeksBenched: 0,
      weekly: [],
    };
  }

  if (playerList.length === 0 || n === 0) {
    return playerList.map((pid) => finalizePlayerStats(statsByPlayer[pid]));
  }

  for (let wi = 0; wi < n; wi++) {
    const weekNum = wi + 1;
    if (!weekHasScores(weeksParsedData?.[wi])) {
      continue;
    }

    const weekPts = playerWeeklyPoints[wi] || {};
    const withOptimal = computeOptimalWeek(
      playerList,
      weekPts,
      playersData,
      playerIdMap,
      playerSeasonTotalsMap,
    );
    const withTotal = withOptimal?.starterTotal || 0;
    const starterIds = new Set(
      (withOptimal?.starters || []).map((p) => p.id).filter((id) => id && id !== '0'),
    );
    const isPlayoff = weekNum >= PLAYOFF_START_WEEK;

    for (const pid of playerList) {
      const pts = weekPts[pid] ?? 0;
      const played = Number(pts) !== 0;
      const started = starterIds.has(pid);

      const rosterWithout = playerList.filter((id) => id !== pid);
      const withoutOptimal = computeOptimalWeek(
        rosterWithout,
        weekPts,
        playersData,
        playerIdMap,
        playerSeasonTotalsMap,
      );
      const weekHvorp = withTotal - (withoutOptimal?.starterTotal || 0);

      const row = statsByPlayer[pid];
      row.totalScore += pts;
      row.hvorp += weekHvorp;
      if (isPlayoff) row.playoffHvorp += weekHvorp;
      if (played) {
        row.gamesPlayed += 1;
        if (isPlayoff) row.playoffGamesPlayed += 1;
      }
      if (started) row.weeksStarted += 1;
      else row.weeksBenched += 1;

      row.weekly.push({
        week: weekNum,
        pts: round1(pts),
        hvorp: round1(weekHvorp),
        started,
        played,
        isPlayoff,
      });
    }
  }

  return playerList
    .map((pid) => finalizePlayerStats(statsByPlayer[pid]))
    .sort((a, b) => (b.hvorp - a.hvorp) || (b.totalScore - a.totalScore));
}

function finalizePlayerStats(row) {
  const gamesPlayed = row.gamesPlayed || 0;
  const playoffGames = row.playoffGamesPlayed || 0;
  return {
    ...row,
    totalScore: round1(row.totalScore),
    hvorp: round1(row.hvorp),
    playoffHvorp: round1(row.playoffHvorp),
    hvorpPerGame: gamesPlayed > 0 ? round2(row.hvorp / gamesPlayed) : null,
    playoffHvorpPerGame: playoffGames > 0 ? round2(row.playoffHvorp / playoffGames) : null,
    ppg: gamesPlayed > 0 ? round2(row.totalScore / gamesPlayed) : null,
  };
}
