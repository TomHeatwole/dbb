/**
 * Weekly Stats Loader
 * 
 * Fetches weekly player stats from Sleeper API with caching
 */

/**
 * Cache for weekly stats to avoid redundant API calls
 * Structure: { "2024-1": { playerId: stats, ... }, "2024-2": { ... }, ... }
 */
const weeklyStatsCache = {};

/**
 * Fetch weekly stats for all players in a given week
 * @param {string|number} season - Season year (e.g., 2024, 2025)
 * @param {number} week - Week number (1-17)
 * @returns {Promise<Object>} Object mapping player IDs to their stats
 */
export async function fetchWeeklyStats(season, week) {
  const cacheKey = `${season}-${week}`;
  
  // Return cached data if available
  if (weeklyStatsCache[cacheKey]) {
    return weeklyStatsCache[cacheKey];
  }

  try {
    const response = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`);
    
    if (!response.ok) {
      return {};
    }

    const stats = await response.json();
    
    // Cache the result
    weeklyStatsCache[cacheKey] = stats || {};
    
    return weeklyStatsCache[cacheKey];
  } catch (_) {
    return {};
  }
}

/**
 * Fetch weekly stats for multiple weeks with throttling
 * @param {string|number} season - Season year
 * @param {number[]} weeks - Array of week numbers
 * @param {number} delayMs - Delay between requests in milliseconds
 * @returns {Promise<Object>} Object with week numbers as keys and stats objects as values
 */
export async function fetchMultipleWeeksStats(season, weeks, delayMs = 100) {
  const results = {};
  
  for (const week of weeks) {
    results[week] = await fetchWeeklyStats(season, week);
    
    // Add delay between requests to avoid rate limiting
    if (delayMs > 0 && week !== weeks[weeks.length - 1]) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return results;
}

/**
 * Clear the stats cache (useful for testing)
 */
export function clearStatsCache() {
  Object.keys(weeklyStatsCache).forEach(key => {
    delete weeklyStatsCache[key];
  });
}

/**
 * Get cache statistics
 * @returns {Object} Cache info
 */
export function getCacheInfo() {
  const keys = Object.keys(weeklyStatsCache);
  return {
    size: keys.length,
    keys: keys,
    totalPlayers: keys.reduce((sum, key) => {
      return sum + Object.keys(weeklyStatsCache[key]).length;
    }, 0)
  };
}
