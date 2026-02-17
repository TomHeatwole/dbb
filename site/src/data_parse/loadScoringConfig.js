/**
 * Load scoring configuration from JSON file
 * 
 * This module loads the league's scoring configuration from score_format.json
 * and converts it into a format compatible with the fantasy calculator.
 */

/**
 * Load scoring configuration from JSON file
 * @param {string} configPath - Path to the score_format.json file
 * @returns {Promise<Object>} Scoring configuration object
 */
export async function loadScoringConfig(configPath = '/data/score_format.json') {
  try {
    const response = await fetch(configPath);
    if (!response.ok) {
      throw new Error(`Failed to load scoring config from ${configPath}: ${response.statusText}`);
    }
    
    const config = await response.json();
    
    // Validate the config has required fields
    if (!config.scoring) {
      throw new Error('Scoring configuration missing "scoring" field');
    }
    
    return config;
  } catch (error) {
    throw error;
  }
}

/**
 * Get the default scoring config for the site
 * This loads from score_format.json instead of using hardcoded configs
 * @returns {Promise<Object>} The site's scoring configuration
 */
export async function getDefaultScoringConfig() {
  return await loadScoringConfig();
}

/**
 * Validate scoring configuration
 * @param {Object} config - Scoring config to validate
 * @returns {boolean} True if valid
 * @throws {Error} If invalid
 */
export function validateScoringConfig(config) {
  if (!config) {
    throw new Error('Config is null or undefined');
  }
  
  if (!config.scoring || typeof config.scoring !== 'object') {
    throw new Error('Config must have a "scoring" object');
  }
  
  if (config.bonuses && typeof config.bonuses !== 'object') {
    throw new Error('Config "bonuses" must be an object if present');
  }
  
  if (config.position_specific_scoring && typeof config.position_specific_scoring !== 'object') {
    throw new Error('Config "position_specific_scoring" must be an object if present');
  }
  
  // Validate that scoring values are numbers
  for (const [key, value] of Object.entries(config.scoring)) {
    if (typeof value !== 'number') {
      throw new Error(`Scoring value for "${key}" must be a number, got ${typeof value}`);
    }
  }
  
  // Validate that bonus values are numbers
  if (config.bonuses) {
    for (const [key, value] of Object.entries(config.bonuses)) {
      if (typeof value !== 'number') {
        throw new Error(`Bonus value for "${key}" must be a number, got ${typeof value}`);
      }
    }
  }
  
  // Validate position-specific scoring structure
  if (config.position_specific_scoring) {
    for (const [statKey, positionMap] of Object.entries(config.position_specific_scoring)) {
      if (typeof positionMap !== 'object') {
        throw new Error(`Position-specific scoring for "${statKey}" must be an object`);
      }
      
      for (const [position, value] of Object.entries(positionMap)) {
        if (typeof value !== 'number') {
          throw new Error(`Position-specific value for "${statKey}.${position}" must be a number, got ${typeof value}`);
        }
      }
    }
  }
  
  return true;
}
