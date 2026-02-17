/**
 * GSIS ID Lookup Service
 * Provides bidirectional mapping between Sleeper IDs and GSIS IDs
 * 
 * Uses a multi-layered approach:
 * 1. Direct GSIS ID from Sleeper data (when available)
 * 2. ESPN ID bridge: Sleeper ID → ESPN ID (via player_ids.txt) → GSIS ID (via players_gsis_mapping.csv)
 * 3. Name matching fallback (last resort)
 */

let cachedGsisMapping = null;
let cachedPlayerIdsMapping = null;

/**
 * Parse CSV line handling quoted fields
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

/**
 * Normalize player name to handle suffix variations
 */
function normalizeName(name) {
  if (!name) return '';
  
  let normalized = name.toLowerCase().trim();
  
  // Remove common suffixes
  const suffixes = [' jr.', ' jr', ' sr.', ' sr', ' ii', ' iii', ' iv', ' v'];
  for (const suffix of suffixes) {
    if (normalized.endsWith(suffix)) {
      normalized = normalized.substring(0, normalized.length - suffix.length).trim();
      break;
    }
  }
  
  return normalized;
}

/**
 * Load and cache the player_ids.txt mapping
 * Returns Sleeper ID → ESPN ID mapping
 */
export async function loadPlayerIdsMapping() {
  if (cachedPlayerIdsMapping) return cachedPlayerIdsMapping;
  
  try {
    const response = await fetch('/data/player_ids.txt');
    if (!response.ok) {
      throw new Error('Failed to load player_ids.txt');
    }
    
    const text = await response.text();
    const lines = text.trim().split('\n');
    
    if (lines.length < 2) {
      throw new Error('player_ids.txt is empty');
    }
    
    const sleeperToEspn = {};  // Sleeper ID -> ESPN ID
    
    // Parse CSV (columns: sleeper_id, sleeper_name, yahoo_id, yahoo_name, espn_id, ...)
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      
      const sleeperId = values[0]?.trim();
      const espnId = values[4]?.trim();
      
      if (sleeperId && espnId) {
        sleeperToEspn[sleeperId] = espnId;
      }
    }
    
    cachedPlayerIdsMapping = { sleeperToEspn };
    return cachedPlayerIdsMapping;
  } catch (error) {
    console.error('Error loading player_ids mapping:', error);
    throw error;
  }
}

/**
 * Load and cache the GSIS mapping CSV
 * Returns indexes for efficient lookups
 */
export async function loadGsisMappingCSV() {
  if (cachedGsisMapping) return cachedGsisMapping;
  
  try {
    const response = await fetch('/data/players_gsis_mapping.csv');
    if (!response.ok) {
      throw new Error('Failed to load GSIS mapping');
    }
    
    const text = await response.text();
    const lines = text.trim().split('\n');
    
    if (lines.length < 2) {
      throw new Error('GSIS mapping CSV is empty');
    }
    
    // Build multiple lookup indexes for efficiency
    const gsisToPlayer = {};      // GSIS ID -> full player object
    const espnToGsis = {};         // ESPN ID -> GSIS ID (NEW - the key bridge!)
    const nameToGsis = {};         // normalized name (with suffix) -> GSIS ID
    const nameVariations = {};     // normalized name (without suffix) -> GSIS ID
    
    // Parse all rows
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      
      if (values.length < 15) continue; // Skip malformed rows
      
      const gsisId = values[0]?.trim();
      const displayName = values[1]?.trim();
      const firstName = values[3]?.trim();
      const lastName = values[4]?.trim();
      const suffix = values[7]?.trim();
      const espnId = values[13]?.trim();  // ESPN ID is column 13
      const position = values[17]?.trim();
      const team = values[28]?.trim();
      
      if (!gsisId || !displayName) continue;
      
      const playerData = {
        gsisId,
        displayName,
        firstName,
        lastName,
        suffix,
        position,
        team
      };
      
      // Index by GSIS ID
      gsisToPlayer[gsisId] = playerData;
      
      // Index by ESPN ID (the bridge!)
      if (espnId) {
        espnToGsis[espnId] = gsisId;
      }
      
      // Index by normalized name (with suffix)
      const fullName = displayName.toLowerCase().trim();
      nameToGsis[fullName] = gsisId;
      
      // Also index without suffix for fuzzy matching
      const normalizedName = normalizeName(displayName);
      if (normalizedName !== fullName && normalizedName) {
        nameVariations[normalizedName] = gsisId;
      }
    }
    
    cachedGsisMapping = {
      gsisToPlayer,
      espnToGsis,
      nameToGsis,
      nameVariations
    };
    
    return cachedGsisMapping;
  } catch (error) {
    console.error('Error loading GSIS mapping:', error);
    throw error;
  }
}

/**
 * Get GSIS ID from Sleeper player data
 * Uses multi-layered approach with ESPN ID bridge for best accuracy
 * 
 * @param {Object} sleeperPlayer - Player object from Sleeper API (players.txt)
 * @returns {Promise<string|null>} GSIS ID or null if not found
 */
export async function getGsisIdFromSleeperPlayer(sleeperPlayer) {
  if (!sleeperPlayer) return null;
  
  // Layer 1: Try direct GSIS ID first (if available in Sleeper data - ~34% coverage)
  if (sleeperPlayer.gsis_id) {
    return sleeperPlayer.gsis_id.trim();
  }
  
  // Layer 2: Use ESPN ID bridge through player_ids.txt (best accuracy!)
  const sleeperId = sleeperPlayer.player_id;
  if (sleeperId) {
    const playerIdsMap = await loadPlayerIdsMapping();
    const espnId = playerIdsMap.sleeperToEspn[sleeperId];
    
    if (espnId) {
      const gsisMapping = await loadGsisMappingCSV();
      const gsisId = gsisMapping.espnToGsis[espnId];
      
      if (gsisId) {
        return gsisId;
      }
    }
  }
  
  // Layer 3: Fall back to name matching (last resort)
  const mapping = await loadGsisMappingCSV();
  const fullName = sleeperPlayer.full_name?.toLowerCase().trim();
  
  if (!fullName) return null;
  
  // Try exact match first
  if (mapping.nameToGsis[fullName]) {
    return mapping.nameToGsis[fullName];
  }
  
  // Try normalized match (without suffix)
  const normalized = normalizeName(fullName);
  if (mapping.nameVariations[normalized]) {
    return mapping.nameVariations[normalized];
  }
  
  return null;
}

/**
 * Get player data by GSIS ID
 * 
 * @param {string} gsisId - GSIS ID (e.g., "00-0039075")
 * @returns {Promise<Object|null>} Player data or null if not found
 */
export async function getPlayerByGsisId(gsisId) {
  if (!gsisId) return null;
  
  const mapping = await loadGsisMappingCSV();
  return mapping.gsisToPlayer[gsisId] || null;
}

/**
 * Batch convert Sleeper player IDs to GSIS IDs
 * Useful for roster conversions
 * 
 * @param {Array<string>} sleeperPlayerIds - Array of Sleeper player IDs
 * @param {Object} sleeperPlayersData - Player data object from Sleeper (players.txt)
 * @returns {Promise<Object>} Map of Sleeper ID -> GSIS ID
 */
export async function batchConvertSleeperToGsis(sleeperPlayerIds, sleeperPlayersData) {
  const mapping = {};
  
  for (const sleeperId of sleeperPlayerIds) {
    const sleeperPlayer = sleeperPlayersData[sleeperId];
    if (sleeperPlayer) {
      const gsisId = await getGsisIdFromSleeperPlayer(sleeperPlayer);
      if (gsisId) {
        mapping[sleeperId] = gsisId;
      }
    }
  }
  
  return mapping;
}

/**
 * Batch convert GSIS IDs to Sleeper player IDs
 * Reverse lookup - useful when you have GSIS IDs and need Sleeper IDs
 * 
 * @param {Array<string>} gsisIds - Array of GSIS IDs
 * @param {Object} sleeperPlayersData - Player data object from Sleeper
 * @returns {Promise<Object>} Map of GSIS ID -> Sleeper ID
 */
export async function batchConvertGsisToSleeper(gsisIds, sleeperPlayersData) {
  const mapping = {};
  const gsisSet = new Set(gsisIds);
  
  // Build reverse mapping from GSIS to Sleeper ID
  for (const sleeperId in sleeperPlayersData) {
    const player = sleeperPlayersData[sleeperId];
    const gsisId = await getGsisIdFromSleeperPlayer(player);
    
    if (gsisId && gsisSet.has(gsisId)) {
      mapping[gsisId] = sleeperId;
    }
  }
  
  return mapping;
}

/**
 * Get lookup stats for debugging/monitoring
 * Shows how effective each lookup method is
 * 
 * @param {Object} sleeperPlayersData - Player data object from Sleeper
 * @returns {Promise<Object>} Stats about lookup methods
 */
export async function getLookupStats(sleeperPlayersData) {
  const stats = {
    total: 0,
    directGsis: 0,
    espnBridge: 0,
    nameMatch: 0,
    notFound: 0
  };
  
  const playerIdsMap = await loadPlayerIdsMapping();
  const gsisMapping = await loadGsisMappingCSV();
  
  for (const sleeperId in sleeperPlayersData) {
    const player = sleeperPlayersData[sleeperId];
    stats.total++;
    
    // Check which method would work
    if (player.gsis_id) {
      stats.directGsis++;
    } else if (playerIdsMap.sleeperToEspn[sleeperId] && gsisMapping.espnToGsis[playerIdsMap.sleeperToEspn[sleeperId]]) {
      stats.espnBridge++;
    } else {
      const fullName = player.full_name?.toLowerCase().trim();
      if (fullName && (gsisMapping.nameToGsis[fullName] || gsisMapping.nameVariations[normalizeName(fullName)])) {
        stats.nameMatch++;
      } else {
        stats.notFound++;
      }
    }
  }
  
  return stats;
}
