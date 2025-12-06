import { USE_FAKE_EXAMPLE_DATA, FAKE_SCOREBOARD_PATH, PAUSE_SCRAPES } from '../utils/global_constants';
import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';
import { writeApiCacheWithKey, readApiCacheLatestByKey } from '../utils/database';

async function fetchJson(url, cacheKeyOverride = null) {
  // Helper to perform network fetch and write to cache with stable cache key
  if (PAUSE_SCRAPES) {
    throw new Error('Scrapes paused');
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  const json = await res.json();
  try { await writeApiCacheWithKey(cacheKeyOverride, url, json); } catch (_) {}
  return json;
}

// Removed per-day and manifest-based lookups; rely solely on weekly API + DB cache

// enumerateDatesInclusive removed (no longer needed)

// mergeScoreboardsByEvents removed (no longer needed)

// fetchWeekByDates removed (no longer needed)

export async function fetchNflScoreboard(season, week) {
  if (!season || !week) {
    throw new Error('fetchNflScoreboard requires season and week');
  }

  if (USE_FAKE_EXAMPLE_DATA) {
    const res = await fetch(FAKE_SCOREBOARD_PATH);
    if (!res.ok) {
      throw new Error(`Failed to fetch fake scoreboard data at ${FAKE_SCOREBOARD_PATH}: ${res.status}`);
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('Fake scoreboard file is not valid JSON. Ensure it contains a JSON blob.');
    }
  }

  // Special-case 2024: Always read from local .txt files
  if (String(season) === '2024') {
    // Recreate the 2024 local flow: manifest -> per-day files
    const manifestUrl = `/data/${season}/schedule_manifest.txt`;
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch schedule manifest for ${season}: ${res.status}`);
    }
    const text = await res.text();
    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch (e) {
      throw new Error('schedule_manifest.txt is not valid JSON');
    }
    const leagues = Array.isArray(manifest && manifest.leagues) ? manifest.leagues : [];
    const league = leagues.length ? leagues[0] : null;
    const calendar = league && Array.isArray(league.calendar) ? league.calendar : [];
    const reg = calendar.find(c => String(c.value) === '2' || /regular/i.test(c && c.label));
    if (!reg) { throw new Error('Regular Season calendar not found in manifest'); }
    const entries = Array.isArray(reg.entries) ? reg.entries : [];
    const entry = entries.find(e => String(e.value) === String(week));
    if (!entry || !entry.startDate || !entry.endDate) {
      throw new Error(`Week ${week} not found in Regular Season entries`);
    }
    const startIso = entry.startDate;
    const endIso = entry.endDate;
    const dayTokens = (function enumerateDatesInclusive(startIso, endIso) {
      const start = new Date(startIso);
      const end = new Date(endIso);
      const days = [];
      for (let d = new Date(start); d <= end && days.length < 7; d.setUTCDate(d.getUTCDate() + 1)) {
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        days.push(`${yyyy}${mm}${dd}`);
      }
      return days;
    })(startIso, endIso);
    const blobs = await Promise.all(dayTokens.map(async (tok) => {
      const localUrl = `/data/${season}/${tok}.txt`;
      const r = await fetch(localUrl);
      if (!r.ok) { return { events: [] }; }
      const t = await r.text();
      try { return JSON.parse(t); } catch (_) { return { events: [] }; }
    }));
    const merged = (function mergeScoreboardsByEvents(blobs) {
      const merged = { events: [] };
      const seen = new Set();
      for (const b of blobs) {
        if (!b || !Array.isArray(b.events)) { continue; }
        for (const ev of b.events) {
          const id = ev && (ev.id || ev.uid);
          if (id && !seen.has(id)) {
            seen.add(id);
            merged.events.push(ev);
          }
        }
        if (!merged.leagues && b.leagues) { merged.leagues = b.leagues; }
        if (!merged.season && b.season) { merged.season = b.season; }
      }
      return merged;
    })(blobs);
    return merged;
  }

  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${encodeURIComponent(week)}&year=${encodeURIComponent(season)}&seasontype=2`;
  const cacheKey = `espn_site_v2_sports_football_nfl_scoreboard_week_${week}_year_${season}_seasontype_2`;
  const isCurrentSeason = String(season) === String(CURRENT_YEAR);
  const currentWeek = getCurrentNFLWeek();
  const isActiveWeek = isCurrentSeason && (Number(week) === currentWeek);
  const isPastSeason = !isCurrentSeason;
  const isFutureWeek = isCurrentSeason && (Number(week) > currentWeek);
  // DB first
  try {
    const cached = await readApiCacheLatestByKey(cacheKey);
    if (cached && cached.data !== undefined) {
      // For future weeks, enforce a 1-hour TTL (temporary)
      if (!PAUSE_SCRAPES && isFutureWeek) {
        const ageMs = Date.now() - (cached.ts || 0);
        if (ageMs > 60 * 60 * 1000) {
          try {
            const refreshed = await fetchJson(url, cacheKey);
            return refreshed;
          } catch (_) {
            return cached.data;
          }
        }
      }
      // For active current week, enforce 60s TTL
      if (!PAUSE_SCRAPES && isActiveWeek) {
        const ageMs = Date.now() - (cached.ts || 0);
        if (ageMs > 60 * 1000) {
          try {
            const refreshed = await fetchJson(url, cacheKey);
            return refreshed;
          } catch (_) {
            return cached.data;
          }
        }
      }
      return cached.data;
    }
  } catch (_) {}
  // Only fetch if missing and this is the active week OR a past season (seed once)
  if (!isActiveWeek && !isPastSeason && !isFutureWeek) { return null; }
  if (PAUSE_SCRAPES) { return null; }
  return await fetchJson(url, cacheKey);
} 