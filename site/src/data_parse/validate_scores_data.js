/**
 * Score Validation Script - Node.js Standalone Version
 * 
 * This version runs directly in Node.js without depending on React app imports.
 * It fetches data directly from Sleeper API and compares with calculated scores.
 */

import { calculateFantasyPoints } from './fantasyCalculator.js';
import { fetchWeeklyStats, getCacheInfo } from './weeklyStatsLoader.js';

// Configuration - Update these for your league
const LEAGUE_ID = '1194868087212167168'; // Current season (2025) league ID
const PREVIOUS_YEARS = {
  '2024': '1119869508891660288',
  // Add more years as needed
};
const CURRENT_YEAR = '2025';

/**
 * Map Sleeper API stat field names to score_format.json field names
 */
const STAT_FIELD_MAPPING = {
  // Passing stats
  'pass_yd': 'passing_yards',
  'pass_td': 'passing_tds',
  'pass_int': 'passing_interceptions',
  'pass_2pt': 'passing_2pt_conversions',
  
  // Rushing stats
  'rush_yd': 'rushing_yards',
  'rush_td': 'rushing_tds',
  'rush_2pt': 'rushing_2pt_conversions',
  'fum_lost': 'rushing_fumbles_lost',
  
  // Receiving stats
  'rec': 'receptions',
  'rec_yd': 'receiving_yards',
  'rec_td': 'receiving_tds',
  'rec_2pt': 'receiving_2pt_conversions',
  
  // Fumble recoveries (can score TDs)
  'fum_rec_td': 'receiving_tds', // Fumble recovery TDs count as receiving TDs
  
  // Kicking stats
  'fgm': 'fg_made',
  'fgmiss': 'fg_missed',
  'fgm_50_59': 'fg_made_50_59',
  'fgm_60_': 'fg_made_60_',
  'xpm': 'pat_made',
  'xpmiss': 'pat_missed',
  
  // Defense stats
  'def_st_td': 'special_teams_tds',
  'st_td': 'special_teams_tds',  // Special teams TDs (returns, etc.)
  'def_td': 'def_tds',
  'def_int': 'def_interceptions',
  'def_fr': 'def_fumbles',
  'def_sack': 'def_sacks',
  'def_safe': 'def_safeties',
  'sack_fumbles_lost': 'sack_fumbles_lost'
};

/**
 * Load scoring configuration from JSON file
 */
async function loadScoringConfig(configPath = '/data/score_format.json') {
  try {
    // For Node.js, we need to use the full file path
    const fullPath = new URL(`../../public${configPath}`, import.meta.url);
    const fs = await import('fs/promises');
    const data = await fs.readFile(fullPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading scoring config:', error);
    throw error;
  }
}

/**
 * Load players data from file (Node.js compatible)
 */
async function loadPlayersDataFromFile() {
  try {
    const fullPath = new URL('../../public/data/players.txt', import.meta.url);
    const fs = await import('fs/promises');
    const data = await fs.readFile(fullPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading players data:', error);
    throw error;
  }
}

/**
 * Fetch rosters from Sleeper API
 */
async function fetchRosters(season) {
  const currentYear = String(CURRENT_YEAR);
  const normalizedSeason = String(season);
  const leagueId = currentYear === normalizedSeason ? LEAGUE_ID : PREVIOUS_YEARS[normalizedSeason];

  if (!leagueId) {
    throw new Error(`No league ID found for season ${normalizedSeason}`);
  }

  const response = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
  if (!response.ok) {
    throw new Error(`Failed to fetch rosters: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * Fetch matchup data for a specific week
 */
async function fetchMatchupData(season, week) {
  const currentYear = String(CURRENT_YEAR);
  const normalizedSeason = String(season);
  const leagueId = currentYear === normalizedSeason ? LEAGUE_ID : PREVIOUS_YEARS[normalizedSeason];

  if (!leagueId) {
    throw new Error(`No league ID found for season ${normalizedSeason}`);
  }

  const response = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`);
  if (!response.ok) {
    console.warn(`Failed to fetch matchup data for ${season} week ${week}: ${response.statusText}`);
    return null;
  }
  
  return await response.json();
}

/**
 * Convert Sleeper API stats to score_format.json format
 */
function mapSleeperStatsToScoringFormat(sleeperStats, position) {
  const mapped = { position };
  
  for (const [sleeperField, scoreField] of Object.entries(STAT_FIELD_MAPPING)) {
    if (sleeperStats[sleeperField] !== undefined) {
      mapped[scoreField] = sleeperStats[sleeperField];
    }
  }
  
  // Handle fumbles - Sleeper might report them in different ways
  if (sleeperStats.fum_lost !== undefined && !mapped.rushing_fumbles_lost) {
    mapped.rushing_fumbles_lost = sleeperStats.fum_lost;
    mapped.receiving_fumbles_lost = sleeperStats.fum_lost;
  }
  
  return mapped;
}

/**
 * Get all unique player IDs from rosters
 */
function getRosteredPlayerIds(rosters) {
  const playerIds = new Set();
  
  for (const roster of rosters) {
    if (roster && Array.isArray(roster.players)) {
      for (const playerId of roster.players) {
        if (playerId && playerId !== '0') {
          playerIds.add(String(playerId));
        }
      }
    }
  }
  
  return playerIds;
}

/**
 * Validate scores for a single week
 */
function validateWeek(season, week, weekMatchupData, weeklyStats, playerIds, playersData, scoringConfig) {
  const results = {
    week,
    season,
    totalPlayers: 0,
    validated: 0,
    differences: [],
    errors: []
  };

  // Extract Sleeper scores from matchup data
  const sleeperScores = {};
  if (Array.isArray(weekMatchupData)) {
    for (const entry of weekMatchupData) {
      if (entry && entry.players_points) {
        Object.assign(sleeperScores, entry.players_points);
      }
    }
  }

  // Validate each rostered player
  for (const playerId of playerIds) {
    results.totalPlayers++;
    
    const sleeperScore = sleeperScores[playerId];
    
    // Skip players who didn't play this week
    if (sleeperScore === undefined || sleeperScore === null) {
      continue;
    }

    // Get weekly stats for this player
    const playerWeeklyStats = weeklyStats[playerId];
    
    if (!playerWeeklyStats) {
      // Player has a score but no stats - skip validation
      continue;
    }

    // Get player position
    const player = playersData[playerId];
    const position = player?.position || 'UNKNOWN';

    // Map stats to scoring format
    const mappedStats = mapSleeperStatsToScoringFormat(playerWeeklyStats, position);

    // Calculate fantasy points using our scoring config
    const calculatedScore = calculateFantasyPoints(mappedStats, scoringConfig);

    // Compare scores (allow 0.5 point difference for rounding)
    const difference = Math.abs(calculatedScore - sleeperScore);
    
    if (difference > 0.5) {
      results.differences.push({
        playerId,
        playerName: player?.full_name || player?.first_name + ' ' + player?.last_name || playerId,
        position,
        sleeperScore: Math.round(sleeperScore * 10) / 10,
        calculatedScore: Math.round(calculatedScore * 10) / 10,
        difference: Math.round(difference * 10) / 10,
        rawStats: playerWeeklyStats,
        mappedStats
      });
    } else {
      results.validated++;
    }
  }

  return results;
}

/**
 * Validate scores for all rostered players across specified seasons
 */
export async function validateScores(seasons = ['2024', '2025'], options = {}) {
  const {
    weeks = Array.from({ length: 17 }, (_, i) => i + 1),
    delayMs = 100,
    verbose = true,
    stopOnFirstDifference = false
  } = options;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  FANTASY SCORE VALIDATION');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Seasons: ${seasons.join(', ')}`);
  console.log(`Weeks: ${weeks[0]}-${weeks[weeks.length - 1]}`);
  console.log('');

  const allResults = {
    seasons: {},
    summary: {
      totalValidations: 0,
      totalMatches: 0,
      totalDifferences: 0,
      totalErrors: 0
    }
  };

  try {
    // Load scoring config and players data
    const [scoringConfig, playersData] = await Promise.all([
      loadScoringConfig(),
      loadPlayersDataFromFile()
    ]);

    console.log(`✓ Loaded scoring config: ${scoringConfig.name}`);
    console.log(`✓ Loaded players data: ${Object.keys(playersData).length} players`);
    console.log('');

    // Process each season
    for (const season of seasons) {
      console.log(`Processing ${season} season...`);
      
      allResults.seasons[season] = {
        weeks: {},
        summary: {
          totalValidations: 0,
          totalMatches: 0,
          totalDifferences: 0,
          totalErrors: 0
        }
      };

      // Fetch rosters
      const rosters = await fetchRosters(season);
      const rosteredPlayerIds = getRosteredPlayerIds(rosters);
      console.log(`  ✓ Found ${rosteredPlayerIds.size} rostered players`);

      // Process each week
      for (const week of weeks) {
        if (verbose) {
          process.stdout.write(`  Week ${week}... `);
        }

        try {
          // Fetch weekly stats and matchup data
          const [weeklyStats, weekMatchupData] = await Promise.all([
            fetchWeeklyStats(season, week),
            fetchMatchupData(season, week)
          ]);

          // Validate this week
          const weekResults = validateWeek(
            season,
            week,
            weekMatchupData,
            weeklyStats,
            rosteredPlayerIds,
            playersData,
            scoringConfig
          );

          allResults.seasons[season].weeks[week] = weekResults;
          allResults.seasons[season].summary.totalValidations += weekResults.validated + weekResults.differences.length;
          allResults.seasons[season].summary.totalMatches += weekResults.validated;
          allResults.seasons[season].summary.totalDifferences += weekResults.differences.length;
          allResults.seasons[season].summary.totalErrors += weekResults.errors.length;

          if (verbose) {
            const status = weekResults.differences.length > 0 ? '✗' : '✓';
            const matchCount = weekResults.validated;
            const diffCount = weekResults.differences.length;
            const totalCount = matchCount + diffCount;
            console.log(`${status} ${matchCount}/${totalCount} validated ${diffCount > 0 ? `(${diffCount} diff)` : ''}`);
          }

          // Log differences immediately if found
          if (weekResults.differences.length > 0) {
            console.log('');
            console.log(`    ⚠️  DIFFERENCES FOUND IN ${season} WEEK ${week}:`);
            for (const diff of weekResults.differences) {
              console.log(`    ─────────────────────────────────────────────────`);
              console.log(`    Player: ${diff.playerName} (${diff.position}) [ID: ${diff.playerId}]`);
              console.log(`    Sleeper Score: ${diff.sleeperScore}`);
              console.log(`    Calculated Score: ${diff.calculatedScore}`);
              console.log(`    Difference: ${diff.difference > 0 ? '+' : ''}${diff.difference}`);
              console.log(`    Raw Stats: ${JSON.stringify(diff.rawStats)}`);
            }
            console.log(`    ─────────────────────────────────────────────────`);
            console.log('');

            if (stopOnFirstDifference) {
              console.log('Stopping validation (stopOnFirstDifference=true)');
              break;
            }
          }

          // Add delay between weeks
          if (delayMs > 0 && week !== weeks[weeks.length - 1]) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        } catch (error) {
          console.error(`Error validating week ${week}:`, error.message);
          allResults.seasons[season].summary.totalErrors++;
        }
      }

      console.log('');
    }

    // Calculate overall summary
    for (const season of seasons) {
      const seasonSummary = allResults.seasons[season].summary;
      allResults.summary.totalValidations += seasonSummary.totalValidations;
      allResults.summary.totalMatches += seasonSummary.totalMatches;
      allResults.summary.totalDifferences += seasonSummary.totalDifferences;
      allResults.summary.totalErrors += seasonSummary.totalErrors;
    }

    // Print final summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  VALIDATION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total Validations: ${allResults.summary.totalValidations}`);
    console.log(`Matches: ${allResults.summary.totalMatches} (${(allResults.summary.totalMatches / allResults.summary.totalValidations * 100).toFixed(2)}%)`);
    console.log(`Differences: ${allResults.summary.totalDifferences} (${(allResults.summary.totalDifferences / allResults.summary.totalValidations * 100).toFixed(2)}%)`);
    console.log(`Errors: ${allResults.summary.totalErrors}`);
    console.log('');

    const cacheInfo = getCacheInfo();
    console.log(`Cache Stats: ${cacheInfo.size} weeks cached, ${cacheInfo.totalPlayers} total player records`);
    console.log('═══════════════════════════════════════════════════════════');

    return allResults;

  } catch (error) {
    console.error('Fatal error during validation:', error);
    throw error;
  }
}

/**
 * Run validation from command line
 */
export async function runValidation() {
  try {
    const results = await validateScores(['2024', '2025'], {
      verbose: true,
      delayMs: 100
    });
    
    return results;
  } catch (error) {
    console.error('Validation failed:', error);
    process.exit(1);
  }
}
