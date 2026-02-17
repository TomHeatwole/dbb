/**
 * Example: Using the Score Validation API
 * 
 * This file shows how to use the validation functions in your own code
 */

import { validateScores } from './validate_scores_data.js';
import { fetchWeeklyStats, clearStatsCache } from './weeklyStatsLoader.js';

// Example 1: Basic validation
async function example1_basicValidation() {
  const results = await validateScores(['2024'], {
    weeks: [1, 2, 3],
    verbose: true,
    delayMs: 100
  });
  return results;
}

// Example 2: Validate specific weeks and stop on first difference
async function example2_stopOnDifference() {
  const results = await validateScores(['2024'], {
    weeks: [1, 2, 3, 4, 5],
    verbose: true,
    delayMs: 100,
    stopOnFirstDifference: true
  });
  return results;
}

// Example 3: Validate multiple seasons with minimal output
async function example3_multipleSeasonsQuiet() {
  const results = await validateScores(['2024', '2025'], {
    weeks: [1, 2, 3],
    verbose: false,
    delayMs: 100
  });
  return results;
}

// Example 4: Use weekly stats loader directly
async function example4_weeklyStatsLoader() {
  clearStatsCache();
  const week1Stats = await fetchWeeklyStats(2024, 1);
  const week2Stats = await fetchWeeklyStats(2024, 2);
  const week3Stats = await fetchWeeklyStats(2024, 3);
  return { week1Stats, week2Stats, week3Stats };
}

// Example 5: Integration test pattern
async function example5_integrationTest() {
  try {
    const results = await validateScores(['2024'], {
      weeks: [1],
      verbose: false,
      delayMs: 0
    });
    return results.summary.totalDifferences === 0;
  } catch (_) {
    return false;
  }
}

// Example 6: Export results to JSON
async function example6_exportResults() {
  const results = await validateScores(['2024'], {
    weeks: [1, 2],
    verbose: false,
    delayMs: 50
  });
  return JSON.stringify(results, null, 2);
}

// Run all examples
async function runAllExamples() {
  try {
    await example1_basicValidation();
    // await example2_stopOnDifference();
    // await example3_multipleSeasonsQuiet();
    // await example4_weeklyStatsLoader();
    // await example5_integrationTest();
    // await example6_exportResults();
  } catch (_) {}
}

// Run if executed directly
if (typeof window === 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}

export {
  example1_basicValidation,
  example2_stopOnDifference,
  example3_multipleSeasonsQuiet,
  example4_weeklyStatsLoader,
  example5_integrationTest,
  example6_exportResults
};
