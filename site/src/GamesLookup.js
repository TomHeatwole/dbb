import { USE_FAKE_EXAMPLE_DATA, FAKE_SCOREBOARD_PATH } from './global_constants';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.json();
}

async function fetchDailyFromCacheOrApi(season, dayToken) {
  const localUrl = `/data/${season}/${dayToken}.txt`;
  try {
    const r = await fetch(localUrl);
    if (r.ok) {
      const t = await r.text();
      try {
        const j = JSON.parse(t);
        return j;
      } catch (_) {
        // fall through to API
      }
    }
  } catch (_) {
    // ignore and fall back to API
  }
  const apiUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dayToken}`;
  return await fetchJson(apiUrl);
}

function enumerateDatesInclusive(startIso, endIso) {
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
}

function mergeScoreboardsByEvents(blobs) {
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
    if (!merged.leagues && b.leagues) {
      merged.leagues = b.leagues;
    }
    if (!merged.season && b.season) {
      merged.season = b.season;
    }
  }
  return merged;
}

async function fetchWeekByDates(season, week) {
  // Parse manifest JSON at /data/{season}/schedule_manifest.txt
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
  // Find Regular Season (value === '2')
  const reg = calendar.find(c => String(c.value) === '2' || /regular/i.test(c && c.label));
  if (!reg) { throw new Error('Regular Season calendar not found in manifest'); }
  const entries = Array.isArray(reg.entries) ? reg.entries : [];
  const entry = entries.find(e => String(e.value) === String(week));
  if (!entry || !entry.startDate || !entry.endDate) {
    throw new Error(`Week ${week} not found in Regular Season entries`);
  }
  const startIso = entry.startDate; // e.g. 2024-12-25T08:00Z
  const endIso = entry.endDate;     // e.g. 2025-01-01T07:59Z

  const dayTokens = enumerateDatesInclusive(startIso, endIso);
  const blobs = await Promise.all(dayTokens.map(tok => fetchDailyFromCacheOrApi(season, tok)));
  const merged = mergeScoreboardsByEvents(blobs);
  return merged;
}

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

  const currentYear = new Date().getFullYear();
  if (Number(season) < currentYear) {
    // Previous season: use per-day lookups per schedule manifest with local cache
    return await fetchWeekByDates(season, week);
  }

  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${encodeURIComponent(week)}&year=${encodeURIComponent(season)}&seasontype=2`;
  return await fetchJson(url);
} 