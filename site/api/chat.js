import {
  getStandings, getWeeklyScores, getAllTeams, getRoster, getTeamScores,
  searchPlayer, comparePlayers, evaluateTrade,
  getKtcRankings, getFantasyCalcRankings,
  getTrendingPlayers, getRecentTrades, getFreeAgents, getSiteLink,
  runScenario,
} from './mcp/tools.js';

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`;
const GEMINI_FLASH_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;

const SIDE_QUERY_PROBABILITY = 0.2; // 1 in 5

// ── Gemini tool declarations ──────────────────────────────────────────────────

const TOOL_DECLARATIONS = [
  {
    name: 'get_standings',
    description: 'Get standings for the Hwang Dynasty league. Supports historical seasons. Call this before making ANY claim about team records, rankings, or points totals. Do not guess standings.',
    parameters: {
      type: 'OBJECT',
      properties: { season: { type: 'INTEGER', description: 'Season year e.g. 2024, 2025. Omit for current season.' } },
    },
  },
  {
    name: 'get_weekly_scores',
    description: 'Get all matchup scores for a given NFL week. Supports historical seasons. Call this before stating any scores or matchup results.',
    parameters: {
      type: 'OBJECT',
      properties: {
        week: { type: 'INTEGER', description: 'NFL week number (1-17)' },
        season: { type: 'INTEGER', description: 'Season year e.g. 2024, 2025. Omit for current season.' },
      },
      required: ['week'],
    },
  },
  {
    name: 'get_all_teams',
    description: 'Get all team names and owner names in the Hwang Dynasty league. Supports historical seasons. Call this before answering ANY question about who owns a team, what teams exist, team nicknames, or league membership. Do not guess team or owner names — always call this first.',
    parameters: {
      type: 'OBJECT',
      properties: { season: { type: 'INTEGER', description: 'Season year e.g. 2024, 2025. Omit for current season.' } },
    },
  },
  {
    name: 'get_roster',
    description: "Get a team's actual roster with dynasty values (KTC, FantasyCalc, FFB). Supports historical seasons. Call this before making ANY claim about what players a team has. Never state a player is on a team without calling this first.",
    parameters: {
      type: 'OBJECT',
      properties: {
        team: { type: 'STRING', description: "Team name, owner name, or roster ID" },
        season: { type: 'INTEGER', description: 'Season year e.g. 2024, 2025. Omit for current season.' },
      },
      required: ['team'],
    },
  },
  {
    name: 'get_team_scores',
    description: "Get a team's week-by-week scores and record for a season. Supports historical seasons.",
    parameters: {
      type: 'OBJECT',
      properties: {
        team: { type: 'STRING', description: 'Team name, owner name, or roster ID' },
        season: { type: 'INTEGER', description: 'Season year e.g. 2024, 2025. Omit for current season.' },
      },
      required: ['team'],
    },
  },
  {
    name: 'search_player',
    description: 'Search for a player by name. Returns dynasty values (KTC, FantasyCalc, FFB) and current owner.',
    parameters: {
      type: 'OBJECT',
      properties: { name: { type: 'STRING', description: 'Player name e.g. "Justin Jefferson"' } },
      required: ['name'],
    },
  },
  {
    name: 'compare_players',
    description: 'Compare dynasty values for 2-8 players side by side.',
    parameters: {
      type: 'OBJECT',
      properties: {
        names: { type: 'ARRAY', items: { type: 'STRING' }, description: 'List of 2-8 player names' },
      },
      required: ['names'],
    },
  },
  {
    name: 'evaluate_trade',
    description: 'Evaluate a trade using KTC SF TE+ values. Provide what you give and receive.',
    parameters: {
      type: 'OBJECT',
      properties: {
        giving: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Players/picks you are giving' },
        receiving: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Players/picks you are receiving' },
      },
      required: ['giving', 'receiving'],
    },
  },
  {
    name: 'get_ktc_rankings',
    description: 'Get KTC dynasty rankings (SF TE+ format), optionally filtered by position.',
    parameters: {
      type: 'OBJECT',
      properties: {
        position: { type: 'STRING', enum: ['QB', 'RB', 'WR', 'TE', 'K'], description: 'Filter by position (optional)' },
        top_n: { type: 'INTEGER', description: 'Number of players to return (default 25, max 100)' },
      },
    },
  },
  {
    name: 'get_fantasycalc_rankings',
    description: 'Get FantasyCalc dynasty rankings, optionally filtered by position.',
    parameters: {
      type: 'OBJECT',
      properties: {
        position: { type: 'STRING', enum: ['QB', 'RB', 'WR', 'TE', 'K'], description: 'Filter by position (optional)' },
        top_n: { type: 'INTEGER', description: 'Number of players to return (default 25, max 100)' },
      },
    },
  },
  {
    name: 'get_trending_players',
    description: 'Get top trending players on Sleeper (most added in the last 24 hours across the platform).',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_recent_trades',
    description: 'Get trade history for the Hwang Dynasty league. Supports historical seasons — for past seasons returns all trades for the full year.',
    parameters: {
      type: 'OBJECT',
      properties: {
        weeks_back: { type: 'INTEGER', description: 'How many weeks back to look for current season (default 4, max 17). Ignored for historical seasons.' },
        season: { type: 'INTEGER', description: 'Season year e.g. 2024, 2025. Omit for current season.' },
      },
    },
  },
  {
    name: 'get_free_agents',
    description: "Get notable free agents not on any roster, sorted by KTC dynasty value.",
    parameters: {
      type: 'OBJECT',
      properties: {
        position: { type: 'STRING', enum: ['QB', 'RB', 'WR', 'TE', 'K'], description: 'Filter by position (optional)' },
      },
    },
  },
  {
    name: 'get_site_link',
    description: 'Get a direct link to a page on the Hwang Dynasty site (home, standings, scores, playoffs, trades, h2h, team).',
    parameters: {
      type: 'OBJECT',
      properties: {
        page: { type: 'STRING', description: 'Page name: home, standings, scores, playoffs, trades, h2h, scenarios, notes, team' },
        team: { type: 'STRING', description: 'Team name/owner — only when page is "team"' },
        week: { type: 'INTEGER', description: 'Week number — only when page is "scores"' },
      },
      required: ['page'],
    },
  },
  {
    name: 'run_scenario',
    description: 'Simulate "what if" roster changes for a completed season (2024 or 2025). Given hypothetical adds/drops on any team(s), recomputes all 17 weeks using optimal lineups and shows how standings would have changed. Use this whenever someone asks "what if [team] had [player]", "what would standings look like if [trade] happened", or any hypothetical about roster composition affecting season results.',
    parameters: {
      type: 'OBJECT',
      properties: {
        season: { type: 'INTEGER', description: 'Season year: 2024 or 2025' },
        changes: {
          type: 'ARRAY',
          description: 'List of roster changes to simulate',
          items: {
            type: 'OBJECT',
            properties: {
              team:  { type: 'STRING', description: 'Team or owner name whose roster to modify' },
              add:   { type: 'ARRAY', items: { type: 'STRING' }, description: 'Player names to add to this team' },
              drop:  { type: 'ARRAY', items: { type: 'STRING' }, description: 'Player names to drop from this team' },
            },
            required: ['team'],
          },
        },
      },
      required: ['season', 'changes'],
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(name, args) {
  try {
    switch (name) {
      case 'get_standings':          return await getStandings(args.season);
      case 'get_weekly_scores':      return await getWeeklyScores(args.week, args.season);
      case 'get_all_teams':          return await getAllTeams(args.season);
      case 'get_roster':             return await getRoster(args.team, args.season);
      case 'get_team_scores':        return await getTeamScores(args.team, args.season);
      case 'search_player':          return await searchPlayer(args.name);
      case 'compare_players':        return await comparePlayers(args.names);
      case 'evaluate_trade':         return await evaluateTrade(args.giving, args.receiving);
      case 'get_ktc_rankings':       return getKtcRankings(args.position, args.top_n);
      case 'get_fantasycalc_rankings': return getFantasyCalcRankings(args.position, args.top_n);
      case 'get_trending_players':   return await getTrendingPlayers();
      case 'get_recent_trades':      return await getRecentTrades(args.weeks_back, args.season);
      case 'get_free_agents':        return await getFreeAgents(args.position);
      case 'get_site_link':          return await getSiteLink(args.page, { team: args.team, week: args.week });
      case 'run_scenario':           return await runScenario({ season: args.season, changes: args.changes });
      default: return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Tool error (${name}): ${err.message}`;
  }
}

// ── Side query (Chinese characters) ──────────────────────────────────────────

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHINESE_PROMPT_PATH = join(__dirname, '..', 'public', 'data', 'chinese_characters_prompt.txt');

let _chinesePromptCache = null;
function loadChinesePrompt() {
  if (!_chinesePromptCache) {
    _chinesePromptCache = readFileSync(CHINESE_PROMPT_PATH, 'utf8');
  }
  return _chinesePromptCache;
}

async function fetchChineseCharacters(userMessage, apiKey) {
  try {
    const res = await fetch(`${GEMINI_FLASH_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: loadChinesePrompt() }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || null;
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { messages, systemPrompt } = body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  // Decide whether to fire the side query this turn
  const doSideQuery = Math.random() < SIDE_QUERY_PROBABILITY;
  const lastUserMessage = messages[messages.length - 1]?.content || '';
  const sideQueryPromise = doSideQuery
    ? fetchChineseCharacters(lastUserMessage, apiKey)
    : Promise.resolve(null);

  // Build the conversation history for Gemini
  let contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const requestBase = {
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
  };

  // Tool-calling loop (max 5 rounds to prevent runaway loops)
  for (let round = 0; round < 5; round++) {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBase, contents }),
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.json().catch(() => ({}));
      return res.status(geminiRes.status).json({ error: 'Gemini API error', details: err });
    }

    const data = await geminiRes.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Collect any function calls in this response
    const functionCalls = parts.filter(p => p.functionCall);

    if (functionCalls.length === 0) {
      // No tool calls — extract the text response and stitch side query if present
      let text = parts.find(p => p.text)?.text || '';
      const sideResult = await sideQueryPromise;
      if (sideResult) {
        text += `\n\n---\n\n${sideResult}`;
      }
      return res.status(200).json({ message: text });
    }

    // Execute all requested tools (potentially in parallel)
    const toolResults = await Promise.all(
      functionCalls.map(async ({ functionCall: { name, args } }) => ({
        name,
        result: await executeTool(name, args || {}),
      }))
    );

    // Append model's function call turn and tool results to conversation
    contents.push({ role: 'model', parts: functionCalls.map(p => ({ functionCall: p.functionCall })) });
    contents.push({
      role: 'user',
      parts: toolResults.map(({ name, result }) => ({
        functionResponse: {
          name,
          response: { result: typeof result === 'string' ? result : JSON.stringify(result) },
        },
      })),
    });
  }

  // Fallback if we hit the loop limit without a text response
  const sideResult = await sideQueryPromise;
  let fallback = 'Sorry, I ran into an issue generating a response. Please try again.';
  if (sideResult) {
    fallback += `\n\n---\n\n${sideResult}`;
  }
  return res.status(200).json({ message: fallback });
}
