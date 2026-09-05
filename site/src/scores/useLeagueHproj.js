import { useEffect, useState } from 'react';
import {
  HPROJ_LIST_ITERATIONS,
  hprojPlayerPositions,
  simulateTeamHproj,
} from './hprojTeamSim';

/**
 * P50 HProj per roster for the scores list. Runs after first paint so the
 * board is not blocked on ~12 roster Monte Carlos.
 */
export default function useLeagueHproj({
  season,
  week,
  rosters,
  playersData,
  projectedPtsById,
  enabled = true,
}) {
  const [byRoster, setByRoster] = useState({});

  useEffect(() => {
    setByRoster({});
    if (!enabled) return;
    if (!Array.isArray(rosters) || !playersData) return;
    if (!projectedPtsById || Object.keys(projectedPtsById).length === 0) return;

    let cancelled = false;
    let timeoutId = null;

    const yieldToPaint = () =>
      new Promise((resolve) => {
        timeoutId = setTimeout(resolve, 0);
      });

    const run = async () => {
      const next = {};
      for (const roster of rosters) {
        if (cancelled || !roster) return;
        const rid = roster.roster_id;
        const playerIds = roster.players || [];
        const result = simulateTeamHproj({
          playerIds,
          projectedPtsById,
          playerPositions: hprojPlayerPositions(playerIds, playersData),
          iterations: HPROJ_LIST_ITERATIONS,
          seed: `${rid}-${season}-${week}`,
        });
        if (result.players > 0) {
          next[String(rid)] = result.p50.total;
          if (!cancelled) setByRoster({ ...next });
        }
        await yieldToPaint();
      }
    };

    timeoutId = setTimeout(run, 0);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [enabled, season, week, rosters, playersData, projectedPtsById]);

  return byRoster;
}
