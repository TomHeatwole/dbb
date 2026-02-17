/**
 * Example: Using the Score Validation API
 * 
 * This file shows how to use the validation functions in your own code
 */

import { validateScores } from './validate_scores_data.js';
import { fetchWeeklyStats, getCacheInfo, clearStatsCache } from './weeklyStatsLoader.js';

// Example 1: Basic validation
async function example1_basicValidation() {
  console.log('Example 1: Basic Validation\n');
  
  const results = await validateScores(['2024'], {
    weeks: [1, 2, 3],
    verbose: true,
    delayMs: 100
  });
  
  console.log('\nValidation complete!');
  console.log(`Matched: ${results.summary.totalMatches}`);
  console.log(`Differences: ${results.summary.totalDifferences}`);
  
  return results;
}

// Example 2: Validate specific weeks and stop on first difference
async function example2_stopOnDifference() {
  console.log('\nExample 2: Stop on First Difference\n');
  
  const results = await validateScores(['2024'], {
    weeks: [1, 2, 3, 4, 5],
    verbose: true,
    delayMs: 100,
    stopOnFirstDifference: true
  });
  
  if (results.summary.totalDifferences > 0) {
    console.log('\n⚠️  Found differences! Details:');
    
    for (const season in results.seasons) {
      for (const week in results.seasons[season].weeks) {
        const weekResults = results.seasons[season].weeks[week];
        
        if (weekResults.differences.length > 0) {
          console.log(`\nSeason ${season}, Week ${week}:`);
          weekResults.differences.forEach(diff => {
            console.log(`  ${diff.playerName}: ${diff.difference} point difference`);
            console.log(`    Sleeper: ${diff.sleeperScore}, Calculated: ${diff.calculatedScore}`);
          });
        }
      }
    }
  }
  
  return results;
}

// Example 3: Validate multiple seasons with minimal output
async function example3_multipleSeasonsQuiet() {
  console.log('\nExample 3: Multiple Seasons (Quiet Mode)\n');
  
  const results = await validateScores(['2024', '2025'], {
    weeks: [1, 2, 3],
    verbose: false,
    delayMs: 100
  });
  
  // Custom summary
  console.log('Summary:');
  for (const season in results.seasons) {
    const seasonSummary = results.seasons[season].summary;
    console.log(`  ${season}: ${seasonSummary.totalMatches} matches, ${seasonSummary.totalDifferences} differences`);
  }
  
  return results;
}

// Example 4: Use weekly stats loader directly
async function example4_weeklyStatsLoader() {
  console.log('\nExample 4: Direct Weekly Stats Access\n');
  
  clearStatsCache();
  
  // Fetch stats for a specific week
  const week1Stats = await fetchWeeklyStats(2024, 1);
  console.log(`Week 1 2024: ${Object.keys(week1Stats).length} players have stats`);
  
  // Check a specific player
  const playerId = '6462'; // Aaron Rodgers
  if (week1Stats[playerId]) {
    console.log(`Aaron Rodgers stats:`, week1Stats[playerId]);
  }
  
  // Fetch multiple weeks
  const week2Stats = await fetchWeeklyStats(2024, 2);
  const week3Stats = await fetchWeeklyStats(2024, 3);
  
  // Check cache
  const cacheInfo = getCacheInfo();
  console.log(`\nCache info: ${cacheInfo.size} weeks cached, ${cacheInfo.totalPlayers} total records`);
  
  return { week1Stats, week2Stats, week3Stats };
}

// Example 5: Integration test pattern
async function example5_integrationTest() {
  console.log('\nExample 5: Integration Test Pattern\n');
  
  try {
    const results = await validateScores(['2024'], {
      weeks: [1],
      verbose: false,
      delayMs: 0
    });
    
    // Assert no differences
    if (results.summary.totalDifferences === 0) {
      console.log('✅ PASS: All scores match!');
      return true;
    } else {
      console.log(`❌ FAIL: ${results.summary.totalDifferences} differences found`);
      
      // Log details
      for (const season in results.seasons) {
        for (const week in results.seasons[season].weeks) {
          const weekResults = results.seasons[season].weeks[week];
          weekResults.differences.forEach(diff => {
            console.log(`  ${diff.playerName}: ${diff.difference} points`);
          });
        }
      }
      
      return false;
    }
  } catch (error) {
    console.log('❌ ERROR:', error.message);
    return false;
  }
}

// Example 6: Export results to JSON
async function example6_exportResults() {
  console.log('\nExample 6: Export Results to JSON\n');
  
  const results = await validateScores(['2024'], {
    weeks: [1, 2],
    verbose: false,
    delayMs: 50
  });
  
  // In a browser, you might use fetch to POST this to a server
  // In Node.js, you could write to a file
  const jsonOutput = JSON.stringify(results, null, 2);
  
  console.log('Results exported (first 500 chars):');
  console.log(jsonOutput.substring(0, 500) + '...');
  
  return jsonOutput;
}

// Run all examples
async function runAllExamples() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  VALIDATION API EXAMPLES');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  try {
    // Run one example at a time
    // Uncomment the one you want to run:
    
    await example1_basicValidation();
    // await example2_stopOnDifference();
    // await example3_multipleSeasonsQuiet();
    // await example4_weeklyStatsLoader();
    // await example5_integrationTest();
    // await example6_exportResults();
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('Examples complete!');
    console.log('═══════════════════════════════════════════════════════════');
  } catch (error) {
    console.error('\n❌ Error running examples:', error);
  }
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
