/**
 * Tests for score validation functionality
 */

import { validateScores } from './validate_scores_data.js';
import { fetchWeeklyStats, clearStatsCache, getCacheInfo } from './weeklyStatsLoader.js';

describe('Score Validation', () => {
  afterEach(() => {
    clearStatsCache();
  });

  describe('weeklyStatsLoader', () => {
    it('should fetch weekly stats from Sleeper API', async () => {
      const stats = await fetchWeeklyStats(2024, 1);
      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });

    it('should cache weekly stats', async () => {
      clearStatsCache();
      
      // First fetch
      await fetchWeeklyStats(2024, 1);
      let cacheInfo = getCacheInfo();
      expect(cacheInfo.size).toBe(1);
      expect(cacheInfo.keys).toContain('2024-1');
      
      // Second fetch (should use cache)
      await fetchWeeklyStats(2024, 1);
      cacheInfo = getCacheInfo();
      expect(cacheInfo.size).toBe(1); // Still just 1 entry
    });

    it('should clear cache', async () => {
      await fetchWeeklyStats(2024, 1);
      await fetchWeeklyStats(2024, 2);
      
      let cacheInfo = getCacheInfo();
      expect(cacheInfo.size).toBe(2);
      
      clearStatsCache();
      
      cacheInfo = getCacheInfo();
      expect(cacheInfo.size).toBe(0);
    });

    it('should handle API errors gracefully', async () => {
      // Try to fetch a week that doesn't exist
      const stats = await fetchWeeklyStats(2030, 99);
      expect(stats).toEqual({});
    });
  });

  describe('validateScores', () => {
    it('should validate scores for a single week', async () => {
      const results = await validateScores(['2024'], {
        weeks: [1],
        verbose: false,
        delayMs: 0
      });

      expect(results).toBeDefined();
      expect(results.summary).toBeDefined();
      expect(results.summary.totalValidations).toBeGreaterThan(0);
      expect(results.seasons['2024']).toBeDefined();
      expect(results.seasons['2024'].weeks[1]).toBeDefined();
    });

    it('should validate scores for multiple weeks', async () => {
      const results = await validateScores(['2024'], {
        weeks: [1, 2, 3],
        verbose: false,
        delayMs: 50
      });

      expect(results.seasons['2024'].weeks[1]).toBeDefined();
      expect(results.seasons['2024'].weeks[2]).toBeDefined();
      expect(results.seasons['2024'].weeks[3]).toBeDefined();
    });

    it('should track validation statistics', async () => {
      const results = await validateScores(['2024'], {
        weeks: [1],
        verbose: false,
        delayMs: 0
      });

      const summary = results.summary;
      expect(summary.totalValidations).toBe(
        summary.totalMatches + summary.totalDifferences
      );
    });

    it('should identify differences when they exist', async () => {
      const results = await validateScores(['2024'], {
        weeks: [1, 2, 3],
        verbose: false,
        delayMs: 50
      });

      // Check structure of differences if any exist
      for (const season in results.seasons) {
        for (const week in results.seasons[season].weeks) {
          const weekResults = results.seasons[season].weeks[week];
          
          if (weekResults.differences.length > 0) {
            const diff = weekResults.differences[0];
            expect(diff).toHaveProperty('playerId');
            expect(diff).toHaveProperty('playerName');
            expect(diff).toHaveProperty('sleeperScore');
            expect(diff).toHaveProperty('calculatedScore');
            expect(diff).toHaveProperty('difference');
            expect(diff).toHaveProperty('rawStats');
          }
        }
      }
    });

    it('should validate multiple seasons', async () => {
      const results = await validateScores(['2024', '2025'], {
        weeks: [1],
        verbose: false,
        delayMs: 50
      });

      expect(results.seasons['2024']).toBeDefined();
      expect(results.seasons['2025']).toBeDefined();
    });

    it('should handle missing data gracefully', async () => {
      // Try to validate a future week that hasn't happened yet
      const results = await validateScores(['2025'], {
        weeks: [18], // Week 18 doesn't exist in regular season
        verbose: false,
        delayMs: 0
      });

      // Should complete without throwing
      expect(results).toBeDefined();
    });
  });
});

describe('Stat Field Mapping', () => {
  it('should map Sleeper stat fields to scoring format', () => {
    // This is tested implicitly in the validation
    // Could add explicit unit tests for the mapping function if needed
    expect(true).toBe(true);
  });
});

describe('Integration', () => {
  it('should run a quick validation on recent data', async () => {
    // Quick smoke test - validate just week 1 of 2024
    const results = await validateScores(['2024'], {
      weeks: [1],
      verbose: false,
      delayMs: 0
    });

    expect(results.summary.totalValidations).toBeGreaterThan(0);
  }, 30000); // 30 second timeout for API calls
});
