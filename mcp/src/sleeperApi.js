import { CURRENT_YEAR, getLeagueIdForSeason } from './config.js';
import { getCurrentNFLWeek } from './helpers.js';

const BASE = 'https://api.sleeper.app/v1';

// Simple in-memory response cache keyed by URL
const cache = new Map();

async function cachedFetch(url, ttlMs = 300_000) {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.ts < ttlMs) return hit.data;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sleeper API ${res.status} for ${url}`);
  const data = await res.json();
  cache.set(url, { data, ts: now });
  return data;
}

export async function fetchRosters(season = CURRENT_YEAR) {
  const leagueId = getLeagueIdForSeason(season);
  if (!leagueId) throw new Error(`No league ID for season ${season}`);
  return cachedFetch(`${BASE}/league/${leagueId}/rosters`, 300_000);
}

export async function fetchUsers(season = CURRENT_YEAR) {
  const leagueId = getLeagueIdForSeason(season);
  if (!leagueId) throw new Error(`No league ID for season ${season}`);
  return cachedFetch(`${BASE}/league/${leagueId}/users`, 300_000);
}

export async function fetchMatchups(week, season = CURRENT_YEAR) {
  const leagueId = getLeagueIdForSeason(season);
  if (!leagueId) throw new Error(`No league ID for season ${season}`);
  // Active week: short TTL so scores stay fresh; past weeks: cache indefinitely
  const isActiveWeek = String(season) === String(CURRENT_YEAR) && Number(week) === getCurrentNFLWeek();
  const ttl = isActiveWeek ? 60_000 : 365 * 24 * 60 * 60 * 1000;
  return cachedFetch(`${BASE}/league/${leagueId}/matchups/${week}`, ttl);
}

export async function fetchTransactions(week, season = CURRENT_YEAR) {
  const leagueId = getLeagueIdForSeason(season);
  if (!leagueId) throw new Error(`No league ID for season ${season}`);
  return cachedFetch(`${BASE}/league/${leagueId}/transactions/${week}`, 300_000);
}

export async function fetchTradedPicks(season = CURRENT_YEAR) {
  const leagueId = getLeagueIdForSeason(season);
  if (!leagueId) throw new Error(`No league ID for season ${season}`);
  return cachedFetch(`${BASE}/league/${leagueId}/traded_picks`, 300_000);
}

export async function fetchTrendingPlayers() {
  return cachedFetch(
    `${BASE}/players/nfl/trending/add?lookback_hours=24&limit=25`,
    3_600_000 // 1 hour
  );
}

// Fetch all weeks up to completedWeeks, return array indexed by week (0-based)
export async function fetchAllWeekScores(completedWeeks, season = CURRENT_YEAR) {
  if (completedWeeks === 0) return [];
  const promises = Array.from({ length: completedWeeks }, (_, i) =>
    fetchMatchups(i + 1, season).catch(() => null)
  );
  return Promise.all(promises);
}
