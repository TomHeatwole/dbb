/**
 * Fantasy Points Calculator
 * 
 * Calculates fantasy points for a player based on their stats and a scoring configuration
 */

/**
 * Calculate fantasy points for a player based on their stats
 * @param {Object} playerStats - Player statistics object (a row from the CSV)
 * @param {Object} config - Scoring configuration object
 * @returns {number} Total fantasy points
 */
export function calculateFantasyPoints(playerStats, config) {
  if (!playerStats || !config) {
    return 0;
  }

  let points = 0;

  // Calculate base scoring
  if (config.scoring) {
    for (const [statKey, pointsPerUnit] of Object.entries(config.scoring)) {
      const statValue = parseFloat(playerStats[statKey] || 0);
      points += statValue * pointsPerUnit;
    }
  }

  // Add bonuses
  if (config.bonuses) {
    points += calculateBonuses(playerStats, config.bonuses);
  }

  return Math.round(points * 100) / 100; // Round to 2 decimal places
}

/**
 * Calculate bonus points based on milestone achievements
 * @param {Object} playerStats - Player statistics object
 * @param {Object} bonuses - Bonus configuration object
 * @returns {number} Total bonus points
 */
function calculateBonuses(playerStats, bonuses) {
  let bonusPoints = 0;

  // Passing yardage bonuses
  if (bonuses.passing_300_bonus && playerStats.passing_yards >= 300) {
    bonusPoints += bonuses.passing_300_bonus;
  }
  if (bonuses.passing_400_bonus && playerStats.passing_yards >= 400) {
    bonusPoints += bonuses.passing_400_bonus;
  }

  // Rushing yardage bonuses
  if (bonuses.rushing_100_bonus && playerStats.rushing_yards >= 100) {
    bonusPoints += bonuses.rushing_100_bonus;
  }

  // Receiving yardage bonuses
  if (bonuses.receiving_100_bonus && playerStats.receiving_yards >= 100) {
    bonusPoints += bonuses.receiving_100_bonus;
  }

  return bonusPoints;
}

/**
 * Calculate fantasy points per game average
 * @param {Object} playerStats - Player statistics object
 * @param {Object} config - Scoring configuration object
 * @returns {number} Average fantasy points per game
 */
export function calculateFantasyPointsPerGame(playerStats, config) {
  const totalPoints = calculateFantasyPoints(playerStats, config);
  const games = parseInt(playerStats.games || 1);
  
  if (games === 0) return 0;
  
  return Math.round((totalPoints / games) * 100) / 100;
}

/**
 * Calculate fantasy points for multiple players
 * @param {Array} playerStatsArray - Array of player statistics objects
 * @param {Object} config - Scoring configuration object
 * @returns {Array} Array of objects with player_id and fantasy_points
 */
export function calculateFantasyPointsForMultiplePlayers(playerStatsArray, config) {
  return playerStatsArray.map(stats => ({
    player_id: stats.player_id,
    player_name: stats.player_display_name || stats.player_name,
    position: stats.position,
    team: stats.recent_team,
    games: parseInt(stats.games || 0),
    fantasy_points: calculateFantasyPoints(stats, config),
    fantasy_points_per_game: calculateFantasyPointsPerGame(stats, config)
  }));
}

/**
 * Get breakdown of fantasy points by category
 * @param {Object} playerStats - Player statistics object
 * @param {Object} config - Scoring configuration object
 * @returns {Object} Breakdown of points by category
 */
export function getFantasyPointsBreakdown(playerStats, config) {
  const breakdown = {
    passing: 0,
    rushing: 0,
    receiving: 0,
    fumbles: 0,
    defense: 0,
    kicking: 0,
    bonuses: 0,
    total: 0
  };

  if (!config.scoring) return breakdown;

  // Categorize each stat
  for (const [statKey, pointsPerUnit] of Object.entries(config.scoring)) {
    const statValue = parseFloat(playerStats[statKey] || 0);
    const points = statValue * pointsPerUnit;

    if (statKey.startsWith('passing_')) {
      breakdown.passing += points;
    } else if (statKey.startsWith('rushing_')) {
      breakdown.rushing += points;
    } else if (statKey.startsWith('receiving_') || statKey === 'receptions') {
      breakdown.receiving += points;
    } else if (statKey.includes('fumble')) {
      breakdown.fumbles += points;
    } else if (statKey.startsWith('def_')) {
      breakdown.defense += points;
    } else if (statKey.startsWith('fg_') || statKey.startsWith('pat_')) {
      breakdown.kicking += points;
    }
  }

  // Add bonuses
  if (config.bonuses) {
    breakdown.bonuses = calculateBonuses(playerStats, config.bonuses);
  }

  // Calculate total
  breakdown.total = Object.values(breakdown).reduce((sum, val) => sum + val, 0);

  // Round all values
  for (const key in breakdown) {
    breakdown[key] = Math.round(breakdown[key] * 100) / 100;
  }

  return breakdown;
}
