import { useEffect, useState } from 'react';
import { getSleeperWeeklyProjections } from '../lookups/ProjectionsLookup';
import { fetchLeagueScoringSettings } from '../lookups/ScoringSettingsLookup';
import { computeProjectedPointsMap } from './projectionScoring';

/**
 * League-scored Sleeper weekly projections keyed by player_id.
 * Never throws; empty object on failure.
 */
export default function useWeeklyProjectedPoints(season, week) {
  const [projectedPtsById, setProjectedPtsById] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [proj, scoring] = await Promise.all([
          getSleeperWeeklyProjections(season, week),
          fetchLeagueScoringSettings(season),
        ]);
        if (cancelled) {
          return;
        }
        const byId = proj && proj.byPlayerId ? proj.byPlayerId : {};
        setProjectedPtsById(computeProjectedPointsMap(byId, scoring));
      } catch (err) {
        console.warn('[sleeper-projections] failed to build projected points map', err && err.message ? err.message : err);
        if (!cancelled) {
          setProjectedPtsById({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  return projectedPtsById;
}
