#!/usr/bin/env node

// Load .env file if present (no-op if the file doesn't exist)
import 'dotenv/config';

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
  evaluateTrade,
  getKtcRankings,
  getFantasyCalcRankings,
  getTrendingPlayers,
  getRecentTrades,
  getFreeAgents,
  getSiteLink,
} from './src/tools.js';

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
  'Evaluate a trade using KTC SF TE+ dynasty values. Provide lists of what you give and receive.',
  {
    giving: z
      .array(z.string())
      .min(1)
      .describe('Player names (and/or pick descriptions) you are giving away'),
    receiving: z
      .array(z.string())
      .min(1)
      .describe('Player names (and/or pick descriptions) you are receiving'),
  },
  wrapTool(({ giving, receiving }) => evaluateTrade(giving, receiving))
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
  'Get recent trade history for the league.',
  {
    weeks_back: z
      .number()
      .int()
      .min(1)
      .max(17)
      .optional()
      .describe('How many weeks back to look (default 4)'),
  },
  wrapTool(({ weeks_back }) => getRecentTrades(weeks_back))
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
