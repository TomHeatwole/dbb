/**
 * Unit tests for Player Stats Loader
 */

import {
  getPlayerStatsByGsisId,
  getPlayerStatsByPlayerId,
  getMultiplePlayerStats
} from './playerStatsLoader.js';

describe('Player Stats Loader', () => {
  const mockStatsArray = [
    {
      player_id: '00-0023459',
      player_name: 'A.Rodgers',
      player_display_name: 'Aaron Rodgers',
      position: 'QB',
      recent_team: 'NYJ',
      games: '17',
      passing_yards: '3897',
      passing_tds: '28',
      passing_interceptions: '11',
      rushing_yards: '107',
      rushing_tds: '0'
    },
    {
      player_id: '00-0026498',
      player_name: 'M.Stafford',
      player_display_name: 'Matthew Stafford',
      position: 'QB',
      recent_team: 'LA',
      games: '16',
      passing_yards: '3762',
      passing_tds: '20',
      passing_interceptions: '8',
      rushing_yards: '41',
      rushing_tds: '0'
    },
    {
      player_id: '00-0030035',
      player_name: 'A.Thielen',
      player_display_name: 'Adam Thielen',
      position: 'WR',
      recent_team: 'CAR',
      games: '10',
      receptions: '48',
      receiving_yards: '615',
      receiving_tds: '5'
    }
  ];

  const mockPlayersData = {
    '6462': {
      player_id: '6462',
      full_name: 'Aaron Rodgers',
      gsis_id: '00-0023459',
      position: 'QB'
    },
    '7890': {
      player_id: '7890',
      full_name: 'Matthew Stafford',
      gsis_id: ' 00-0026498', // Note: leading space
      position: 'QB'
    },
    '9999': {
      player_id: '9999',
      full_name: 'Unknown Player',
      gsis_id: '00-9999999',
      position: 'RB'
    },
    '1111': {
      player_id: '1111',
      full_name: 'No GSIS',
      // Missing gsis_id
      position: 'WR'
    }
  };

  describe('getPlayerStatsByGsisId', () => {
    it('should find player by GSIS ID', () => {
      const stats = getPlayerStatsByGsisId(mockStatsArray, '00-0023459');
      
      expect(stats).not.toBeNull();
      expect(stats.player_display_name).toBe('Aaron Rodgers');
      expect(stats.position).toBe('QB');
    });

    it('should handle GSIS ID with leading/trailing spaces', () => {
      const stats = getPlayerStatsByGsisId(mockStatsArray, ' 00-0026498 ');
      
      expect(stats).not.toBeNull();
      expect(stats.player_display_name).toBe('Matthew Stafford');
    });

    it('should return null for non-existent GSIS ID', () => {
      const stats = getPlayerStatsByGsisId(mockStatsArray, '00-9999999');
      
      expect(stats).toBeNull();
    });

    it('should return null for empty GSIS ID', () => {
      const stats = getPlayerStatsByGsisId(mockStatsArray, '');
      
      expect(stats).toBeNull();
    });
  });

  describe('getPlayerStatsByPlayerId', () => {
    it('should find player stats by player ID from players.txt', async () => {
      const stats = await getPlayerStatsByPlayerId(mockStatsArray, mockPlayersData, '6462');
      
      expect(stats).not.toBeNull();
      expect(stats.player_display_name).toBe('Aaron Rodgers');
      expect(stats.position).toBe('QB');
    });

    it('should handle GSIS ID with leading space in players data', async () => {
      const stats = await getPlayerStatsByPlayerId(mockStatsArray, mockPlayersData, '7890');
      
      expect(stats).not.toBeNull();
      expect(stats.player_display_name).toBe('Matthew Stafford');
    });

    it('should return null for player not in stats array', async () => {
      const stats = await getPlayerStatsByPlayerId(mockStatsArray, mockPlayersData, '9999');
      
      expect(stats).toBeNull();
    });

    it('should return null for player without GSIS ID', async () => {
      const stats = await getPlayerStatsByPlayerId(mockStatsArray, mockPlayersData, '1111');
      
      expect(stats).toBeNull();
    });

    it('should return null for non-existent player ID', async () => {
      const stats = await getPlayerStatsByPlayerId(mockStatsArray, mockPlayersData, 'invalid');
      
      expect(stats).toBeNull();
    });
  });

  describe('getMultiplePlayerStats', () => {
    it('should get stats for multiple players', () => {
      const gsisIds = ['00-0023459', '00-0026498', '00-0030035'];
      const stats = getMultiplePlayerStats(mockStatsArray, gsisIds);
      
      expect(stats).toHaveLength(3);
      expect(stats[0].player_display_name).toBe('Aaron Rodgers');
      expect(stats[1].player_display_name).toBe('Matthew Stafford');
      expect(stats[2].player_display_name).toBe('Adam Thielen');
    });

    it('should filter out non-existent players', () => {
      const gsisIds = ['00-0023459', '00-9999999', '00-0026498'];
      const stats = getMultiplePlayerStats(mockStatsArray, gsisIds);
      
      expect(stats).toHaveLength(2);
      expect(stats[0].player_display_name).toBe('Aaron Rodgers');
      expect(stats[1].player_display_name).toBe('Matthew Stafford');
    });

    it('should return empty array for all non-existent players', () => {
      const gsisIds = ['00-9999999', '00-8888888'];
      const stats = getMultiplePlayerStats(mockStatsArray, gsisIds);
      
      expect(stats).toHaveLength(0);
    });

    it('should return empty array for empty input', () => {
      const stats = getMultiplePlayerStats(mockStatsArray, []);
      
      expect(stats).toHaveLength(0);
    });

    it('should handle GSIS IDs with spaces', () => {
      const gsisIds = [' 00-0023459 ', ' 00-0026498'];
      const stats = getMultiplePlayerStats(mockStatsArray, gsisIds);
      
      expect(stats).toHaveLength(2);
    });
  });
});
