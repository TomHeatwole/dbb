/**
 * Integration tests for the complete fantasy scoring system
 */

import { FantasyScoring } from './index.js';
import { SCORING_CONFIGS } from './scoringConfig.js';

describe('Fantasy Scoring Integration', () => {
  // Mock data setup
  const mockStatsData2024 = `player_id,player_name,player_display_name,position,position_group,recent_team,games,passing_yards,passing_tds,passing_interceptions,rushing_yards,rushing_tds,receptions,receiving_yards,receiving_tds
00-0023459,A.Rodgers,Aaron Rodgers,QB,QB,NYJ,17,3897,28,11,107,0,0,0,0
00-0030035,A.Thielen,Adam Thielen,WR,WR,CAR,10,0,0,0,0,0,48,615,5
00-0029597,J.Tucker,Justin Tucker,K,SPEC,BAL,17,0,0,0,0,0,0,0,0`;

  const mockPlayersData = {
    '6462': {
      player_id: '6462',
      full_name: 'Aaron Rodgers',
      gsis_id: '00-0023459',
      position: 'QB'
    },
    '7890': {
      player_id: '7890',
      full_name: 'Adam Thielen',
      gsis_id: '00-0030035',
      position: 'WR'
    }
  };

  // Mock fetch for testing
  beforeEach(() => {
    global.fetch = jest.fn((url) => {
      if (url.includes('stats_player_reg_2024.csv')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(mockStatsData2024)
        });
      } else if (url.includes('players.txt')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockPlayersData)
        });
      }
      return Promise.reject(new Error('Not found'));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('FantasyScoring class', () => {
    it('should initialize and load players data', async () => {
      const fs = new FantasyScoring('/data/');
      await fs.init();
      
      expect(fs.playersData).not.toBeNull();
      expect(fs.playersData['6462'].full_name).toBe('Aaron Rodgers');
    });

    it('should calculate fantasy points for a player by player ID', async () => {
      const fs = new FantasyScoring('/data/');
      const result = await fs.calculateForPlayer('6462', 2024, 'standard');
      
      expect(result.success).toBe(true);
      expect(result.player_name).toBe('Aaron Rodgers');
      expect(result.position).toBe('QB');
      expect(result.games).toBe(17);
      
      // Calculate expected points:
      // Passing: 3897 * 0.04 = 155.88
      // Passing TDs: 28 * 4 = 112
      // Interceptions: 11 * -2 = -22
      // Rushing: 107 * 0.1 = 10.7
      // Total: 155.88 + 112 - 22 + 10.7 = 256.58
      expect(result.fantasy_points).toBeCloseTo(256.58, 1);
    });

    it('should calculate fantasy points with PPR scoring', async () => {
      const fs = new FantasyScoring('/data/');
      const result = await fs.calculateForPlayer('7890', 2024, 'ppr');
      
      expect(result.success).toBe(true);
      expect(result.player_name).toBe('Adam Thielen');
      
      // Calculate expected points:
      // Receptions: 48 * 1 = 48
      // Receiving yards: 615 * 0.1 = 61.5
      // Receiving TDs: 5 * 6 = 30
      // Total: 48 + 61.5 + 30 = 139.5
      expect(result.fantasy_points).toBeCloseTo(139.5, 1);
    });

    it('should calculate fantasy points by GSIS ID', async () => {
      const fs = new FantasyScoring('/data/');
      const result = await fs.calculateForGsisId('00-0023459', 2024, 'standard');
      
      expect(result.success).toBe(true);
      expect(result.player_name).toBe('Aaron Rodgers');
      expect(result.fantasy_points).toBeCloseTo(256.58, 1);
    });

    it('should return error for non-existent player', async () => {
      const fs = new FantasyScoring('/data/');
      const result = await fs.calculateForPlayer('99999', 2024, 'standard');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Player stats not found');
      expect(result.playerId).toBe('99999');
    });

    it('should include breakdown in results', async () => {
      const fs = new FantasyScoring('/data/');
      const result = await fs.calculateForPlayer('6462', 2024, 'standard');
      
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.passing).toBeGreaterThan(0);
      expect(result.breakdown.rushing).toBeGreaterThan(0);
      expect(result.breakdown.total).toBeCloseTo(result.fantasy_points, 1);
    });

    it('should calculate points per game', async () => {
      const fs = new FantasyScoring('/data/');
      const result = await fs.calculateForPlayer('6462', 2024, 'standard');
      
      expect(result.fantasy_points_per_game).toBeCloseTo(256.58 / 17, 1);
    });

    it('should use custom scoring config', async () => {
      const fs = new FantasyScoring('/data/');
      const customConfig = {
        name: 'Custom',
        scoring: {
          passing_yards: 0.05,  // Higher than standard
          passing_tds: 6,       // 6pt passing TDs
          passing_interceptions: -3  // Harsher penalties
        },
        bonuses: {}
      };
      
      const result = await fs.calculateForPlayer('6462', 2024, customConfig);
      
      expect(result.success).toBe(true);
      expect(result.config_name).toBe('Custom');
      
      // Calculate expected points:
      // Passing: 3897 * 0.05 = 194.85
      // Passing TDs: 28 * 6 = 168
      // Interceptions: 11 * -3 = -33
      // Rushing: 107 * 0 = 0 (not in config)
      // Total: 194.85 + 168 - 33 = 329.85
      expect(result.fantasy_points).toBeCloseTo(329.85, 1);
    });

    it('should get top players sorted by fantasy points', async () => {
      const fs = new FantasyScoring('/data/');
      const topPlayers = await fs.getTopPlayers(2024, 'ppr', { limit: 2 });
      
      expect(topPlayers).toHaveLength(2);
      
      // Aaron Rodgers should be first (256.58 pts)
      expect(topPlayers[0].player_name).toBe('Aaron Rodgers');
      
      // Adam Thielen should be second (139.5 pts in PPR)
      expect(topPlayers[1].player_name).toBe('Adam Thielen');
      
      // Verify descending order
      expect(topPlayers[0].fantasy_points).toBeGreaterThan(topPlayers[1].fantasy_points);
    });

    it('should filter top players by position', async () => {
      const fs = new FantasyScoring('/data/');
      const topQBs = await fs.getTopPlayers(2024, 'standard', { 
        position: 'QB',
        limit: 5
      });
      
      topQBs.forEach(player => {
        expect(player.position).toBe('QB');
      });
    });

    it('should cache season stats for performance', async () => {
      const fs = new FantasyScoring('/data/');
      
      // Load stats twice
      await fs.loadSeasonStats(2024);
      await fs.loadSeasonStats(2024);
      
      // Fetch should only be called once for the CSV (plus once for players.txt)
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle a typical QB performance', async () => {
      const fs = new FantasyScoring('/data/');
      const result = await fs.calculateForPlayer('6462', 2024, 'sixPointPassingTD');
      
      expect(result.success).toBe(true);
      // 6pt passing TDs should give higher score
      // 3897 * 0.04 + 28 * 6 - 11 * 2 + 107 * 0.1 = 155.88 + 168 - 22 + 10.7 = 312.58
      expect(result.fantasy_points).toBeGreaterThan(300);
    });

    it('should calculate difference between standard and PPR for WR', async () => {
      const fs = new FantasyScoring('/data/');
      
      const standardResult = await fs.calculateForPlayer('7890', 2024, 'standard');
      const pprResult = await fs.calculateForPlayer('7890', 2024, 'ppr');
      
      expect(pprResult.fantasy_points).toBeGreaterThan(standardResult.fantasy_points);
      
      // Difference should be exactly the number of receptions (48)
      const difference = pprResult.fantasy_points - standardResult.fantasy_points;
      expect(difference).toBeCloseTo(48, 1);
    });
  });
});
