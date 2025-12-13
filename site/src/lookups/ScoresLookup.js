import { LEAGUE_ID, PREVIOUS_YEARS, PAUSE_SCRAPES } from '../utils/global_constants';
import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';
import { writeApiCacheWithKey, readApiCacheLatestByKey, recordRateLimitHit } from '../utils/database';

export async function fetchScoresData(season, options = {}) {
  // Determine leagueId based on season
  const currentYear = new Date().getFullYear().toString();
  const isCurrentSeason = season === undefined || season === null || season === '' || season === currentYear;
  const leagueId = isCurrentSeason ? LEAGUE_ID : PREVIOUS_YEARS[season];

  let weeksParsedData = null;

  const fetchWeekData = async (season, weekNum) => {
    const apiUrl = `https://api.sleeper.app/v1/league/${leagueId}/matchups/${weekNum}`;
    const cacheKey = `sleeper_v1_league_${leagueId}_matchups_${weekNum}`;
    const forceUpdate = !!options.forceUpdate;

    // When not forcing, read from DB cache first and optionally trigger a
    // background refresh based on TTL for the active week.
    if (!forceUpdate) {
      try {
        const cached = await readApiCacheLatestByKey(cacheKey);
        if (cached && Array.isArray(cached.data)) {
          const ageMs = Date.now() - (cached.ts || 0);
          const isActiveWeek =
            String(season) === String(CURRENT_YEAR) &&
            Number(weekNum) === getCurrentNFLWeek();
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
          const weekArr = cached.data;
          return weekArr.map(({ matchup_id, ...rest }) => rest);
        }
      } catch (_) {
        // fall through to network fetch
      }
    }

    // No cache (or forceUpdate): fetch once if it's the active week OR it's a past season (seed DB)
    const isActiveWeek = (String(season) === String(CURRENT_YEAR)) && (Number(weekNum) === getCurrentNFLWeek());
    const isPastSeason = String(season) !== String(CURRENT_YEAR);
    if (!isActiveWeek && !isPastSeason) { return null; }
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

  // For all seasons, read from DB first; only fetch if cache missing AND active week
  weeksParsedData = await Promise.all(
    Array.from({ length: 17 }, (_, i) => fetchWeekData(season || currentYear, i + 1))
  );

  return weeksParsedData;
} 