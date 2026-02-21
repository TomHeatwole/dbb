# Hwang Dynasty MCP Server

An MCP (Model Context Protocol) server for The Hwang Dynasty fantasy football league. Connect Claude or any MCP-compatible AI client to interact with live league data.

## What It Does

Exposes **14 tools** covering:

| Tool | Description |
|---|---|
| `get_standings` | Current season standings by total points |
| `get_weekly_scores` | All matchup scores for a given week |
| `get_all_teams` | List all teams with links |
| `get_roster` | Full roster + KTC/FC/FFB dynasty values |
| `get_team_scores` | Week-by-week record and scores for a team |
| `search_player` | Player lookup with dynasty values and current owner |
| `compare_players` | Side-by-side dynasty value comparison |
| `evaluate_trade` | Trade analyzer using KTC SF TE+ values |
| `get_ktc_rankings` | KTC rankings, optionally by position |
| `get_fantasycalc_rankings` | FantasyCalc rankings, optionally by position |
| `get_trending_players` | Top adds on Sleeper in the last 24 hours |
| `get_recent_trades` | League trade history |
| `get_free_agents` | Notable unowned players by dynasty value |
| `get_site_link` | Deep links to specific site pages |

## Setup

### 1. Install dependencies

```bash
cd mcp
npm install
```

### 2. Configure environment

The `.env` file is already configured. To update it, edit `mcp/.env`:

```env
# Paste the same REACT_APP_SITE_SETTINGS from site/.env.local
REACT_APP_SITE_SETTINGS='{"LEAGUE_ID":"...","PREVIOUS_YEARS":{...},...}'

# URL of the deployed site (for deep links in responses)
SITE_BASE_URL=https://hwangdynasty.com
```

### 3. Test it

```bash
npm start
# The server communicates over stdio — it's ready when no error appears.
```

Or run a quick smoke test:
```bash
node --input-type=module <<'EOF'
import './src/tools.js';
import { getAllTeams } from './src/tools.js';
console.log(await getAllTeams());
EOF
```

## Connecting to Claude Desktop

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "hwang-dynasty": {
      "command": "node",
      "args": ["/absolute/path/to/dbb/mcp/index.js"],
      "env": {
        "REACT_APP_SITE_SETTINGS": "{\"LEAGUE_ID\":\"1326575946462920704\",\"PREVIOUS_YEARS\":{\"2024\":\"1119869508891660288\",\"2025\":\"1194868087212167168\"},\"STARTER_POSITION_NAMES\":[\"QB1\",\"RB1\",\"RB2\",\"RB3\",\"WR1\",\"WR2\",\"WR3\",\"TE1\",\"FLEX1\",\"FLEX2\",\"SUPER\"],\"SEASON_START_DAY\":\"09/04\"}",
        "SITE_BASE_URL": "https://hwangdynasty.com"
      }
    }
  }
}
```

Then restart Claude Desktop. You'll see the tools listed when you start a new conversation.

## Data Sources

- **Sleeper API** — live rosters, matchup scores, transactions, trending players
- **`site/public/data/ktc_values.csv`** — KTC dynasty values (updated manually)
- **`site/public/data/fantasycalc.csv`** — FantasyCalc dynasty values (updated manually)
- **`site/public/data/ffb.csv`** — FFB rankings (updated manually)
- **`site/public/data/players.txt`** — Sleeper player database snapshot

The MCP server reads the CSV files directly from the filesystem (no Firebase needed). Sleeper API responses are cached in memory with short TTLs to avoid rate limiting.

## Adding New Tools

1. Add the implementation function to `src/tools.js`
2. Register it in `index.js` with `server.tool(name, description, schema, handler)`
