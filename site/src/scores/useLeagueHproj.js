import { useEffect, useMemo, useState } from 'react';
import {
  HPROJ_LIST_ITERATIONS,
  hprojPlayerPositions,
  liveScaleFromInProgressGames,
  lockedPtsFromCompletedGames,
  simulateTeamHproj,
  weekHasStartedGames,
} from './hprojTeamSim';
import { collectOutPlayerIds } from './liveOutlook';

/**
 * P50 HProj + live P50 (Final/Out locked; live games ESPN-scaled) per roster.
 * Runs after first paint so the board is not blocked on the Monte Carlos.
 */
export default function useLeagueHproj({
  season,
  week,
  rosters,
  playersData,
  projectedPtsById,
  playerGameLabels = null,
  weekScoresByRoster = null,
  injuriesMap = null,
  playerIdMap = null,
  enabled = true,
}) {
  const [hprojByRoster, setHprojByRoster] = useState({});
  const [liveProjByRoster, setLiveProjByRoster] = useState({});

  const gamesStarted = weekHasStartedGames(playerGameLabels);

  const liveMapsByRoster = useMemo(() => {
    const out = {};
    if (!gamesStarted || !weekScoresByRoster) return out;
    const entries = Array.isArray(rosters) ? rosters : [];
    for (const roster of entries) {
      if (!roster) continue;
      const rid = roster.roster_id;
      const score = weekScoresByRoster[rid] || weekScoresByRoster[String(rid)];
      const outIds = collectOutPlayerIds(roster.players, injuriesMap, playersData, playerIdMap);
      const opts = { projectedPtsById, outPlayerIds: outIds };
      const locked = lockedPtsFromCompletedGames(score, playerGameLabels, opts);
      const liveScale = liveScaleFromInProgressGames(score, playerGameLabels, opts);
      if (Object.keys(locked).length || Object.keys(liveScale).length) {
        out[String(rid)] = { locked, liveScale };
      }
    }
    return out;
  }, [gamesStarted, weekScoresByRoster, rosters, playerGameLabels, projectedPtsById, injuriesMap, playersData, playerIdMap]);

  const liveMapsSig = useMemo(() => JSON.stringify(liveMapsByRoster), [liveMapsByRoster]);

  useEffect(() => {
    setHprojByRoster({});
    setLiveProjByRoster({});
    if (!enabled) return;
    if (!Array.isArray(rosters) || !playersData) return;
    if (!projectedPtsById || Object.keys(projectedPtsById).length === 0) return;

    let cancelled = false;
    let timeoutId = null;
    const liveMaps = liveMapsSig ? JSON.parse(liveMapsSig) : {};

    const yieldToPaint = () =>
      new Promise((resolve) => {
        timeoutId = setTimeout(resolve, 0);
      });

    const run = async () => {
      const nextH = {};
      const nextL = {};
      for (const roster of rosters) {
        if (cancelled || !roster) return;
        const rid = roster.roster_id;
        const playerIds = roster.players || [];
        const playerPositions = hprojPlayerPositions(playerIds, playersData);
        const base = {
          playerIds,
          projectedPtsById,
          playerPositions,
          iterations: HPROJ_LIST_ITERATIONS,
        };
        const hproj = simulateTeamHproj({
          ...base,
          seed: `${rid}-${season}-${week}`,
        });
        if (hproj.players > 0) {
          nextH[String(rid)] = hproj.p50.total;
        }
        const maps = liveMaps[String(rid)];
        if (maps && (Object.keys(maps.locked || {}).length || Object.keys(maps.liveScale || {}).length)) {
          const live = simulateTeamHproj({
            ...base,
            lockedPtsById: maps.locked,
            liveScaleById: maps.liveScale,
            seed: `${rid}-${season}-${week}-live`,
          });
          if (live.players > 0) {
            nextL[String(rid)] = live.p50.total;
          }
        } else if (hproj.players > 0) {
          nextL[String(rid)] = hproj.p50.total;
        }
        if (!cancelled) {
          setHprojByRoster({ ...nextH });
          setLiveProjByRoster({ ...nextL });
        }
        await yieldToPaint();
      }
    };

    timeoutId = setTimeout(run, 0);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [enabled, season, week, rosters, playersData, projectedPtsById, liveMapsSig]);

  return { hprojByRoster, liveProjByRoster, gamesStarted };
}
