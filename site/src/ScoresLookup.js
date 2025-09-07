import { LEAGUE_ID, PREVIOUS_YEARS } from './global_constants';
import { writeApiCache, readApiCacheFresh } from './database';

export async function fetchScoresData(season) {
  // Determine leagueId based on season
  const currentYear = new Date().getFullYear().toString();
  const isCurrentSeason = season === undefined || season === null || season === '' || season === currentYear;
  const leagueId = isCurrentSeason ? LEAGUE_ID : PREVIOUS_YEARS[season];

  let weeksParsedData = null;

  const fetchWeekData = async (season, weekNum) => {
    // Try to fetch from local file first
    const localUrl = `/data/${season}/week${weekNum}.txt`;
    try {
      const resp = await fetch(localUrl);
      if (resp.ok) {
        const text = await resp.text();
        const weekArr = JSON.parse(text);
        return weekArr.map(({ matchup_id, ...rest }) => rest);
      }
    } catch (e) {
      // Ignore and try API
    }
    // If not found locally and current season, fetch from Sleeper API
    if (isCurrentSeason) {
      try {
        const apiUrl = `https://api.sleeper.app/v1/league/${leagueId}/matchups/${weekNum}`;
        try {
          const cached = await readApiCacheFresh(apiUrl, 60_000);
          if (cached && Array.isArray(cached.data)) {
            const weekArr = cached.data;
            return weekArr.map(({ matchup_id, ...rest }) => rest);
          }
        } catch (_) {}
        const resp = await fetch(apiUrl);
        if (resp.ok) {
          const weekArr = await resp.json();
          try { await writeApiCache(apiUrl, weekArr); } catch (_) {}
          return weekArr.map(({ matchup_id, ...rest }) => rest);
        }
      } catch (e) {
        // Ignore, return null
      }
    }
    return null;
  };

  if (!isCurrentSeason && PREVIOUS_YEARS[season]) {
    // Previous season: always load from local files
    const weekFiles = Array.from({ length: 17 }, (_, i) => `/data/${season}/week${i + 1}.txt`);
    weeksParsedData = await Promise.all(
      weekFiles.map(async (url, idx) => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('Not found');
          const text = await resp.text();
          const weekArr = JSON.parse(text);
          return weekArr.map(({ matchup_id, ...rest }) => rest);
        } catch (e) {
          return null;
        }
      })
    );
  } else {
    // Current season: try local, then API
    weeksParsedData = await Promise.all(
      Array.from({ length: 17 }, (_, i) => fetchWeekData(season || currentYear, i + 1))
    );
  }

  return weeksParsedData;
} 