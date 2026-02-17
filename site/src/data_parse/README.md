# Fantasy Scoring Data Parser

A flexible, schema-driven fantasy football scoring system that calculates fantasy points from NFL player statistics.

## Features

- **Multiple Scoring Formats**: Standard, PPR, Half-PPR, 6pt Passing TD, Kicker, Defense/ST, IDP
- **Custom Scoring Configs**: Create your own scoring rules
- **Season Stats**: Load and process player statistics by season
- **Player Lookup**: Find players by Player ID or GSIS ID
- **Points Breakdown**: Detailed breakdown by category (passing, rushing, receiving, etc.)
- **Per-Game Averages**: Calculate fantasy points per game
- **Top Players**: Get ranked lists by position and fantasy points

## Installation

```bash
npm install
```

## Usage

### Basic Usage

```javascript
import { FantasyScoring } from './data_parse/index.js';

// Create a new instance
const fs = new FantasyScoring('/data/');

// Calculate fantasy points using the site's default config (from score_format.json)
const result = await fs.calculateForPlayer('6462', 2024);

// Or use a predefined config
const result2 = await fs.calculateForPlayer('6462', 2024, 'ppr');

console.log(result);
// {
//   success: true,
//   playerId: '6462',
//   player_name: 'Aaron Rodgers',
//   position: 'QB',
//   team: 'NYJ',
//   season: 2024,
//   games: 17,
//   fantasy_points: 256.58,
//   fantasy_points_per_game: 15.09,
//   breakdown: { ... },
//   config_name: 'PPR (Point Per Reception)'
// }
```

### Using Different Scoring Configs

```javascript
// Standard scoring
const standard = await fs.calculateForPlayer('6462', 2024, 'standard');

// PPR scoring
const ppr = await fs.calculateForPlayer('6462', 2024, 'ppr');

// Half PPR
const halfPPR = await fs.calculateForPlayer('6462', 2024, 'halfPPR');

// 6pt passing TD with bonuses
const sixPt = await fs.calculateForPlayer('6462', 2024, 'sixPointPassingTD');
```

### Calculate by GSIS ID

```javascript
const result = await fs.calculateForGsisId('00-0023459', 2024, 'ppr');
```

### Get Top Players

```javascript
// Top 10 players overall
const topPlayers = await fs.getTopPlayers(2024, 'ppr', { limit: 10 });

// Top 5 QBs
const topQBs = await fs.getTopPlayers(2024, 'ppr', { 
  position: 'QB',
  limit: 5 
});

// Top 20 RBs in standard scoring
const topRBs = await fs.getTopPlayers(2024, 'standard', {
  position: 'RB',
  limit: 20
});
```

### Custom Scoring Config

```javascript
import { createCustomConfig } from './data_parse/index.js';

const myConfig = createCustomConfig(
  'My League Rules',
  {
    passing_yards: 0.05,        // 1 pt per 20 yards
    passing_tds: 6,             // 6pt passing TDs
    passing_interceptions: -3,  // -3 per INT
    rushing_yards: 0.1,
    rushing_tds: 6,
    receiving_yards: 0.1,
    receiving_tds: 6,
    receptions: 1
  },
  {
    passing_300_bonus: 5,       // 5 pt bonus for 300+ yards
    rushing_100_bonus: 3,       // 3 pt bonus for 100+ yards
    receiving_100_bonus: 3
  }
);

const result = await fs.calculateForPlayer('6462', 2024, myConfig);
```

### Position-Specific Scoring (TE Premium)

```javascript
// Use the built-in TE Premium config
const result = await fs.calculateForPlayer('tePlayerId', 2024, 'tePremium');

// Or create a custom position-specific config
const customTEPremium = {
  name: 'Custom TE Premium',
  scoring: {
    passing_yards: 0.04,
    passing_tds: 4,
    rushing_yards: 0.1,
    rushing_tds: 6,
    receiving_yards: 0.1,
    receiving_tds: 6,
    receptions: 0.5  // Default for positions not specified below
  },
  position_specific_scoring: {
    receptions: {
      TE: 2.0,   // 2 PPR for TEs
      WR: 1.0,   // 1 PPR for WRs
      RB: 0.5    // 0.5 PPR for RBs
    },
    receiving_yards: {
      TE: 0.15   // Bonus for TE receiving yards
    }
  },
  bonuses: {}
};

const result = await fs.calculateForPlayer('6462', 2024, customTEPremium);
```

## Available Scoring Configs

### Standard
- Passing: 0.04 pts/yard (1 pt per 25 yards), 4 pts/TD
- Rushing: 0.1 pts/yard (1 pt per 10 yards), 6 pts/TD
- Receiving: 0.1 pts/yard, 6 pts/TD, 0 pts/reception
- Fumbles: -2 pts per fumble lost

### PPR (Point Per Reception)
- Same as Standard, but 1 point per reception

### Half PPR
- Same as Standard, but 0.5 points per reception

### 6pt Passing TD
- PPR scoring with 6 pts per passing TD instead of 4
- Includes yardage bonuses (300+, 400+, 100+ rushing/receiving)

### TE Premium
- PPR scoring with position-specific reception points
- TEs get 1.5 points per reception
- WRs and RBs get 1.0 point per reception
- Perfect for leagues that value tight ends more highly

### Kicker
- 3 pts per FG, 1 pt per PAT
- Bonus points for 50+ yard FGs
- Penalties for misses

### Defense/Special Teams
- Points for sacks, interceptions, fumbles, TDs, safeties

### IDP (Individual Defensive Player)
- Detailed defensive stats including tackles, assists, TFL, etc.

## API Reference

### FantasyScoring Class

#### `constructor(basePath = '/data/')`
Creates a new FantasyScoring instance.

#### `async init()`
Initializes by loading players data. Called automatically when needed.

#### `async loadSeasonStats(season)`
Loads stats for a specific season (cached).
- **season**: Year (e.g., 2024, 2025)

#### `async calculateForPlayer(playerId, season, config = 'ppr')`
Calculate fantasy points for a player by their Player ID.
- **playerId**: Player ID from players.txt
- **season**: Year
- **config**: Scoring config name or custom config object

#### `async calculateForGsisId(gsisId, season, config = 'ppr')`
Calculate fantasy points for a player by their GSIS ID.
- **gsisId**: GSIS ID (e.g., "00-0023459")
- **season**: Year
- **config**: Scoring config name or custom config object

#### `async getTopPlayers(season, config = 'ppr', options = {})`
Get top players sorted by fantasy points.
- **season**: Year
- **config**: Scoring config name or custom config object
- **options**: `{ limit, position }`

### Utility Functions

#### `calculateFantasyPoints(playerStats, config)`
Calculate fantasy points from a stats object.

#### `calculateFantasyPointsPerGame(playerStats, config)`
Calculate average fantasy points per game.

#### `getFantasyPointsBreakdown(playerStats, config)`
Get detailed breakdown of points by category.

## Data Structure

### Scoring Config Schema

The scoring configuration supports:

1. **Basic Scoring** - Map stat names to point values
2. **Position-Specific Scoring** - Override points for specific positions
3. **Bonuses** - Milestone-based bonus points

```json
{
  "name": "League Name",
  "scoring": {
    "passing_yards": 0.04,
    "receptions": 1
  },
  "position_specific_scoring": {
    "receptions": {
      "TE": 1.5,
      "WR": 1.0,
      "RB": 1.0
    }
  },
  "bonuses": {
    "passing_300_bonus": 3
  }
}
```

**Position-specific scoring rules:**
- If a player's position has an override, use that value
- Otherwise, fall back to the default value in `scoring`
- If no position is provided, use the default value
- Any stat can have position-specific overrides

### CSV Files
Located at: `public/data/stats_player_reg_{YEAR}.csv`

Contains columns like:
- `player_id` (GSIS ID)
- `player_display_name`, `position`, `recent_team`, `games`
- Passing: `passing_yards`, `passing_tds`, `passing_interceptions`, etc.
- Rushing: `rushing_yards`, `rushing_tds`, `rushing_fumbles_lost`, etc.
- Receiving: `receptions`, `receiving_yards`, `receiving_tds`, etc.
- Defense: `def_sacks`, `def_interceptions`, `def_tds`, etc.
- Kicking: `fg_made`, `fg_att`, `pat_made`, etc.

**Important:** The `position` field is used for position-specific scoring.

### players.txt
Located at: `public/data/players.txt`

JSON file with player data including `gsis_id` field for joining with CSV stats.

## Testing

Run unit tests:
```bash
npm test
```

Run specific test file:
```bash
npm test fantasyCalculator.test.js
```

## Examples

See the test files for more examples:
- `fantasyCalculator.test.js` - Scoring calculations
- `playerStatsLoader.test.js` - Data loading
- `integration.test.js` - End-to-end scenarios

## Notes

- Stats in the CSV files are **season aggregates**, not per-week
- All point calculations are rounded to 2 decimal places
- GSIS IDs may have leading/trailing spaces (handled automatically)
- Season stats are cached for performance
- **Position-specific scoring** allows any stat to have different values per position
- Position is determined from the `position` field in player stats
- If position is missing or not in the override map, the default scoring value is used
