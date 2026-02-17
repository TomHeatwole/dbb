/**
 * Player Stats Loader
 * 
 * Loads and parses player statistics from CSV files and player data from JSON
 */

/**
 * Parse CSV text into an array of objects
 * @param {string} csvText - Raw CSV text
 * @returns {Array} Array of objects, one per row
 */
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',');
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index];
      });
      rows.push(row);
    }
  }

  return rows;
}

/**
 * Parse a single CSV line, handling quoted values
 * @param {string} line - A single CSV line
 * @returns {Array} Array of values
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

/**
 * Load player statistics from CSV file
 * @param {string} filePath - Path to the CSV file
 * @returns {Promise<Array>} Array of player stat objects
 */
export async function loadPlayerStatsFromCSV(filePath) {
  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to load stats from ${filePath}: ${response.statusText}`);
    }
    const text = await response.text();
    return parseCSV(text);
  } catch (error) {
    console.error('Error loading player stats:', error);
    throw error;
  }
}

/**
 * Load player data from JSON file
 * @param {string} filePath - Path to the players.txt JSON file
 * @returns {Promise<Object>} Player data object
 */
export async function loadPlayersData(filePath) {
  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to load players from ${filePath}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading players data:', error);
    throw error;
  }
}

/**
 * Get player stats by GSIS ID
 * @param {Array} statsArray - Array of player stats from CSV
 * @param {string} gsisId - GSIS ID (e.g., "00-0023459")
 * @returns {Object|null} Player stats object or null if not found
 */
export function getPlayerStatsByGsisId(statsArray, gsisId) {
  const cleanGsisId = gsisId.trim();
  return statsArray.find(stats => stats.player_id === cleanGsisId) || null;
}

/**
 * Get player stats by player ID (from players.txt)
 * @param {Array} statsArray - Array of player stats from CSV
 * @param {Object} playersData - Players data object from players.txt
 * @param {string} playerId - Player ID from players.txt
 * @returns {Promise<Object|null>} Player stats object or null if not found
 */
export async function getPlayerStatsByPlayerId(statsArray, playersData, playerId) {
  const player = playersData[playerId];
  if (!player) {
    return null;
  }

  // Import the GSIS lookup service
  const { getGsisIdFromSleeperPlayer } = await import('../lookups/GsisLookup');
  
  // Get GSIS ID using the centralized service (with fallback to name matching)
  const gsisId = await getGsisIdFromSleeperPlayer(player);
  if (!gsisId) {
    return null;
  }

  return getPlayerStatsByGsisId(statsArray, gsisId);
}

/**
 * Load stats for a specific season
 * @param {number} season - Season year (e.g., 2024, 2025)
 * @param {string} basePath - Base path to data files (default: '/data/')
 * @returns {Promise<Array>} Array of player stat objects
 */
export async function loadSeasonStats(season, basePath = '/data/') {
  const csvPath = `${basePath}stats_player_reg_${season}.csv`;
  return await loadPlayerStatsFromCSV(csvPath);
}

/**
 * Get stats for multiple players
 * @param {Array} statsArray - Array of player stats from CSV
 * @param {Array<string>} gsisIds - Array of GSIS IDs
 * @returns {Array} Array of player stats objects (only found players)
 */
export function getMultiplePlayerStats(statsArray, gsisIds) {
  return gsisIds
    .map(gsisId => getPlayerStatsByGsisId(statsArray, gsisId))
    .filter(stats => stats !== null);
}
