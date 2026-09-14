import { LEAGUE_ID, PREVIOUS_YEARS, PAUSE_SCRAPES } from '../utils/global_constants';
import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';
import { writeApiCacheWithKey, readApiCacheLatestByKey, recordRateLimitHit } from '../utils/database';

function asWeekList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((w) => Number(w))
    .filter((w) => Number.isFinite(w) && w >= 1 && w <= 17);
}

async function fetchAndCacheWeek(apiUrl, cacheKey) {
  if (PAUSE_SCRAPES) return null;
  const resp = await fetch(apiUrl);
  if (resp.status === 429) {
    try { await recordRateLimitHit('sleeper'); } catch (_) {}
  }
  if (!resp.ok) return null;
  const weekArr = await resp.json();
  try { await writeApiCacheWithKey(cacheKey, apiUrl, weekArr); } catch (_) {}
  return weekArr;
}

function stripMatchupId(weekArr) {
  if (!Array.isArray(weekArr)) return weekArr;
  return weekArr.map(({ matchup_id, ...rest }) => rest);
}

export async function fetchScoresData(season, options = {}) {
  const currentYear = String(CURRENT_YEAR);
  const normalizedSeason = season === undefined || season === null || season === '' ? currentYear : String(season);
  const leagueId = PREVIOUS_YEARS[normalizedSeason] ?? (normalizedSeason === currentYear ? LEAGUE_ID : null);
  if (!leagueId) {
    return Array(17).fill(null);
  }

  const forceWeeksArray = asWeekList(options.forceWeeks);
  const networkWeeks = asWeekList(options.networkWeeks);
  const networkWeekSet = networkWeeks.length ? new Set(networkWeeks) : null;
  const forceUpdate = !!options.forceUpdate;
  const staleWhileRevalidate = options.staleWhileRevalidate !== false;
  const currentWk = getCurrentNFLWeek();

  const fetchWeekData = async (seasonVal, weekNum) => {
    const apiUrl = `https://api.sleeper.app/v1/league/${leagueId}/matchups/${weekNum}`;
    const cacheKey = `sleeper_v1_league_${leagueId}_matchups_${weekNum}`;
    const isActiveWeek =
      String(seasonVal) === String(CURRENT_YEAR) &&
      Number(weekNum) === currentWk;
    const isPastSeason = String(seasonVal) !== String(CURRENT_YEAR);
    const isForcedWeek = forceWeeksArray.includes(Number(weekNum));
    const inNetworkWeeks = networkWeekSet ? networkWeekSet.has(Number(weekNum)) : false;
    const canSeedMissing =
      isPastSeason
      || isActiveWeek
      || isForcedWeek
      || (!isPastSeason && Number(weekNum) <= currentWk);

    const mayForceNetwork = !!forceUpdate && (
      networkWeekSet
        ? (inNetworkWeeks || isForcedWeek || isActiveWeek)
        : (isActiveWeek || isForcedWeek)
    );

    let cached = null;
    try {
      cached = await readApiCacheLatestByKey(cacheKey);
    } catch (_) {
      cached = null;
    }
    const hasCache = cached && Array.isArray(cached.data);
    const ageMs = hasCache ? Date.now() - (cached.ts || 0) : Infinity;
    const activeWeekTtlMs = isActiveWeek
      ? (options.activeWeekTtlMs != null ? Number(options.activeWeekTtlMs) : 60_000)
      : null;
    const isStaleActive = isActiveWeek && activeWeekTtlMs != null && Number.isFinite(activeWeekTtlMs)
      && ageMs > activeWeekTtlMs;

    if (hasCache && !mayForceNetwork) {
      const emptyForced = isForcedWeek && (!cached.data || cached.data.length === 0);
      if (emptyForced && ageMs > 300_000) {
        // fall through to network
      } else {
        if (!PAUSE_SCRAPES && isStaleActive && staleWhileRevalidate) {
          (async () => {
            try { await fetchAndCacheWeek(apiUrl, cacheKey); } catch (_) {}
          })();
        }
        if (!PAUSE_SCRAPES && isStaleActive && !staleWhileRevalidate) {
          try {
            const fresh = await fetchAndCacheWeek(apiUrl, cacheKey);
            if (Array.isArray(fresh)) return stripMatchupId(fresh);
          } catch (_) {}
        }
        return stripMatchupId(cached.data);
      }
    }

    const shouldNetwork = mayForceNetwork
      || !hasCache && canSeedMissing
      || (isStaleActive && !staleWhileRevalidate);
    if (!shouldNetwork) {
      return hasCache ? stripMatchupId(cached.data) : null;
    }
    try {
      const fresh = await fetchAndCacheWeek(apiUrl, cacheKey);
      if (Array.isArray(fresh)) return stripMatchupId(fresh);
    } catch (_) {}
    return hasCache ? stripMatchupId(cached.data) : null;
  };

  return Promise.all(
    Array.from({ length: 17 }, (_, i) => fetchWeekData(season || currentYear, i + 1))
  );
}
