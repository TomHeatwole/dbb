# Score Validation System - File Summary

This document provides an overview of all the files created for the score validation system.

## Core Files

### `validate_scores_data.js` 
**Main validation logic**

- Compares Sleeper API scores vs locally calculated scores
- Fetches rosters, matchup data, and weekly stats
- Maps Sleeper stat field names to score_format.json fields
- Calculates fantasy points using fantasyCalculator.js
- Reports differences with detailed diagnostics
- Main export: `validateScores(seasons, options)`

**Key Functions:**
- `validateScores(seasons, options)` - Main validation entry point
- `validateWeek(...)` - Validates a single week
- `mapSleeperStatsToScoringFormat(...)` - Stat field name mapping
- `getRosteredPlayerIds(rosters)` - Extracts player IDs from rosters

### `weeklyStatsLoader.js`
**Weekly stats fetcher with caching**

- Fetches weekly player stats from Sleeper API
- Caches results in memory to avoid redundant API calls
- Handles API errors gracefully
- Provides cache management utilities

**Key Functions:**
- `fetchWeeklyStats(season, week)` - Fetch stats for a single week
- `fetchMultipleWeeksStats(season, weeks, delayMs)` - Batch fetch with throttling
- `clearStatsCache()` - Clear the cache
- `getCacheInfo()` - Get cache statistics

## Runner Scripts

### `run_validation.js`
**Command-line interface**

- Node.js command-line runner for validation
- Parses CLI arguments (seasons, weeks, options)
- Provides help documentation
- Exits with appropriate error codes

**Usage:**
```bash
node run_validation.js [seasons...] [options]
node run_validation.js 2024 --weeks 1-4
node run_validation.js --stop-on-diff
```

### `quick_validate.sh`
**Bash convenience script**

- Quick access to common validation scenarios
- Colored output for easy reading
- Predefined test cases (quick, recent, 2024, 2025, both, etc.)

**Usage:**
```bash
./quick_validate.sh quick      # Fastest - week 1 only
./quick_validate.sh 2024       # Full 2024 season
./quick_validate.sh first-diff # Stop on first difference
```

## Documentation

### `VALIDATION_README.md`
**Comprehensive user guide**

Complete documentation covering:
- How the validation system works
- Usage examples (CLI and programmatic)
- Common difference types and debugging
- Rate limiting and caching
- Troubleshooting guide
- Future enhancement ideas

### `README.md` (updated)
**Main data_parse documentation**

Updated to include:
- Score validation feature
- Link to VALIDATION_README.md
- Quick start examples

## Examples & Tests

### `validation_examples.js`
**Example code**

Demonstrates 6 different ways to use the validation API:
1. Basic validation
2. Stop on first difference
3. Multiple seasons (quiet mode)
4. Direct weekly stats access
5. Integration test pattern
6. Export results to JSON

**Run examples:**
```bash
node validation_examples.js
```

### `validateScoresData.test.js`
**Jest test suite**

Comprehensive test coverage:
- Weekly stats loader tests
- Cache management tests
- Validation logic tests
- Error handling tests
- Integration tests

**Run tests:**
```bash
npm test validateScoresData.test.js
```

## File Structure

```
site/src/data_parse/
├── validate_scores_data.js       # Main validation logic
├── weeklyStatsLoader.js          # Fetch & cache weekly stats
├── run_validation.js             # CLI runner (executable)
├── quick_validate.sh             # Bash convenience script (executable)
├── validation_examples.js        # Example code
├── validateScoresData.test.js    # Test suite
├── VALIDATION_README.md          # Comprehensive documentation
├── VALIDATION_FILES.md           # This file
└── README.md                     # Main README (updated)
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     VALIDATION SYSTEM                        │
└─────────────────────────────────────────────────────────────┘

1. Get Rostered Players
   └─> fetchTeamData(season) → rosters → player IDs

2. For Each Week:
   
   A. Sleeper API Score (Source of Truth)
      └─> fetchScoresData(season) → weeksParsedData → players_points
   
   B. Calculated Score
      └─> fetchWeeklyStats(season, week) [weeklyStatsLoader.js]
          └─> mapSleeperStatsToScoringFormat()
              └─> calculateFantasyPoints(stats, config) [fantasyCalculator.js]

3. Compare & Report
   └─> difference > 0.5 points? → flag and report details
```

## Stat Field Mapping

The system maps Sleeper API field names to score_format.json field names:

| Sleeper API | score_format.json |
|-------------|-------------------|
| `pass_yd` | `passing_yards` |
| `pass_td` | `passing_tds` |
| `pass_int` | `passing_interceptions` |
| `rush_yd` | `rushing_yards` |
| `rec` | `receptions` |
| `rec_yd` | `receiving_yards` |
| `fgm` | `fg_made` |
| ... | ... |

See `STAT_FIELD_MAPPING` in `validate_scores_data.js` for complete list.

## Configuration

The validation system uses:
- **score_format.json** - Your league's scoring configuration
- **score_format.json → scoring** - Point values for each stat
- **score_format.json → position_specific_scoring** - TE premium, etc.
- **score_format.json → bonuses** - 100-yard bonuses, etc.

## API Endpoints Used

1. **Matchup Scores**
   - `https://api.sleeper.app/v1/league/{leagueId}/matchups/{week}`
   - Provides pre-calculated fantasy points

2. **Weekly Stats**
   - `https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}`
   - Provides raw NFL stats for calculation

3. **Team Data**
   - `https://api.sleeper.app/v1/league/{leagueId}/rosters`
   - `https://api.sleeper.app/v1/league/{leagueId}/users`
   - Provides roster information

## Performance Characteristics

**Typical Validation Run (2024 + 2025, all weeks):**
- ~8,160 API calls (240 players × 17 weeks × 2 seasons)
- ~13 minutes with 100ms delay between calls
- ~27 minutes with 200ms delay (safer for rate limits)
- Cache reduces re-runs to < 1 second

**Memory Usage:**
- ~1-2 MB per week of cached stats
- ~34-68 MB for full 2-season cache

## Exit Codes

- `0` - All scores validated successfully (no differences)
- `1` - Differences found or validation error occurred

## Extension Points

The system is designed to be extensible:

1. **Add New Stat Mappings**
   - Update `STAT_FIELD_MAPPING` in validate_scores_data.js

2. **Custom Difference Threshold**
   - Modify `difference > 0.5` check in `validateWeek()`

3. **Export Formats**
   - Add functions to export results (JSON, CSV, etc.)

4. **Web Dashboard**
   - Import validation functions in a React component
   - Display results in a UI

5. **Automated Testing**
   - Run validation in CI/CD pipeline
   - Fail builds on differences

6. **Alerting**
   - Send notifications when differences found
   - Integrate with Slack, email, etc.

## Common Tasks

### Run Quick Test
```bash
./quick_validate.sh quick
```

### Validate Specific Week
```bash
node run_validation.js 2024 --weeks 5
```

### Debug Differences
```bash
node run_validation.js 2024 --weeks 1 --stop-on-diff
```

### Run Tests
```bash
npm test validateScoresData.test.js
```

### Check Cache
```javascript
import { getCacheInfo } from './weeklyStatsLoader.js';
console.log(getCacheInfo());
```

### Clear Cache
```javascript
import { clearStatsCache } from './weeklyStatsLoader.js';
clearStatsCache();
```

## Maintenance

### When to Update

1. **Sleeper API Changes**
   - Update `STAT_FIELD_MAPPING` if field names change
   - Update API endpoints if URLs change

2. **Scoring Rule Changes**
   - Update score_format.json
   - Run validation to verify changes

3. **New Stat Categories**
   - Add mappings to `STAT_FIELD_MAPPING`
   - Add handling in fantasyCalculator.js if needed

4. **Performance Issues**
   - Adjust `delayMs` for rate limiting
   - Optimize caching strategy
   - Consider batch processing

### Troubleshooting

See [VALIDATION_README.md](./VALIDATION_README.md) for detailed troubleshooting guide.

## Credits

Created for the DBB Dynasty League fantasy football website.
