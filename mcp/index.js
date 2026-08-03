#!/usr/bin/env node

// Load .env file if present (no-op if the file doesn't exist).
// Must be the first import so env vars exist before src/config.js evaluates.
import './env.js';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  getStandings,
  getWeeklyScores,
  getAllTeams,
  getRoster,
  getTeamScores,
  searchPlayer,
  comparePlayers,
  getKtcRankings,
  getFantasyCalcRankings,
  getTrendingPlayers,
  getRecentTrades,
  getFreeAgents,
  getSiteLink,
  getLeagueInfo,
  resolveTeam,
  simulateTradeReversal,
  simulateRosterChange,
  getHistoricalResults,
} from './src/tools.js';

// Hwang value engine + season simulator — shared with the site's HwangAI tools
// (single implementation in site/lib/mcp; DATA_DIR resolves module-relative).
import {
  evaluateTrade,
  getPlayerValueBreakdown,
  getTeamValueSummary,
  getSeasonOdds,
  simulateRosterChangeOdds,
  lookupDraftPick,
  getPlayerStats,
} from '../site/lib/mcp/tools.mjs';
import { MCP_TOOL_RENDER_MODE } from '../site/lib/mcp/renderConfig.mjs';

// ── Server setup ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'dbb-mcp',
  version: '1.0.0',
  description:
    'MCP server for The Hwang Dynasty fantasy football league. ' +
    'Provides standings, scores, rosters, dynasty values, trade evaluation, and site deep links.',
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function wrapTool(fn) {
  return async (args) => {
    try {
      const result = await fn(args);
      return textResult(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    } catch (err) {
      return textResult(`❌ Error: ${err.message}`);
    }
  };
}

// ── Tools ─────────────────────────────────────────────────────────────────────

server.tool(
  'get_standings',
  'Get current season standings for the Hwang Dynasty league, sorted by total points scored.',
  {},
  wrapTool(() => getStandings())
);

server.tool(
  'get_weekly_scores',
  'Get all matchup scores for a given NFL week.',
  { week: z.number().int().min(1).max(17).describe('NFL week number (1–17)') },
  wrapTool(({ week }) => getWeeklyScores(week))
);

server.tool(
  'get_all_teams',
  'List all teams in the league with their owner names and links to their team pages.',
  {},
  wrapTool(() => getAllTeams())
);

server.tool(
  'get_roster',
  "Get a team's full roster including player dynasty values (KTC, FantasyCalc, FFB).",
  { team: z.string().describe("Team name, owner name, or roster ID (e.g. 'Hwang', 'Team Hwan', '4')") },
  wrapTool(({ team }) => getRoster(team))
);

server.tool(
  'get_team_scores',
  "Get a team's week-by-week scores and record for the current season.",
  { team: z.string().describe('Team name, owner name, or roster ID') },
  wrapTool(({ team }) => getTeamScores(team))
);

server.tool(
  'search_player',
  'Search for a player by name. Returns their dynasty values (KTC, FantasyCalc, FFB) and current owner.',
  { name: z.string().describe('Player name (e.g. "Justin Jefferson", "Lamar Jackson")') },
  wrapTool(({ name }) => searchPlayer(name))
);

server.tool(
  'compare_players',
  'Compare dynasty values for multiple players side by side.',
  {
    names: z
      .array(z.string())
      .min(2)
      .max(8)
      .describe('List of 2–8 player names to compare'),
  },
  wrapTool(({ names }) => comparePlayers(names))
);

server.tool(
  'evaluate_trade',
  'Evaluate a trade with the Hwang value engine. Returns per-asset values in the chosen value model, a consolidation Value Adjustment for uneven packages, a verdict, and totals across all major value models (KTC TE+, Hwang Market, Hwang True, Competitor Adj, Rebuild Adj).',
  {
    giving: z
      .array(z.string())
      .min(1)
      .describe('Player names (and/or pick descriptions) you are giving away'),
    receiving: z
      .array(z.string())
      .min(1)
      .describe('Player names (and/or pick descriptions) you are receiving'),
    value_source: z
      .enum([
        'ktc_sf', 'ktc_sf_tep', 'hwang_market_value', 'hwang_true_value',
        'competitor_adjusted', 'rebuilder_adjusted',
        'hwang_competitor_adjusted', 'hwang_rebuilder_adjusted',
        'fantasycalc', 'ffb',
      ])
      .optional()
      .describe('Primary value model (default hwang_true_value). Use competitor_adjusted for a win-now team, rebuilder_adjusted for a rebuild.'),
  },
  wrapTool(({ giving, receiving, value_source }) => evaluateTrade(giving, receiving, value_source, MCP_TOOL_RENDER_MODE))
);

server.tool(
  'get_player_value',
  "Get one player's value across ALL value models at once (KTC SF/TE+, Hwang Market, Hwang True, Competitor/Rebuild adjusted, FantasyCalc, FFB) with positional and overall ranks, age, and 30-day market trend.",
  { name: z.string().describe('Player name e.g. "Brock Bowers"') },
  wrapTool(({ name }) => getPlayerValueBreakdown(name, MCP_TOOL_RENDER_MODE))
);

server.tool(
  'get_team_value_summary',
  'Roster construction report for a team: total value across models, league value rank, positional value breakdown with top assets and ages, value-weighted roster age, and a competitor-vs-rebuild timeline lean. Includes a league-wide value board.',
  { team: z.string().describe('Team name, owner name, or roster ID') },
  wrapTool(({ team }) => getTeamValueSummary(team, MCP_TOOL_RENDER_MODE))
);

server.tool(
  'get_season_odds',
  'Monte Carlo simulation of the upcoming/current season with real rosters: rolls each player\'s season outcome from historical seasons of similar-ADP players, scores optimal best-ball lineups for all 17 weeks, and returns title/playoff/top-3 odds, average finish, and average points for every team.',
  {
    iterations: z
      .number()
      .int()
      .min(250)
      .max(3000)
      .optional()
      .describe('Number of simulation runs (default 1000)'),
  },
  wrapTool(({ iterations }) => getSeasonOdds(iterations))
);

server.tool(
  'simulate_roster_change_odds',
  'Simulate how hypothetical roster changes for the UPCOMING season shift each team\'s title and playoff odds vs the baseline (paired rolls isolate the change). For a trade, express BOTH sides: add players to the receiving team and drop them from the sending team.',
  {
    changes: z
      .array(
        z.object({
          team: z.string().describe('Team or owner name whose roster to modify'),
          add: z.array(z.string()).optional().describe('Player names to add to this team'),
          drop: z.array(z.string()).optional().describe('Player names to drop from this team'),
        })
      )
      .min(1)
      .describe('List of roster changes to simulate'),
    iterations: z
      .number()
      .int()
      .min(250)
      .max(3000)
      .optional()
      .describe('Number of simulation runs (default 1000)'),
  },
  wrapTool(({ changes, iterations }) => simulateRosterChangeOdds({ changes, iterations }))
);

server.tool(
  'lookup_draft_pick',
  'Look up the KTC dynasty value of a draft pick by year and round. Returns all three tiers (Early/Mid/Late) when no tier is specified, along with how many years until the draft.',
  {
    name: z
      .string()
      .describe('Pick description e.g. "2027 1st", "2027 early first", "2028 2nd round"'),
  },
  wrapTool(({ name }) => lookupDraftPick(name))
);

server.tool(
  'get_player_stats',
  "Get a player's NFL regular season stats (passing, rushing, receiving) and fantasy points for a given season (2005–2025). Fantasy points are standard 0-PPR; TE stats also show TEP-adjusted totals.",
  {
    name: z.string().describe('Player full name e.g. "Justin Jefferson"'),
    season: z
      .number()
      .int()
      .optional()
      .describe('NFL season year e.g. 2024, 2025. Omit for most recent complete season.'),
  },
  wrapTool(({ name, season }) => getPlayerStats(name, season))
);

server.tool(
  'get_ktc_rankings',
  'Get KTC dynasty rankings (SF TE+ format), optionally filtered by position.',
  {
    position: z
      .enum(['QB', 'RB', 'WR', 'TE', 'K'])
      .optional()
      .describe('Filter by position (optional)'),
    top_n: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Number of players to return (default 25)'),
  },
  wrapTool(({ position, top_n }) => getKtcRankings(position, top_n))
);

server.tool(
  'get_fantasycalc_rankings',
  'Get FantasyCalc dynasty rankings, optionally filtered by position.',
  {
    position: z
      .enum(['QB', 'RB', 'WR', 'TE', 'K'])
      .optional()
      .describe('Filter by position (optional)'),
    top_n: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Number of players to return (default 25)'),
  },
  wrapTool(({ position, top_n }) => getFantasyCalcRankings(position, top_n))
);

server.tool(
  'get_trending_players',
  'Get the top trending players on Sleeper (most added in the last 24 hours across the platform).',
  {},
  wrapTool(() => getTrendingPlayers())
);

server.tool(
  'get_recent_trades',
  'Get trade history for the league. Supports historical seasons — for past seasons returns all trades for the full year. During the offseason, defaults to the most recent completed season.',
  {
    weeks_back: z
      .number()
      .int()
      .min(1)
      .max(17)
      .optional()
      .describe('How many weeks back to look for current season (default 4, max 17). Ignored for historical seasons.'),
    season: z
      .number()
      .int()
      .optional()
      .describe('Season year e.g. 2024, 2025. Omit for current/most recent season.'),
  },
  wrapTool(({ weeks_back, season }) => getRecentTrades(weeks_back, season))
);

server.tool(
  'get_free_agents',
  "Get notable free agents (players not on any team's roster), sorted by KTC dynasty value.",
  {
    position: z
      .enum(['QB', 'RB', 'WR', 'TE', 'K'])
      .optional()
      .describe('Filter by position (optional)'),
  },
  wrapTool(({ position }) => getFreeAgents(position))
);

server.tool(
  'simulate_trade_reversal',
  'Simulate reversing a trade: shows what the final standings would have looked like if two teams had never made a specific trade. Uses optimal lineups for all 17 weeks.',
  {
    season: z
      .string()
      .describe('Season year to simulate (e.g. "2025", "2024"). Must be a completed past season.'),
    team_a: z
      .string()
      .describe('Name or owner of the first team in the trade'),
    players_team_a_gave: z
      .array(z.string())
      .min(1)
      .describe('Player names that team_a traded away (and would get back in the reversal)'),
    team_b: z
      .string()
      .describe('Name or owner of the second team in the trade'),
    players_team_b_gave: z
      .array(z.string())
      .min(1)
      .describe('Player names that team_b traded away (and would get back in the reversal)'),
  },
  wrapTool(({ season, team_a, players_team_a_gave, team_b, players_team_b_gave }) =>
    simulateTradeReversal(season, team_a, players_team_a_gave, team_b, players_team_b_gave)
  )
);

server.tool(
  'simulate_roster_change',
  'Simulate arbitrary roster changes for a past season and see how the final standings would have changed. Use this for "what if" questions like: what if a team had picked up a certain free agent, or never dropped a player.',
  {
    season: z
      .string()
      .describe('Season year to simulate (e.g. "2025", "2024"). Must be a completed past season.'),
    changes: z
      .array(
        z.object({
          team:   z.string().describe('Team name or owner name'),
          add:    z.array(z.string()).optional().describe('Player names to add to this roster'),
          remove: z.array(z.string()).optional().describe('Player names to remove from this roster'),
        })
      )
      .min(1)
      .describe('List of roster changes to apply'),
  },
  wrapTool(({ season, changes }) => simulateRosterChange(season, changes))
);

server.tool(
  'resolve_team',
  "Resolve a person's first name or nickname to their Hwang Dynasty team. Use this when a user refers to a team owner by name and you're not sure which team they mean.",
  { name: z.string().describe('First name, nickname, or any identifier to look up') },
  wrapTool(({ name }) => resolveTeam(name))
);

server.tool(
  'get_league_info',
  'Get general information about the Hwang Dynasty league — scoring rules, team list, playoff format, history, and lore. Call this first when answering general questions about the league.',
  {},
  wrapTool(() => getLeagueInfo())
);

server.tool(
  'get_historical_results',
  'Get the final standings and playoff results for a completed past season. Returns regular-season totals (weeks 1–14) used for seeding, full playoff bracket matchups with exact scores, and final placement for all teams. The top 4 teams are ordered by their PLAYOFF performance (not regular season) — 1st place is the actual champion who won the playoff bracket, not just the highest regular-season scorer.',
  {
    season: z
      .string()
      .describe('The season year to look up (e.g. "2024" or "2025"). Must be a completed past season.'),
  },
  wrapTool(({ season }) => getHistoricalResults(season))
);

server.tool(
  'get_site_link',
  'Get a direct link to a specific page on the Hwang Dynasty site.',
  {
    page: z
      .enum(['home', 'standings', 'scores', 'playoffs', 'trades', 'h2h', 'scenarios', 'notes', 'team'])
      .describe('Which page to link to'),
    team: z
      .string()
      .optional()
      .describe('Team name or owner name — only used when page is "team"'),
    week: z
      .number()
      .int()
      .min(1)
      .max(17)
      .optional()
      .describe('Week number — only used when page is "scores"'),
  },
  wrapTool(({ page, team, week }) => getSiteLink(page, { team, week }))
);

// ── Connect ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
