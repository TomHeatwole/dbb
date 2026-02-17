/**
 * Fantasy scoring configuration schemas
 * 
 * Each config maps CSV column names to point values (points per unit of that stat)
 */

export const SCORING_CONFIGS = {
  standard: {
    name: 'Standard Scoring',
    scoring: {
      // Passing
      passing_yards: 0.04,           // 1 point per 25 yards
      passing_tds: 4,                // 4 points per TD
      passing_interceptions: -2,     // -2 per INT
      passing_2pt_conversions: 2,    // 2 points per 2PT conversion
      
      // Rushing
      rushing_yards: 0.1,            // 1 point per 10 yards
      rushing_tds: 6,                // 6 points per TD
      rushing_fumbles_lost: -2,      // -2 per fumble lost
      rushing_2pt_conversions: 2,    // 2 points per 2PT conversion
      
      // Receiving
      receiving_yards: 0.1,          // 1 point per 10 yards
      receiving_tds: 6,              // 6 points per TD
      receptions: 0,                 // 0 in standard (not PPR)
      receiving_fumbles_lost: -2,    // -2 per fumble lost
      receiving_2pt_conversions: 2,  // 2 points per 2PT conversion
      
      // Fumbles
      sack_fumbles_lost: -2,         // -2 per fumble lost on sack
    },
    bonuses: {
      passing_300_bonus: 0,
      passing_400_bonus: 0,
      rushing_100_bonus: 0,
      receiving_100_bonus: 0,
    }
  },

  ppr: {
    name: 'PPR (Point Per Reception)',
    scoring: {
      // Passing
      passing_yards: 0.04,
      passing_tds: 4,
      passing_interceptions: -2,
      passing_2pt_conversions: 2,
      
      // Rushing
      rushing_yards: 0.1,
      rushing_tds: 6,
      rushing_fumbles_lost: -2,
      rushing_2pt_conversions: 2,
      
      // Receiving
      receiving_yards: 0.1,
      receiving_tds: 6,
      receptions: 1,                 // 1 point per reception
      receiving_fumbles_lost: -2,
      receiving_2pt_conversions: 2,
      
      // Fumbles
      sack_fumbles_lost: -2,
    },
    bonuses: {
      passing_300_bonus: 0,
      passing_400_bonus: 0,
      rushing_100_bonus: 0,
      receiving_100_bonus: 0,
    }
  },

  halfPPR: {
    name: 'Half PPR',
    scoring: {
      passing_yards: 0.04,
      passing_tds: 4,
      passing_interceptions: -2,
      passing_2pt_conversions: 2,
      rushing_yards: 0.1,
      rushing_tds: 6,
      rushing_fumbles_lost: -2,
      rushing_2pt_conversions: 2,
      receiving_yards: 0.1,
      receiving_tds: 6,
      receptions: 0.5,               // 0.5 points per reception
      receiving_fumbles_lost: -2,
      receiving_2pt_conversions: 2,
      sack_fumbles_lost: -2,
    },
    bonuses: {
      passing_300_bonus: 0,
      passing_400_bonus: 0,
      rushing_100_bonus: 0,
      receiving_100_bonus: 0,
    }
  },

  sixPointPassingTD: {
    name: '6pt Passing TD',
    scoring: {
      passing_yards: 0.04,
      passing_tds: 6,                // 6 points per passing TD
      passing_interceptions: -2,
      passing_2pt_conversions: 2,
      rushing_yards: 0.1,
      rushing_tds: 6,
      rushing_fumbles_lost: -2,
      rushing_2pt_conversions: 2,
      receiving_yards: 0.1,
      receiving_tds: 6,
      receptions: 1,
      receiving_fumbles_lost: -2,
      receiving_2pt_conversions: 2,
      sack_fumbles_lost: -2,
    },
    bonuses: {
      passing_300_bonus: 3,
      passing_400_bonus: 3,
      rushing_100_bonus: 3,
      receiving_100_bonus: 3,
    }
  },

  kicker: {
    name: 'Kicker Scoring',
    scoring: {
      fg_made: 3,                    // 3 points per FG made
      fg_missed: -1,                 // -1 per miss
      fg_made_50_59: 2,              // +2 bonus for 50-59 yard FG
      fg_made_60_: 3,                // +3 bonus for 60+ yard FG
      pat_made: 1,                   // 1 point per PAT
      pat_missed: -1,                // -1 per missed PAT
    },
    bonuses: {}
  },

  defense: {
    name: 'Defense/Special Teams',
    scoring: {
      def_sacks: 1,
      def_interceptions: 2,
      def_fumbles: 2,                // Fumble recoveries
      def_tds: 6,
      def_safeties: 2,
      special_teams_tds: 6,
    },
    bonuses: {}
  },

  idp: {
    name: 'Individual Defensive Player',
    scoring: {
      def_tackles_solo: 1,
      def_tackles_with_assist: 0.5,
      def_tackle_assists: 0.5,
      def_tackles_for_loss: 2,
      def_sacks: 4,
      def_interceptions: 5,
      def_interception_yards: 0.1,
      def_pass_defended: 1,
      def_fumbles_forced: 3,
      def_fumbles: 3,                // Fumble recoveries
      fumble_recovery_opp: 3,        // Opponent fumble recovery
      fumble_recovery_tds: 6,
      def_tds: 6,
      def_safeties: 5,
    },
    bonuses: {}
  }
};

/**
 * Get a scoring config by name
 * @param {string} configName - Name of the config (e.g., 'ppr', 'standard')
 * @returns {Object} The scoring configuration
 */
export function getScoringConfig(configName) {
  const config = SCORING_CONFIGS[configName];
  if (!config) {
    throw new Error(`Unknown scoring config: ${configName}`);
  }
  return config;
}

/**
 * Create a custom scoring configuration
 * @param {string} name - Name of the custom config
 * @param {Object} scoring - Scoring rules object
 * @param {Object} bonuses - Bonus rules object
 * @returns {Object} A scoring configuration object
 */
export function createCustomConfig(name, scoring, bonuses = {}) {
  return {
    name,
    scoring,
    bonuses
  };
}
