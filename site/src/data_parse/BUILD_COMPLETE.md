# ✅ Score Validation System - COMPLETE

## What Was Built

A comprehensive validation system to compare fantasy scores from two sources:
1. **Sleeper API pre-calculated scores** (what powers your site)
2. **Locally calculated scores** (from your new CSV-based scoring system)

## Files Created

### Core System (3 files)
1. **`validate_scores_data.js`** (13 KB) - Main validation logic
2. **`weeklyStatsLoader.js`** (2.4 KB) - Fetches & caches weekly stats from Sleeper
3. **`validateScoresData.test.js`** (5.2 KB) - Comprehensive test suite

### Runner Scripts (2 files)
4. **`run_validation.js`** (2.9 KB) - Command-line interface (executable)
5. **`quick_validate.sh`** (3.5 KB) - Bash convenience wrapper (executable)

### Documentation (4 files)
6. **`VALIDATION_README.md`** - Comprehensive user guide
7. **`VALIDATION_FILES.md`** - Technical file documentation
8. **`README.md`** - Updated main README with validation info
9. **This file** - Quick reference & completion summary

### Examples (1 file)
10. **`validation_examples.js`** (6.3 KB) - 6 example use cases

## Quick Start

### 1. Fastest Test (Week 1 only)
```bash
cd site/src/data_parse
./quick_validate.sh quick
```

### 2. Full Validation (Both Seasons)
```bash
./quick_validate.sh both
```

### 3. Debug Mode (Stop on First Difference)
```bash
node run_validation.js 2024 --stop-on-diff
```

## How It Works

```
For each rostered player, for each week (2024 & 2025):

┌─────────────────────────────────────────────┐
│  1. Get Sleeper's Pre-calculated Score      │
│     (from matchup data)                     │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  2. Fetch Weekly Stats from Sleeper         │
│     (raw NFL stats)                         │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  3. Map Stat Fields                         │
│     (rec → receptions, etc.)                │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  4. Calculate Score Using score_format.json │
│     (your scoring config)                   │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  5. Compare & Report Differences            │
│     (> 0.5 points)                          │
└─────────────────────────────────────────────┘
```

## What It Validates

✅ **Passing stats** - yards, TDs, INTs, 2PT conversions  
✅ **Rushing stats** - yards, TDs, fumbles, 2PT conversions  
✅ **Receiving stats** - receptions, yards, TDs, 2PT conversions  
✅ **Kicking stats** - FG made/missed, XP made/missed, distance bonuses  
✅ **Defense stats** - sacks, INTs, fumbles, TDs, safeties  
✅ **Position-specific scoring** - TE premium (0.5 PPR for TEs)  
✅ **Bonuses** - 100-yard receiving/rushing, 300-yard passing, etc.  

## Sample Output

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
  Week 3... ✗ 196/198 validated (2 diff)

    ⚠️  DIFFERENCES FOUND IN 2024 WEEK 3:
    ─────────────────────────────────────────────────
    Player: Travis Kelce (TE) [ID: 4881]
    Sleeper Score: 14.3
    Calculated Score: 14.8
    Difference: +0.5
    Raw Stats: {"rec":5,"rec_yd":45,"rec_td":1}
    ─────────────────────────────────────────────────

═══════════════════════════════════════════════════════════
  VALIDATION SUMMARY
═══════════════════════════════════════════════════════════
Total Validations: 6,534
Matches: 6,532 (99.97%)
Differences: 2 (0.03%)
Errors: 0
═══════════════════════════════════════════════════════════
```

## Common Use Cases

### 1. Verify Scoring Config Matches Sleeper
```bash
node run_validation.js 2024 --weeks 1-4
```

### 2. Quick Smoke Test
```bash
./quick_validate.sh quick
```

### 3. Debug Specific Differences
```bash
node run_validation.js 2024 --stop-on-diff
```

### 4. CI/CD Integration
```bash
# In your test script
npm test validateScoresData.test.js
```

### 5. Programmatic Use
```javascript
import { validateScores } from './validate_scores_data.js';

const results = await validateScores(['2024'], {
  weeks: [1, 2, 3],
  verbose: false
});

if (results.summary.totalDifferences > 0) {
  console.error('Scoring mismatch detected!');
}
```

## Performance

**Full validation (2024 + 2025, all weeks):**
- ~8,160 API calls
- ~13 minutes with 100ms delay (default)
- ~27 minutes with 200ms delay (safer)
- Re-runs use cache: < 1 second

**Quick test (week 1 only):**
- ~30-60 seconds

## Key Features

✨ **Automatic stat field mapping** - Handles Sleeper API → score_format.json differences  
✨ **Position-aware** - Correctly applies TE premium and other position-specific rules  
✨ **Smart caching** - Avoids redundant API calls  
✨ **Rate limiting** - Built-in delays to respect API limits  
✨ **Detailed reporting** - Shows exact differences with raw stats  
✨ **Multiple modes** - CLI, programmatic, test suite  
✨ **Well documented** - 3 comprehensive README files  

## Troubleshooting

### Differences Found?

1. **Check stat mappings** - Update `STAT_FIELD_MAPPING` in validate_scores_data.js
2. **Verify position** - Ensure TE premium is working correctly
3. **Check bonuses** - 100-yard bonuses, etc. in score_format.json
4. **Rounding** - Sleeper may round differently (< 0.5 is ignored)

### Rate Limit Hit?

```bash
# Increase delay between calls
node run_validation.js 2024 --delay 200
```

### Need More Info?

```bash
# See comprehensive docs
cat VALIDATION_README.md

# See technical details
cat VALIDATION_FILES.md

# See examples
node validation_examples.js
```

## Testing

```bash
# Run test suite
npm test validateScoresData.test.js

# Run specific test
npm test -- -t "should fetch weekly stats"
```

## Next Steps

### Immediate
1. Run a quick test: `./quick_validate.sh quick`
2. Review any differences found
3. Update stat mappings if needed

### Ongoing
1. Run validation after scoring config changes
2. Include in CI/CD pipeline
3. Monitor for Sleeper API changes

### Future Enhancements
- [ ] Export results to JSON/CSV
- [ ] Web dashboard for results
- [ ] Automated alerts on differences
- [ ] Historical comparison tracking
- [ ] Stat-by-stat breakdown in differences
- [ ] Auto-suggest config fixes

## Documentation

- **User Guide**: [VALIDATION_README.md](./VALIDATION_README.md)
- **Technical Docs**: [VALIDATION_FILES.md](./VALIDATION_FILES.md)
- **Main README**: [README.md](./README.md)
- **Examples**: [validation_examples.js](./validation_examples.js)

## Summary

✅ **Complete validation system built and tested**  
✅ **Compares Sleeper scores vs calculated scores**  
✅ **Validates all rostered players across all weeks**  
✅ **Identifies and reports differences with full context**  
✅ **Multiple interfaces (CLI, programmatic, tests)**  
✅ **Comprehensive documentation**  
✅ **Ready to use immediately**  

## Usage Examples

```bash
# Quick test
./quick_validate.sh quick

# Full 2024 season
./quick_validate.sh 2024

# Stop on first difference (for debugging)
node run_validation.js 2024 --stop-on-diff

# Specific weeks
node run_validation.js 2024 --weeks 1-4

# Both seasons
node run_validation.js 2024 2025

# Custom delay (slower = safer for API)
node run_validation.js 2024 --delay 200
```

---

**🎉 System is ready to use! Start with `./quick_validate.sh quick` to test it out.**
