import { useEffect, useMemo, useState } from 'react';
import {
  HPROJ_LIST_ITERATIONS,
  hprojMatchupWinProb,
  hprojPlayerPositions,
  liveScaleFromInProgressGames,
  lockedPtsFromCompletedGames,
  simulateTeamHproj,
  weekHasStartedGames,
} from './hprojTeamSim';
import { collectOutPlayerIds } from './liveOutlook';

function rosterById(rosters, id) {
  if (!Array.isArray(rosters) || id == null) return null;
  return rosters.find((r) => r && String(r.roster_id) === String(id)) || null;
}

function liveMapsForRoster({
  roster,
  gamesStarted,
  weekScoresByRoster,
  playerGameLabels,
  projectedPtsById,
  injuriesMap,
  playersData,
  playerIdMap,
}) {
  if (!gamesStarted || !roster || !weekScoresByRoster) return null;
  const rid = roster.roster_id;
  const score = weekScoresByRoster[rid] || weekScoresByRoster[String(rid)];
  const outIds = collectOutPlayerIds(roster.players, injuriesMap, playersData, playerIdMap);
  const opts = { projectedPtsById, outPlayerIds: outIds };
  const locked = lockedPtsFromCompletedGames(score, playerGameLabels, opts);
  const liveScale = liveScaleFromInProgressGames(score, playerGameLabels, opts);
  if (!Object.keys(locked).length && !Object.keys(liveScale).length) return null;
  return { locked, liveScale };
}

function simTotals(roster, {
  season,
  week,
  playersData,
  projectedPtsById,
  liveMaps,
  live,
}) {
  if (!roster) return null;
  const playerIds = roster.players || [];
  const result = simulateTeamHproj({
    playerIds,
    projectedPtsById,
    playerPositions: hprojPlayerPositions(playerIds, playersData),
    iterations: HPROJ_LIST_ITERATIONS,
    lockedPtsById: live ? liveMaps?.locked : null,
    liveScaleById: live ? liveMaps?.liveScale : null,
    seed: `${roster.roster_id}-${season}-${week}${live ? '-live' : ''}`,
  });
  return result.players > 0 ? result.totals : null;
}

/**
 * HPROJ P(left outscores right) for a two-team matchup.
 * Uses live locks/scaling once any game has started.
 */
export default function useHprojMatchupWinProb({
  season,
  week,
  team1Id,
  team2Id,
  rosters,
  playersData,
  projectedPtsById,
  playerGameLabels = null,
  weekScoresByRoster = null,
  injuriesMap = null,
  playerIdMap = null,
  enabled = true,
  leftOffset = 0,
  rightOffset = 0,
}) {
  const [winProb, setWinProb] = useState(null);
  const gamesStarted = weekHasStartedGames(playerGameLabels);

  const leftRoster = useMemo(() => rosterById(rosters, team1Id), [rosters, team1Id]);
  const rightRoster = useMemo(() => rosterById(rosters, team2Id), [rosters, team2Id]);

  const liveMapsSig = useMemo(() => {
    if (!enabled || !leftRoster || !rightRoster) return '';
    const args = {
      gamesStarted,
      weekScoresByRoster,
      playerGameLabels,
      projectedPtsById,
      injuriesMap,
      playersData,
      playerIdMap,
    };
    return JSON.stringify({
      left: liveMapsForRoster({ roster: leftRoster, ...args }),
      right: liveMapsForRoster({ roster: rightRoster, ...args }),
    });
  }, [
    enabled,
    leftRoster,
    rightRoster,
    gamesStarted,
    weekScoresByRoster,
    playerGameLabels,
    projectedPtsById,
    injuriesMap,
    playersData,
    playerIdMap,
  ]);

  useEffect(() => {
    setWinProb(null);
    if (!enabled) return;
    if (!leftRoster || !rightRoster || !playersData) return;
    if (!projectedPtsById || Object.keys(projectedPtsById).length === 0) return;

    let cancelled = false;
    let timeoutId = null;
    const maps = liveMapsSig ? JSON.parse(liveMapsSig) : { left: null, right: null };

    timeoutId = setTimeout(() => {
      if (cancelled) return;
      const leftPregame = simTotals(leftRoster, {
        season, week, playersData, projectedPtsById, liveMaps: maps.left, live: false,
      });
      const rightPregame = simTotals(rightRoster, {
        season, week, playersData, projectedPtsById, liveMaps: maps.right, live: false,
      });
      const left = gamesStarted && maps.left
        ? simTotals(leftRoster, {
          season, week, playersData, projectedPtsById, liveMaps: maps.left, live: true,
        })
        : leftPregame;
      const right = gamesStarted && maps.right
        ? simTotals(rightRoster, {
          season, week, playersData, projectedPtsById, liveMaps: maps.right, live: true,
        })
        : rightPregame;
      if (!cancelled) {
        const add = (totals, offset) => {
          const n = Number(offset) || 0;
          if (!Array.isArray(totals) || !n) return totals;
          return totals.map((t) => t + n);
        };
        setWinProb(hprojMatchupWinProb(add(left, leftOffset), add(right, rightOffset)));
      }
    }, 0);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [
    enabled,
    season,
    week,
    leftRoster,
    rightRoster,
    playersData,
    projectedPtsById,
    gamesStarted,
    liveMapsSig,
    leftOffset,
    rightOffset,
  ]);

  return { winProb, gamesStarted };
}
