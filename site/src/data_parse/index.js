/**
 * Fantasy Points Data Parser
 * 
 * Main entry point for the fantasy scoring system
 */

import { SCORING_CONFIGS, getScoringConfig, createCustomConfig } from './scoringConfig.js';
import {
  calculateFantasyPoints,
  calculateFantasyPointsPerGame,
  calculateFantasyPointsForMultiplePlayers,
  getFantasyPointsBreakdown
} from './fantasyCalculator.js';
import {
  loadPlayerStatsFromCSV,
  loadPlayersData,
  loadSeasonStats,
  getPlayerStatsByGsisId,
  getPlayerStatsByPlayerId,
  getMultiplePlayerStats
} from './playerStatsLoader.js';

/**
 * Main class for fantasy scoring operations
 */
export class FantasyScoring {
  constructor(basePath = '/data/') {
    this.basePath = basePath;
    this.statsCache = {}; // Cache loaded stats by season
    this.playersData = null;
  }

  /**
   * Initialize by loading players data
   */
  async init() {
    if (!this.playersData) {
      this.playersData = await loadPlayersData(`${this.basePath}players.txt`);
    }
  }

  /**
   * Load stats for a specific season (with caching)
   * @param {number} season - Season year
   * @returns {Promise<Array>} Player stats array
   */
  async loadSeasonStats(season) {
    if (!this.statsCache[season]) {
      this.statsCache[season] = await loadSeasonStats(season, this.basePath);
    }
    return this.statsCache[season];
  }

  /**
   * Calculate fantasy points for a player by their player ID
   * @param {string} playerId - Player ID from players.txt
   * @param {number} season - Season year
   * @param {string|Object} config - Scoring config name or custom config object
   * @returns {Promise<Object>} Fantasy points result
   */
  async calculateForPlayer(playerId, season, config = 'ppr') {
    await this.init();
    const stats = await this.loadSeasonStats(season);
    
    const playerStats = getPlayerStatsByPlayerId(stats, this.playersData, playerId);
    if (!playerStats) {
      return {
        success: false,
        error: 'Player stats not found',
        playerId
      };
    }

    const scoringConfig = typeof config === 'string' 
      ? getScoringConfig(config) 
      : config;

    return {
      success: true,
      playerId,
      player_name: playerStats.player_display_name || playerStats.player_name,
      position: playerStats.position,
      team: playerStats.recent_team,
      season,
      games: parseInt(playerStats.games || 0),
      fantasy_points: calculateFantasyPoints(playerStats, scoringConfig),
      fantasy_points_per_game: calculateFantasyPointsPerGame(playerStats, scoringConfig),
      breakdown: getFantasyPointsBreakdown(playerStats, scoringConfig),
      config_name: scoringConfig.name
    };
  }

  /**
   * Calculate fantasy points for a player by their GSIS ID
   * @param {string} gsisId - GSIS ID (e.g., "00-0023459")
   * @param {number} season - Season year
   * @param {string|Object} config - Scoring config name or custom config object
   * @returns {Promise<Object>} Fantasy points result
   */
  async calculateForGsisId(gsisId, season, config = 'ppr') {
    const stats = await this.loadSeasonStats(season);
    const playerStats = getPlayerStatsByGsisId(stats, gsisId);
    
    if (!playerStats) {
      return {
        success: false,
        error: 'Player stats not found',
        gsisId
      };
    }

    const scoringConfig = typeof config === 'string' 
      ? getScoringConfig(config) 
      : config;

    return {
      success: true,
      gsisId,
      player_name: playerStats.player_display_name || playerStats.player_name,
      position: playerStats.position,
      team: playerStats.recent_team,
      season,
      games: parseInt(playerStats.games || 0),
      fantasy_points: calculateFantasyPoints(playerStats, scoringConfig),
      fantasy_points_per_game: calculateFantasyPointsPerGame(playerStats, scoringConfig),
      breakdown: getFantasyPointsBreakdown(playerStats, scoringConfig),
      config_name: scoringConfig.name
    };
  }

  /**
   * Get top players by fantasy points for a season
   * @param {number} season - Season year
   * @param {string|Object} config - Scoring config name or custom config object
   * @param {Object} options - Options (limit, position filter)
   * @returns {Promise<Array>} Sorted array of players with fantasy points
   */
  async getTopPlayers(season, config = 'ppr', options = {}) {
    const stats = await this.loadSeasonStats(season);
    const scoringConfig = typeof config === 'string' 
      ? getScoringConfig(config) 
      : config;

    let players = calculateFantasyPointsForMultiplePlayers(stats, scoringConfig);

    // Filter by position if specified
    if (options.position) {
      players = players.filter(p => p.position === options.position);
    }

    // Sort by fantasy points (descending)
    players.sort((a, b) => b.fantasy_points - a.fantasy_points);

    // Limit results if specified
    if (options.limit) {
      players = players.slice(0, options.limit);
    }

    return players;
  }
}

// Export everything for direct use
export {
  SCORING_CONFIGS,
  getScoringConfig,
  createCustomConfig,
  calculateFantasyPoints,
  calculateFantasyPointsPerGame,
  calculateFantasyPointsForMultiplePlayers,
  getFantasyPointsBreakdown,
  loadPlayerStatsFromCSV,
  loadPlayersData,
  loadSeasonStats,
  getPlayerStatsByGsisId,
  getPlayerStatsByPlayerId,
  getMultiplePlayerStats
};
