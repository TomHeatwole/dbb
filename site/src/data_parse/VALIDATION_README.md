# Fantasy Score Validation

This validation tool compares fantasy scores from two different sources:

1. **Sleeper API Scores** - Pre-calculated scores from Sleeper (source of truth for the site)
2. **Locally Calculated Scores** - Scores calculated using `score_format.json` and weekly stats

## Purpose

The validation script helps ensure that:
- Your local `score_format.json` matches Sleeper's actual scoring
- There are no discrepancies in how points are calculated
- The CSV-based scoring system (used for scenarios/hoversards) matches live scores
- Any scoring differences are identified and debugged

## Files

- **`validate_scores_data.js`** - Main validation logic
- **`weeklyStatsLoader.js`** - Fetches and caches weekly stats from Sleeper API
- **`run_validation.js`** - Command-line runner script
- **`VALIDATION_README.md`** - This file

## Usage

### Basic Usage

```bash
# Validate all rostered players for 2024 & 2025 seasons
node site/src/data_parse/run_validation.js

# Validate only 2024 season
node site/src/data_parse/run_validation.js 2024

# Validate specific weeks
node site/src/data_parse/run_validation.js 2024 --weeks 1-4

# Stop on first difference (useful for debugging)
node site/src/data_parse/run_validation.js --stop-on-diff
```

### As a Module

```javascript
import { validateScores } from './data_parse/validate_scores_data.js';

const results = await validateScores(['2024', '2025'], {
  weeks: [1, 2, 3, 4, 5],
  delayMs: 100,
  verbose: true,
  stopOnFirstDifference: false
});

console.log(results.summary);
```

## How It Works

1. **Fetch Rosters** - Gets all currently rostered players for the specified season(s)
2. **For Each Week**:
   - Fetches pre-calculated scores from Sleeper's matchup data
   - Fetches raw weekly stats from Sleeper's stats API
   - Maps stat field names (e.g., `rec` → `receptions`)
   - Calculates fantasy points using your `score_format.json`
   - Compares the two scores
3. **Reports Differences** - Any score difference > 0.5 points is flagged

## Output

### Success Output
```
═══════════════════════════════════════════════════════════
  FANTASY SCORE VALIDATION
═══════════════════════════════════════════════════════════
Seasons: 2024, 2025
Weeks: 1-17

✓ Loaded scoring config: DBB League Scoring
✓ Loaded players data: 3454 players

Processing 2024 season...
  ✓ Found 240 rostered players
  Week 1... ✓ 185/185 validated
  Week 2... ✓ 194/194 validated
  Week 3... ✓ 198/198 validated
  ...

═══════════════════════════════════════════════════════════
  VALIDATION SUMMARY
═══════════════════════════════════════════════════════════
Total Validations: 6,534
Matches: 6,534 (100.00%)
Differences: 0 (0.00%)
Errors: 0

Cache Stats: 34 weeks cached, 142,430 total player records
═══════════════════════════════════════════════════════════
```

### Difference Output
```
Processing 2024 season...
  Week 3... ✗ 196/198 validated (2 diff)

    ⚠️  DIFFERENCES FOUND IN 2024 WEEK 3:
    ─────────────────────────────────────────────────
    Player: Travis Kelce (TE) [ID: 4881]
    Sleeper Score: 14.3
    Calculated Score: 14.8
    Difference: +0.5
    Raw Stats: {"rec":5,"rec_yd":45,"rec_td":1}
    ─────────────────────────────────────────────────
```

## Common Differences & Debugging

### 1. Stat Field Mapping Issues

**Problem:** Sleeper uses different field names than your scoring config
**Fix:** Update `STAT_FIELD_MAPPING` in `validate_scores_data.js`

Example:
```javascript
const STAT_FIELD_MAPPING = {
  'rec': 'receptions',        // Sleeper → score_format.json
  'rec_yd': 'receiving_yards',
  // Add more mappings as needed
};
```

### 2. Position-Specific Scoring

**Problem:** TE premium or position-specific bonuses not applied correctly
**Fix:** Ensure `position` is correctly passed to `calculateFantasyPoints()`

Your `score_format.json` has TE premium:
```json
"position_specific_scoring": {
  "receptions": {
    "TE": 0.5,
    "WR": 0,
    "RB": 0
  }
}
```

### 3. 2-Point Conversions

**Problem:** 2PT conversions counted differently
**Fix:** Check `passing_2pt_conversions`, `rushing_2pt_conversions`, `receiving_2pt_conversions` mappings

### 4. Rounding Differences

**Problem:** Minor rounding differences (< 0.5 points)
**Fix:** These are ignored by default. Adjust tolerance in `validateWeek()` function:

```javascript
if (difference > 0.5) {  // Change threshold here
  results.differences.push({ ... });
}
```

### 5. Defense/Special Teams

**Problem:** Defense scoring is complex with many stat categories
**Fix:** Add mappings for defensive stats:
```javascript
'def_st_td': 'special_teams_tds',
'def_td': 'def_tds',
'def_int': 'def_interceptions',
// etc.
```

### 6. Kicker Bonuses

**Problem:** 50+ yard field goal bonuses
**Fix:** Ensure `fg_made_50_59` and `fg_made_60_` are properly mapped

### 7. Yardage Bonuses

**Problem:** 100-yard rushing/receiving bonuses, 300-yard passing bonuses
**Fix:** Check `bonuses` section in `score_format.json` and ensure `calculateBonuses()` in `fantasyCalculator.js` handles them correctly

## API Rate Limiting

The validation script includes built-in delays between API calls to avoid rate limiting:

- Default: 100ms between calls
- Customize: `--delay 200` for 200ms delay
- Aggressive: `--delay 0` to remove delay (not recommended)

For ~240 players × 17 weeks × 2 seasons = ~8,160 API calls:
- 100ms delay = ~13 minutes total
- 200ms delay = ~27 minutes total

## Caching

Weekly stats are automatically cached in memory during validation. This means:
- Re-running validation is much faster
- Multiple players in the same week use the same cached data
- Cache is cleared when the process exits

To clear cache programmatically:
```javascript
import { clearStatsCache } from './weeklyStatsLoader.js';
clearStatsCache();
```

## Integration Testing

You can use this validation as part of your test suite:

```javascript
import { validateScores } from './validate_scores_data.js';

test('Fantasy scores match Sleeper calculations', async () => {
  const results = await validateScores(['2024'], {
    weeks: [1, 2, 3], // Test first 3 weeks
    verbose: false
  });
  
  expect(results.summary.totalDifferences).toBe(0);
});
```

## Troubleshooting

### "Failed to fetch stats for 2024 week 3: 404"
- Week hasn't happened yet or data not available
- This is normal for future weeks

### "Player stats not found"
- Player has a score but no detailed stats
- Common for defense or special teams
- Validation skips these cases

### "Rate limit exceeded (429)"
- Too many API calls too quickly
- Increase delay: `--delay 200`

### Memory issues with large validations
- Process each season separately
- Validate specific weeks: `--weeks 1-4`

## Future Enhancements

Potential improvements to the validation script:

1. **Export Results** - Save differences to JSON file for analysis
2. **Historical Comparison** - Compare against previous validation runs
3. **Specific Player Mode** - Validate just one player across all weeks
4. **Stat-by-Stat Breakdown** - Show which specific stat causes the difference
5. **Auto-Fix Suggestions** - Suggest config changes to match Sleeper
6. **Performance Mode** - Parallel API calls with connection pooling
7. **Web Dashboard** - Visual report of validation results

## Questions?

If you find persistent differences that you can't resolve:
1. Check the raw stats output in the difference report
2. Manually verify the score calculation
3. Compare with Sleeper's league settings
4. Check for recent Sleeper API changes
