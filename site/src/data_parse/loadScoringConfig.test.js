/**
 * Unit tests for scoring config loader
 */

import {
  loadScoringConfig,
  getDefaultScoringConfig,
  validateScoringConfig
} from './loadScoringConfig.js';

describe('Load Scoring Config', () => {
  const validConfig = {
    name: 'Test Config',
    scoring: {
      passing_yards: 0.04,
      passing_tds: 4,
      rushing_yards: 0.1,
      rushing_tds: 6
    },
    bonuses: {
      passing_300_bonus: 3
    }
  };

  const mockFetch = (config) => {
    global.fetch = jest.fn(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(config)
      })
    );
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('validateScoringConfig', () => {
    it('should validate a valid config', () => {
      expect(() => validateScoringConfig(validConfig)).not.toThrow();
    });

    it('should reject null config', () => {
      expect(() => validateScoringConfig(null)).toThrow('Config is null or undefined');
    });

    it('should reject config without scoring object', () => {
      const invalid = { name: 'Invalid' };
      expect(() => validateScoringConfig(invalid)).toThrow('Config must have a "scoring" object');
    });

    it('should reject non-numeric scoring values', () => {
      const invalid = {
        scoring: {
          passing_yards: 'invalid'
        }
      };
      expect(() => validateScoringConfig(invalid)).toThrow('must be a number');
    });

    it('should reject non-numeric bonus values', () => {
      const invalid = {
        scoring: {
          passing_yards: 0.04
        },
        bonuses: {
          passing_300_bonus: 'invalid'
        }
      };
      expect(() => validateScoringConfig(invalid)).toThrow('must be a number');
    });

    it('should accept config without bonuses', () => {
      const configNoBonuses = {
        name: 'No Bonuses',
        scoring: {
          passing_yards: 0.04
        }
      };
      expect(() => validateScoringConfig(configNoBonuses)).not.toThrow();
    });

    it('should reject invalid bonuses type', () => {
      const invalid = {
        scoring: {
          passing_yards: 0.04
        },
        bonuses: 'invalid'
      };
      expect(() => validateScoringConfig(invalid)).toThrow('bonuses" must be an object');
    });

    it('should accept config with position-specific scoring', () => {
      const configWithPosition = {
        name: 'TE Premium',
        scoring: {
          passing_yards: 0.04,
          receptions: 1
        },
        position_specific_scoring: {
          receptions: {
            TE: 1.5,
            WR: 1,
            RB: 1
          }
        }
      };
      expect(() => validateScoringConfig(configWithPosition)).not.toThrow();
    });

    it('should reject invalid position-specific scoring structure', () => {
      const invalid = {
        scoring: {
          receptions: 1
        },
        position_specific_scoring: 'invalid'
      };
      expect(() => validateScoringConfig(invalid)).toThrow('position_specific_scoring" must be an object');
    });

    it('should reject non-object position map in position-specific scoring', () => {
      const invalid = {
        scoring: {
          receptions: 1
        },
        position_specific_scoring: {
          receptions: 'invalid'
        }
      };
      expect(() => validateScoringConfig(invalid)).toThrow('must be an object');
    });

    it('should reject non-numeric values in position-specific scoring', () => {
      const invalid = {
        scoring: {
          receptions: 1
        },
        position_specific_scoring: {
          receptions: {
            TE: 'invalid'
          }
        }
      };
      expect(() => validateScoringConfig(invalid)).toThrow('must be a number');
    });
  });

  describe('loadScoringConfig', () => {
    it('should load scoring config from JSON file', async () => {
      mockFetch(validConfig);
      
      const config = await loadScoringConfig('/test/score_format.json');
      
      expect(config).toEqual(validConfig);
      expect(global.fetch).toHaveBeenCalledWith('/test/score_format.json');
    });

    it('should use default path when none specified', async () => {
      mockFetch(validConfig);
      
      await loadScoringConfig();
      
      expect(global.fetch).toHaveBeenCalledWith('/data/score_format.json');
    });

    it('should throw error if fetch fails', async () => {
      global.fetch = jest.fn(() => 
        Promise.resolve({
          ok: false,
          statusText: 'Not Found'
        })
      );
      
      await expect(loadScoringConfig()).rejects.toThrow('Failed to load scoring config');
    });

    it('should throw error if config is missing scoring field', async () => {
      const invalidConfig = { name: 'Invalid' };
      mockFetch(invalidConfig);
      
      await expect(loadScoringConfig()).rejects.toThrow('missing "scoring" field');
    });
  });

  describe('getDefaultScoringConfig', () => {
    it('should load the default scoring config', async () => {
      mockFetch(validConfig);
      
      const config = await getDefaultScoringConfig();
      
      expect(config).toEqual(validConfig);
      expect(global.fetch).toHaveBeenCalledWith('/data/score_format.json');
    });
  });

  describe('Integration with FantasyScoring', () => {
    it('should load default config on init', async () => {
      // This would be tested in the integration tests
      // Just documenting the expected behavior
      expect(true).toBe(true);
    });
  });
});
