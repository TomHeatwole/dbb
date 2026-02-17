// TrendingLookup.js
// Utility to fetch trending player data from Sleeper API

const SLEEPER_TRENDING_URL = 'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=100';

let cachedTrendingData = null;
let cacheTimestamp = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour cache

export async function fetchTrendingPlayers() {
  const now = Date.now();
  
  // Return cached data if it's still fresh
  if (cachedTrendingData && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedTrendingData;
  }

  try {
    const response = await fetch(SLEEPER_TRENDING_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch trending players: ${response.status}`);
    }
    
    const data = await response.json();
    cachedTrendingData = data;
    cacheTimestamp = now;
    
    return data;
  } catch (_) {
    // Return cached data even if stale, or empty array if no cache
    return cachedTrendingData || [];
  }
}
