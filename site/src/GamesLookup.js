import { USE_FAKE_EXAMPLE_DATA, FAKE_SCOREBOARD_PATH } from './global_constants';

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

  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${encodeURIComponent(week)}&year=${encodeURIComponent(season)}&seasontype=2`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch NFL scoreboard: ${res.status}`);
  }
  return await res.json();
} 