import { LEAGUE_ID, PREVIOUS_YEARS, PAUSE_SCRAPES } from '../utils/global_constants';
import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';
import { writeApiCacheWithKey, readApiCacheLatestByKey, recordRateLimitHit } from '../utils/database';

export async function fetchScoresData(season, options = {}) {
  // Determine leagueId based on season
  const currentYear = new Date().getFullYear().toString();
  const isCurrentSeason = season === undefined || season === null || season === '' || season === currentYear;
  const leagueId = isCurrentSeason ? LEAGUE_ID : PREVIOUS_YEARS[season];

  let weeksParsedData = null;

  const forceWeeksArray = Array.isArray(options.forceWeeks)
    ? options.forceWeeks
        .map((w) => Number(w))
        .filter((w) => Number.isFinite(w) && w >= 1 && w <= 17)
    : [];

  const fetchWeekData = async (season, weekNum) => {
    const apiUrl = `https://api.sleeper.app/v1/league/${leagueId}/matchups/${weekNum}`;
    const cacheKey = `sleeper_v1_league_${leagueId}_matchups_${weekNum}`;
    const forceUpdate = !!options.forceUpdate;

    const isActiveWeek =
      String(season) === String(CURRENT_YEAR) &&
      Number(weekNum) === getCurrentNFLWeek();
    const isPastSeason = String(season) !== String(CURRENT_YEAR);
    const isForcedWeek = forceWeeksArray.includes(Number(weekNum));
    const isCurrentSeasonWeek = !isPastSeason; // Any week in the current season

    // When not forcing, read from DB cache first and optionally trigger a
    // background refresh based on TTL for the active week.
    if (!forceUpdate) {
      try {
        const cached = await readApiCacheLatestByKey(cacheKey);
        if (cached && Array.isArray(cached.data)) {
          const cachedArr = cached.data;
          const isEmptyCachedWeek = !cachedArr || cachedArr.length === 0;
          const ageMs = Date.now() - (cached.ts || 0);
          
          // For forced weeks with empty cache, check TTL before deciding to use cache
          if (isForcedWeek && isEmptyCachedWeek) {
            // For empty forced weeks, refetch if cache is older than 5 minutes
            // (matchups might have been created since last check)
            const emptyForcedWeekTtlMs = 300_000; // 5 minutes
            if (ageMs > emptyForcedWeekTtlMs) {
              // Cache is stale, skip cache and fall through to network fetch below
            } else {
              // Cache is recent and empty, use it to avoid excessive API calls
              return cachedArr.map(({ matchup_id, ...rest }) => rest);
            }
          } else {

            // Use cached data
            const activeWeekTtlMs = isActiveWeek
              ? Number(options.activeWeekTtlMs) || 60_000
              : null;
            if (!PAUSE_SCRAPES && isActiveWeek && activeWeekTtlMs != null && ageMs > activeWeekTtlMs) {
              (async () => {
                try {
                  const r2 = await fetch(apiUrl);
                  if (!r2.ok) {
                    if (r2.status === 429) {
                      try { await recordRateLimitHit('sleeper'); } catch (_) {}
                    }
                    return;
                  }
                  const j2 = await r2.json();
                  await writeApiCacheWithKey(cacheKey, apiUrl, j2);
                } catch (_) {
                  /* ignore */
                }
              })();
            }
            const weekArr = cachedArr;
            return weekArr.map(({ matchup_id, ...rest }) => rest);
          }
        }
      } catch (_) {
        // fall through to network fetch
      }
    }

    // No cache (or forceUpdate or forced week with empty cache): 
    // fetch once if it's the active week, a past season, an explicitly forced week, or any week in current season
    if (!isActiveWeek && !isPastSeason && !isForcedWeek && !isCurrentSeasonWeek) { return null; }
    try {
      if (PAUSE_SCRAPES) { return null; }
      const resp = await fetch(apiUrl);
      if (resp.status === 429) {
        try { await recordRateLimitHit('sleeper'); } catch (_) {}
      }
      if (resp.ok) {
        const weekArr = await resp.json();
        try { await writeApiCacheWithKey(cacheKey, apiUrl, weekArr); } catch (_) {}
        return weekArr.map(({ matchup_id, ...rest }) => rest);
      }
    } catch (_) {}
    return null;
  };

  // For all seasons, read from DB first; only fetch if cache missing AND
  // (active week, past season, explicitly forced week, or any week in current season).
  weeksParsedData = await Promise.all(
    Array.from({ length: 17 }, (_, i) => fetchWeekData(season || currentYear, i + 1))
  );

  return weeksParsedData;
}