/**
 * Unit tests for Fantasy Calculator
 */

import {
  calculateFantasyPoints,
  calculateFantasyPointsPerGame,
  calculateFantasyPointsForMultiplePlayers,
  getFantasyPointsBreakdown
} from './fantasyCalculator.js';
import { SCORING_CONFIGS } from './scoringConfig.js';

describe('Fantasy Calculator', () => {
  describe('calculateFantasyPoints', () => {
    it('should calculate standard scoring for QB correctly', () => {
      const qbStats = {
        passing_yards: 300,
        passing_tds: 2,
        passing_interceptions: 1,
        rushing_yards: 20,
        rushing_tds: 0,
        games: 1
      };

      const points = calculateFantasyPoints(qbStats, SCORING_CONFIGS.standard);
      
      // 300 * 0.04 = 12 (passing yards)
      // 2 * 4 = 8 (passing TDs)
      // 1 * -2 = -2 (interceptions)
      // 20 * 0.1 = 2 (rushing yards)
      // Total = 20
      expect(points).toBe(20);
    });

    it('should calculate PPR scoring for WR correctly', () => {
      const wrStats = {
        receptions: 8,
        receiving_yards: 120,
        receiving_tds: 1,
        games: 1
      };

      const points = calculateFantasyPoints(wrStats, SCORING_CONFIGS.ppr);
      
      // 8 * 1 = 8 (receptions in PPR)
      // 120 * 0.1 = 12 (receiving yards)
      // 1 * 6 = 6 (receiving TD)
      // Total = 26
      expect(points).toBe(26);
    });

    it('should calculate standard scoring for WR correctly (no PPR)', () => {
      const wrStats = {
        receptions: 8,
        receiving_yards: 120,
        receiving_tds: 1,
        games: 1
      };

      const points = calculateFantasyPoints(wrStats, SCORING_CONFIGS.standard);
      
      // 8 * 0 = 0 (receptions in standard)
      // 120 * 0.1 = 12 (receiving yards)
      // 1 * 6 = 6 (receiving TD)
      // Total = 18
      expect(points).toBe(18);
    });

    it('should calculate half PPR scoring correctly', () => {
      const wrStats = {
        receptions: 10,
        receiving_yards: 100,
        receiving_tds: 0,
        games: 1
      };

      const points = calculateFantasyPoints(wrStats, SCORING_CONFIGS.halfPPR);
      
      // 10 * 0.5 = 5 (receptions in half PPR)
      // 100 * 0.1 = 10 (receiving yards)
      // Total = 15
      expect(points).toBe(15);
    });

    it('should handle fumbles correctly', () => {
      const rbStats = {
        rushing_yards: 100,
        rushing_tds: 1,
        rushing_fumbles_lost: 2,
        games: 1
      };

      const points = calculateFantasyPoints(rbStats, SCORING_CONFIGS.standard);
      
      // 100 * 0.1 = 10 (rushing yards)
      // 1 * 6 = 6 (rushing TD)
      // 2 * -2 = -4 (fumbles lost)
      // Total = 12
      expect(points).toBe(12);
    });

    it('should calculate kicker scoring correctly', () => {
      const kickerStats = {
        fg_made: 3,
        fg_made_50_59: 1,
        pat_made: 4,
        fg_missed: 1,
        games: 1
      };

      const points = calculateFantasyPoints(kickerStats, SCORING_CONFIGS.kicker);
      
      // 3 * 3 = 9 (FG made)
      // 1 * 2 = 2 (50+ yard bonus)
      // 4 * 1 = 4 (PAT made)
      // 1 * -1 = -1 (FG missed)
      // Total = 14
      expect(points).toBe(14);
    });

    it('should handle missing stats gracefully', () => {
      const incompleteStats = {
        passing_yards: 250,
        // Missing other stats
      };

      const points = calculateFantasyPoints(incompleteStats, SCORING_CONFIGS.standard);
      
      // 250 * 0.04 = 10
      expect(points).toBe(10);
    });

    it('should handle null or undefined stats', () => {
      const points1 = calculateFantasyPoints(null, SCORING_CONFIGS.standard);
      const points2 = calculateFantasyPoints(undefined, SCORING_CONFIGS.standard);
      
      expect(points1).toBe(0);
      expect(points2).toBe(0);
    });

    it('should calculate 6pt passing TD scoring correctly', () => {
      const qbStats = {
        passing_yards: 300,
        passing_tds: 3,
        passing_interceptions: 0,
        games: 1
      };

      const points = calculateFantasyPoints(qbStats, SCORING_CONFIGS.sixPointPassingTD);
      
      // 300 * 0.04 = 12 (passing yards)
      // 3 * 6 = 18 (passing TDs at 6pts each)
      // Total = 30
      expect(points).toBe(30);
    });
  });

  describe('calculateFantasyPointsPerGame', () => {
    it('should calculate per game average correctly', () => {
      const playerStats = {
        rushing_yards: 500,
        rushing_tds: 5,
        games: 10
      };

      const ppg = calculateFantasyPointsPerGame(playerStats, SCORING_CONFIGS.standard);
      
      // Total: (500 * 0.1) + (5 * 6) = 50 + 30 = 80
      // Per game: 80 / 10 = 8
      expect(ppg).toBe(8);
    });

    it('should handle zero games', () => {
      const playerStats = {
        rushing_yards: 100,
        rushing_tds: 1,
        games: 0
      };

      const ppg = calculateFantasyPointsPerGame(playerStats, SCORING_CONFIGS.standard);
      expect(ppg).toBe(0);
    });

    it('should handle missing games field', () => {
      const playerStats = {
        rushing_yards: 100,
        rushing_tds: 1
        // games field missing
      };

      const ppg = calculateFantasyPointsPerGame(playerStats, SCORING_CONFIGS.standard);
      
      // Should default to 1 game
      // (100 * 0.1) + (1 * 6) = 16
      expect(ppg).toBe(16);
    });
  });

  describe('calculateFantasyPointsForMultiplePlayers', () => {
    it('should calculate points for multiple players', () => {
      const players = [
        {
          player_id: '00-0001',
          player_display_name: 'Player One',
          position: 'RB',
          recent_team: 'KC',
          rushing_yards: 100,
          rushing_tds: 1,
          games: 1
        },
        {
          player_id: '00-0002',
          player_display_name: 'Player Two',
          position: 'WR',
          recent_team: 'BUF',
          receptions: 5,
          receiving_yards: 80,
          receiving_tds: 1,
          games: 1
        }
      ];

      const results = calculateFantasyPointsForMultiplePlayers(players, SCORING_CONFIGS.ppr);
      
      expect(results).toHaveLength(2);
      
      // Player One: (100 * 0.1) + (1 * 6) = 16
      expect(results[0].fantasy_points).toBe(16);
      expect(results[0].player_name).toBe('Player One');
      expect(results[0].position).toBe('RB');
      
      // Player Two: (5 * 1) + (80 * 0.1) + (1 * 6) = 5 + 8 + 6 = 19
      expect(results[1].fantasy_points).toBe(19);
      expect(results[1].player_name).toBe('Player Two');
    });
  });

  describe('getFantasyPointsBreakdown', () => {
    it('should break down points by category', () => {
      const playerStats = {
        passing_yards: 300,
        passing_tds: 2,
        passing_interceptions: 1,
        rushing_yards: 50,
        rushing_tds: 1,
        receiving_yards: 0,
        receiving_tds: 0,
        receptions: 0,
        games: 1
      };

      const breakdown = getFantasyPointsBreakdown(playerStats, SCORING_CONFIGS.standard);
      
      // Passing: 300 * 0.04 + 2 * 4 + 1 * -2 = 12 + 8 - 2 = 18
      expect(breakdown.passing).toBe(18);
      
      // Rushing: 50 * 0.1 + 1 * 6 = 5 + 6 = 11
      expect(breakdown.rushing).toBe(11);
      
      // Receiving: 0
      expect(breakdown.receiving).toBe(0);
      
      // Total: 18 + 11 = 29
      expect(breakdown.total).toBe(29);
    });

    it('should include bonuses in breakdown', () => {
      const playerStats = {
        passing_yards: 350,
        passing_tds: 2,
        games: 1
      };

      const breakdown = getFantasyPointsBreakdown(playerStats, SCORING_CONFIGS.sixPointPassingTD);
      
      // Should have 300-yard bonus
      expect(breakdown.bonuses).toBe(3);
      
      // Passing: 350 * 0.04 + 2 * 6 = 14 + 12 = 26
      expect(breakdown.passing).toBe(26);
      
      // Total: 26 + 3 = 29
      expect(breakdown.total).toBe(29);
    });

    it('should handle defensive stats', () => {
      const defenseStats = {
        def_sacks: 3,
        def_interceptions: 2,
        def_tds: 1,
        games: 1
      };

      const breakdown = getFantasyPointsBreakdown(defenseStats, SCORING_CONFIGS.defense);
      
      // Defense: 3 * 1 + 2 * 2 + 1 * 6 = 3 + 4 + 6 = 13
      expect(breakdown.defense).toBe(13);
      expect(breakdown.total).toBe(13);
    });
  });

  describe('Edge cases and bonuses', () => {
    it('should apply multiple bonuses when applicable', () => {
      const qbStats = {
        passing_yards: 450,
        passing_tds: 4,
        rushing_yards: 120,
        rushing_tds: 1,
        games: 1
      };

      const breakdown = getFantasyPointsBreakdown(qbStats, SCORING_CONFIGS.sixPointPassingTD);
      
      // Should get 300-yard AND 400-yard bonuses (total 6)
      expect(breakdown.bonuses).toBe(9); // 3 + 3 + 3 (passing 300, passing 400, rushing 100)
    });

    it('should handle 2pt conversions', () => {
      const playerStats = {
        rushing_tds: 1,
        rushing_2pt_conversions: 1,
        receiving_tds: 1,
        receiving_2pt_conversions: 1,
        games: 1
      };

      const points = calculateFantasyPoints(playerStats, SCORING_CONFIGS.standard);
      
      // 1 * 6 + 1 * 2 + 1 * 6 + 1 * 2 = 16
      expect(points).toBe(16);
    });

    it('should round to 2 decimal places', () => {
      const playerStats = {
        passing_yards: 333, // 333 * 0.04 = 13.32
        games: 1
      };

      const points = calculateFantasyPoints(playerStats, SCORING_CONFIGS.standard);
      expect(points).toBe(13.32);
    });
  });
});
