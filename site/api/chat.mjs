import {
  getStandings, getWeeklyScores, getAllTeams, getRoster, getTeamScores,
  searchPlayer, comparePlayers, evaluateTrade, lookupDraftPick,
  getKtcRankings, getFantasyCalcRankings,
  getTrendingPlayers, getRecentTrades, getFreeAgents, getSiteLink,
  runScenario, getPlayerStats, getHistoricalResults,
  getPlayerValueBreakdown, getTeamValueSummary,
  getSeasonOdds, simulateRosterChangeOdds,
  loadCompletedTrades,
} from '../lib/mcp/tools.mjs';
import { CHAT_TOOL_RENDER_MODE } from '../lib/mcp/renderConfig.mjs';
import { loadPlayersData, loadOwnerAliasesByRoster } from '../lib/mcp/dataLoader.mjs';
import { CURRENT_YEAR } from '../lib/mcp/config.mjs';
import {
  applyScenarioEditorOperations,
  applyOwnerAliases,
  formatScenarioContext,
} from '../lib/mcp/scenarioEditor.mjs';

// Primary model first; fallbacks have SEPARATE free-tier quotas, so a 429 on
// flash (rate limit or exhausted daily quota) doesn't take HwangAI down.
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.0-flash'];
const geminiUrlFor = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Per-model generationConfig overrides. The Gemini 3.x lite fallback thinks
// far too long on multi-tool conversations unless thinking is turned down.
const MODEL_GENERATION_CONFIG = {
  'gemini-flash-lite-latest': { thinkingConfig: { thinkingLevel: 'low' } },
};

// Friendly in-character response when every model is rate-limited — returned
// as a 200 so the UI shows it as a normal chat message instead of the generic
// "Something went wrong" error.
const RATE_LIMITED_MESSAGE =
  "I'm rate-limited right now — my model provider cut me off for a bit, nothing to do with your question. " +
  'Give it a minute or two and hit me again.';

/** Extract Google's suggested retry delay (seconds) from a 429 error body. */
function parseRetryDelaySeconds(errJson) {
  const details = errJson?.error?.details || [];
  for (const d of details) {
    if (d['@type']?.includes('RetryInfo') && typeof d.retryDelay === 'string') {
      const secs = parseFloat(d.retryDelay);
      if (Number.isFinite(secs)) return secs;
    }
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Per-request Gemini state: remembers which model is working across tool
 *  rounds (so an exhausted primary isn't re-tried every round) and caps how
 *  much time we spend sleeping on rate-limit blips. */
function newGeminiState() {
  return { modelIdx: 0, blipRetries: 1 };
}

/**
 * Call Gemini with short-retry on transient rate limits and model fallback on
 * persistent 429s (per-model quotas are independent).
 *
 * @returns {{ ok: true, data: object } | { ok: false, status: number, err: object, rateLimited?: boolean }}
 */
async function callGemini(apiKey, payload, state) {
  let lastErr = { status: 500, err: {} };

  for (let attempt = 0; attempt < 5; attempt++) {
    const model = GEMINI_MODELS[state.modelIdx];
    const genCfg = MODEL_GENERATION_CONFIG[model];
    const body = genCfg
      ? { ...payload, generationConfig: { ...(payload.generationConfig || {}), ...genCfg } }
      : payload;
    const res = await fetch(`${geminiUrlFor(model)}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) return { ok: true, data: await res.json() };

    const err = await res.json().catch(() => ({}));
    lastErr = { status: res.status, err };

    if (res.status === 429) {
      // Brief per-minute blip → wait it out (bounded per request)
      const delay = parseRetryDelaySeconds(err);
      if (delay != null && delay <= 8 && state.blipRetries > 0) {
        state.blipRetries -= 1;
        await sleep(delay * 1000 + 250);
        continue;
      }
      // Daily quota / long delay → move to the next model for the whole request
      if (state.modelIdx < GEMINI_MODELS.length - 1) {
        state.modelIdx += 1;
        continue;
      }
      return { ok: false, ...lastErr, rateLimited: true };
    }

    // Model unavailable to this key → advance the fallback chain
    if (res.status === 404 && state.modelIdx < GEMINI_MODELS.length - 1) {
      state.modelIdx += 1;
      continue;
    }

    // 5xx: one quick retry, otherwise bail
    if (res.status >= 500 && attempt < 1) {
      await sleep(500);
      continue;
    }
    return { ok: false, ...lastErr };
  }

  return { ok: false, ...lastErr, rateLimited: lastErr.status === 429 };
}

const SIDE_QUERY_PROBABILITY = 0.25; // 1 in 4

// ── Web-search intent detection ───────────────────────────────────────────────

// Patterns on the USER'S QUESTION that signal a need for live web data.
// This is the primary detection layer — independent of model phrasing.
const QUESTION_SEARCH_PATTERNS = [
  /\binjur(y|ied|ies)\b/i,
  /\bhurt\b/i,
  /\bsuspend(ed|sion)\b/i,
  /\blatest (news|update|info|buzz|scoop)\b/i,
  /\brecent (news|update|report)\b/i,
  /\b(news|updates?) (about|on|for|regarding)\b/i,
  /\bany news\b/i,
  /\bwhat'?s (going on|happening|new) with\b/i,
  /\bwhat happened to\b/i,
  /\bdepth chart\b/i,
  /\bcurrent status\b/i,
  /\bnfl (news|transaction|move)\b/i,
  /\bwaiv(ed|er release)\b/i,
  /\b(cut|released) (by|from)\b/i,
  // Recent draft class / rookie status questions
  /\b(2022|2023|2024|2025)\s+(draft|class|rookie|pick)\b/i,
  /\brookie (season|year|campaign|contract|deal)\b/i,
  /\b(how|what).*(rookie|first year|first season)\b/i,
  /\b(has|have|did)\s+\w+(\s+\w+)?\s+(played|been drafted|entered|made the (team|roster|league))\b/i,
  /\bis\s+\w+(\s+\w+)?\s+(in the nfl|on a (team|roster)|still (playing|active))\b/i,
  /\b(snap|snaps|snap count|snap share)\b/i,
];

function questionNeedsSearch(messages) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const q = lastUser?.content || '';
  return QUESTION_SEARCH_PATTERNS.some(re => re.test(q));
}

// Fallback patterns on the MODEL'S RESPONSE — catches cases the model
// verbally signals search intent instead of using <!--search-->.
const RESPONSE_SEARCH_PHRASES = [
  /\blet me (check|search|look( that)? up|see|find|grab|pull up)\b/i,
  /\bI'?ll (check|search|look|find|see|pull up)\b/i,
  /\bhere'?s what'?s current\b/i,
  /\bas for the (absolute )?(latest|current)\b/i,
  /\bthe absolute latest\b/i,
  /\bwhat'?s (out there|current)\b/i,
  /\b(checking|searching|looking up) the (latest|current|most recent)\b/i,
  /\blet me see what\b/i,
];

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
    description: 'Search for a player by name. Returns their CURRENT NFL team from the live Sleeper database (overrides training data), current age, dynasty values (KTC, FantasyCalc, FFB), and current league owner. Call this any time you are about to make any claim about a player\'s current team, NFL status, or whether they are active in the league — especially for players you associate with the 2022–2025 draft classes.',
    parameters: {
      type: 'OBJECT',
      properties: { name: { type: 'STRING', description: 'Player name e.g. "Justin Jefferson"' } },
      required: ['name'],
    },
  },
  {
    name: 'get_player_stats',
    description: "Get a player's NFL regular season stats (passing, rushing, receiving) and fantasy points for a given season. Data is available from 2005 through 2025. Fantasy points shown are standard 0-PPR scoring; TE stats also show TEP-adjusted totals. Use this whenever a user asks about a player's stats, production, or fantasy output in any past season. Also use this to VERIFY whether a player has NFL production — if they appear in the database with stats for a given year, they have played. This is the definitive check for 'has this player played in the NFL.'",
    parameters: {
      type: 'OBJECT',
      properties: {
        name:   { type: 'STRING',  description: 'Player full name e.g. "Justin Jefferson"' },
        season: { type: 'INTEGER', description: 'NFL season year e.g. 2024, 2025. Omit to default to the most recent complete season.' },
      },
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
    description: 'Evaluate a trade with the Hwang value engine. Returns per-asset values in the chosen value model, a consolidation Value Adjustment for uneven packages, a verdict, and totals across all major value models (KTC TE+, Hwang Market, Hwang True, Competitor Adj, Rebuild Adj). ALWAYS call this before giving any trade verdict. Default model is hwang_true_value; use competitor_adjusted for a win-now team\'s perspective or rebuilder_adjusted for a rebuilding team\'s perspective.',
    parameters: {
      type: 'OBJECT',
      properties: {
        giving: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Players/picks you are giving' },
        receiving: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Players/picks you are receiving' },
        value_source: {
          type: 'STRING',
          enum: ['ktc_sf', 'ktc_sf_tep', 'hwang_market_value', 'hwang_true_value', 'competitor_adjusted', 'rebuilder_adjusted', 'hwang_competitor_adjusted', 'hwang_rebuilder_adjusted', 'fantasycalc', 'ffb'],
          description: 'Primary value model (default hwang_true_value)',
        },
      },
      required: ['giving', 'receiving'],
    },
  },
  {
    name: 'get_player_value',
    description: 'Get one player\'s value across ALL value models at once (KTC SF/TE+, Hwang Market, Hwang True, Competitor/Rebuild adjusted, FantasyCalc, FFB) with positional and overall ranks, age, and 30-day market trend. This is the atomic unit of any value opinion — call it before ranking, tiering, or valuing any player.',
    parameters: {
      type: 'OBJECT',
      properties: { name: { type: 'STRING', description: 'Player name e.g. "Brock Bowers"' } },
      required: ['name'],
    },
  },
  {
    name: 'get_team_value_summary',
    description: 'Roster construction report for a team: total value across models, league value rank, positional value breakdown with top assets and ages, value-weighted roster age, and a competitor-vs-rebuild timeline lean. Includes a league-wide value board for context. Call this before advising any team on strategy, compete/rebuild decisions, or what they need.',
    parameters: {
      type: 'OBJECT',
      properties: { team: { type: 'STRING', description: 'Team name, owner name, or roster ID' } },
      required: ['team'],
    },
  },
  {
    name: 'get_season_odds',
    description: 'Run a Monte Carlo simulation of the upcoming/current season with the real rosters: rolls each player\'s season outcome from historical seasons of players drafted at a similar ADP, scores optimal best-ball lineups for all 17 weeks, and returns title odds, playoff odds, average finish, and average points for every team. Call this before making ANY claim about a team\'s chances, projections, or outlook this season.',
    parameters: {
      type: 'OBJECT',
      properties: {
        iterations: { type: 'INTEGER', description: 'Number of simulation runs (default 1000, max 3000)' },
      },
    },
  },
  {
    name: 'simulate_roster_change_odds',
    description: 'Simulate how hypothetical roster changes for the UPCOMING/current season shift each team\'s title and playoff odds vs the baseline. Both roster sets are scored with identical player-outcome rolls, so the deltas isolate the change. Use this to quantify a proposed trade\'s real impact ("this trade moves you from 10% to 17% title odds"), or to test how much a team needs to improve. For a trade, express BOTH sides: add players to the receiving team and drop them from the sending team.',
    parameters: {
      type: 'OBJECT',
      properties: {
        changes: {
          type: 'ARRAY',
          description: 'List of roster changes to simulate',
          items: {
            type: 'OBJECT',
            properties: {
              team: { type: 'STRING', description: 'Team or owner name whose roster to modify' },
              add: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Player names to add to this team' },
              drop: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Player names to drop from this team' },
            },
            required: ['team'],
          },
        },
        iterations: { type: 'INTEGER', description: 'Number of simulation runs (default 1000, max 3000)' },
      },
      required: ['changes'],
    },
  },
  {
    name: 'lookup_draft_pick',
    description: 'Look up the Hwang True dynasty value of a draft pick by year and round (live KTC Early/Mid/Late market × True pick multiplier). Use this when a user asks what a pick is worth, or before evaluate_trade when a pick\'s tier (Early/Mid/Late) is ambiguous. Returns all three tiers when no tier is specified, along with how many years until the draft.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: {
          type: 'STRING',
          description: 'Pick description e.g. "2027 1st", "2027 early first", "2028 2nd round". Include tier (Early/Mid/Late) if known.',
        },
      },
      required: ['name'],
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
    description: "Get players not on any roster in the Hwang Dynasty league, sorted by KTC dynasty value. MUST be called before making ANY claim about whether a player is a free agent — never infer free agent status from training data or rankings.",
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
    name: 'get_historical_results',
    description: 'Get the final standings and complete playoff results for a completed past season. Returns regular-season totals (weeks 1–14) used for seeding, full playoff bracket matchups with exact scores, and final placement (1st–10th) for all teams. The top 4 teams are ordered by their PLAYOFF performance — 1st place is the actual champion who won the playoff bracket, not just the highest regular-season scorer. Use this for any question about past season results, who won, playoff scores, or final standings.',
    parameters: {
      type: 'OBJECT',
      properties: {
        season: { type: 'STRING', description: 'The season year to look up, e.g. "2024" or "2025". Must be a completed past season.' },
      },
      required: ['season'],
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

const SCENARIO_EDITOR_TOOLS = [
  {
    name: 'apply_scenario_edits',
    description:
      'Apply roster edits to the scenario currently being built. Call this for any trade, add, drop, move, copy, reverse, or reset. For a named trade between two teams ("reverse that Mac/Aidan trade"), use type reverse_trade with those first names — recent trades are already in context. For a fresh trade, pass player names on each side. Default add/move STEALS the player off every other roster. If the user asked to copy them or keep them on the original team, set keep_on_other_teams true (or type "copy") so they exist on both.',
    parameters: {
      type: 'OBJECT',
      properties: {
        operations: {
          type: 'ARRAY',
          description: 'List of roster operations to apply in order',
          items: {
            type: 'OBJECT',
            properties: {
              type: {
                type: 'STRING',
                enum: ['trade', 'add', 'drop', 'move', 'edit', 'copy', 'reverse_trade', 'reset'],
                description: 'trade = swap two sides; reverse_trade = undo a listed recent trade between named teams; add/drop/move = one-sided (add/move steal by default); copy = add without removing from other teams; edit = add+drop on one team; reset = restore original rosters',
              },
              players_a: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Trade side A player names' },
              players_b: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Trade side B player names' },
              team: { type: 'STRING', description: 'Team, owner first name, or nickname (add/drop/edit/copy/reverse_trade). Examples: Mac, Aidan, Drew, Hwang.' },
              to_team: { type: 'STRING', description: 'Destination team, owner first name, or nickname (move). Second team for reverse_trade.' },
              team_a: { type: 'STRING', description: 'First team for reverse_trade (first name or team name)' },
              team_b: { type: 'STRING', description: 'Second team for reverse_trade' },
              teams: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Teams involved in reverse_trade, e.g. ["Mac","Aidan"]' },
              player: { type: 'STRING', description: 'Single player name (move/drop/add/copy), or a player from the trade to disambiguate reverse_trade' },
              players: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Player names for add/drop/move/copy' },
              add: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Players to add (edit)' },
              drop: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Players to drop (edit)' },
              keep_on_other_teams: {
                type: 'BOOLEAN',
                description: 'If true, add/move copies the player onto the destination without removing them from any other roster. Use when the user says keep them, copy, duplicate, or do not take them off the other team.',
              },
            },
            required: ['type'],
          },
        },
      },
      required: ['operations'],
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
      case 'get_player_stats':       return getPlayerStats(args.name, args.season);
      case 'compare_players':        return await comparePlayers(args.names);
      case 'evaluate_trade':         return await evaluateTrade(args.giving, args.receiving, args.value_source, CHAT_TOOL_RENDER_MODE);
      case 'get_player_value':       return getPlayerValueBreakdown(args.name, CHAT_TOOL_RENDER_MODE);
      case 'get_team_value_summary': return await getTeamValueSummary(args.team, CHAT_TOOL_RENDER_MODE);
      case 'get_season_odds':        return await getSeasonOdds(args.iterations);
      case 'simulate_roster_change_odds':
        return await simulateRosterChangeOdds({ changes: args.changes, iterations: args.iterations });
      case 'lookup_draft_pick':      return lookupDraftPick(args.name);
      case 'get_ktc_rankings':       return getKtcRankings(args.position, args.top_n);
      case 'get_fantasycalc_rankings': return getFantasyCalcRankings(args.position, args.top_n);
      case 'get_trending_players':   return await getTrendingPlayers();
      case 'get_recent_trades':      return await getRecentTrades(args.weeks_back, args.season);
      case 'get_free_agents':        return await getFreeAgents(args.position);
      case 'get_site_link':          return await getSiteLink(args.page, { team: args.team, week: args.week });
      case 'run_scenario':           return await runScenario({ season: args.season, changes: args.changes });
      case 'get_historical_results':  return await getHistoricalResults(args.season);
      default: return `Unknown tool: ${name}`;
    }
  } catch (err) {
    console.error(`[executeTool] ${name} failed:`, err);
    return `Tool error (${name}): ${err.message}`;
  }
}

// ── Side query (Chinese characters) ──────────────────────────────────────────

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function resolvePath(filename) {
  const candidates = [
    join(process.cwd(), 'public', 'data', filename),
    join(process.cwd(), 'site', 'public', 'data', filename),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

function loadFile(filename) {
  try {
    return readFileSync(resolvePath(filename), 'utf8');
  } catch {
    return null;
  }
}

async function fetchChineseCharacters(apiKey) {
  try {
    const systemPrompt = loadFile('chinese_characters_prompt.txt');
    const inputPrompt = loadFile('chinese_characters_input.txt');
    if (!systemPrompt || !inputPrompt) return null;
    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: inputPrompt }] }],
    };
    // Don't share the main chat's model slot — a 429 on flash used to
    // silently drop the proverb, which is half the bit.
    for (const model of GEMINI_MODELS) {
      const res = await fetch(`${geminiUrlFor(model)}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
      if (text) return text;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Internal-model leak sanitizer ─────────────────────────────────────────────

// Internal value-model names must never reach users. Prompt rules and tool-
// output reminders reduce leaks but can't guarantee zero, so the final response
// is regex-checked and rewritten by a second model call when a leak slips out.
const INTERNAL_MODEL_LEAK_RE =
  /hwang\s+(?:true|market)|competitor[-\s]?adjusted|rebuild(?:er)?[-\s]?adjusted|value\s+engine|house\s+(?:model|valuation)|internal\s+(?:model|numbers?|valuation)|redraft\s*dash/i;

const SANITIZE_INSTRUCTION = `You are a copy editor for HwangAI, a dynasty fantasy football AI. \
The chat response below accidentally leaks internal methodology that users must never see. \
Rewrite it with these rules:
- REMOVE internal model names and aliases: "Hwang True", "Hwang Market", "Competitor Adjusted", "Rebuild(er) Adjusted", "value engine", "house model", "internal model/numbers", "Redraft Dash". Replace with plain language: "my numbers", "through a win-now lens", "viewed purely as a future asset", "how we value him in this league's format". For sim rank-source leaks, say the simulation uses draft ADP — do not name any custom board.
- REMOVE raw internal value totals attributed to those models (e.g. "6,841 in value"). Express them as a percentage gap, a position/overall rank, or a draft-pick equivalent instead.
- KEEP everything else exactly as it was: tone, verdicts, structure, markdown links, KTC/FantasyCalc figures (public — fine to cite), ADP, odds percentages, player stats, and the <!--search--> marker if present.
Output ONLY the rewritten response, nothing else.`;

async function sanitizeInternalLeaks(text, apiKey, state) {
  if (!text || !INTERNAL_MODEL_LEAK_RE.test(text)) return text;
  const result = await callGemini(apiKey, {
    systemInstruction: { parts: [{ text: SANITIZE_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text }] }],
  }, state);
  if (!result.ok) return text; // fail open — better a leak than an error
  const rewritten = result.data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text?.trim();
  return rewritten || text;
}

// ── Long-running tool interim messages ────────────────────────────────────────

// Tools that run Monte Carlo simulations or heavy historical recomputes. When
// the model requests one, we return an interim "hang on" message plus a
// continuation token instead of blocking; the frontend shows the message,
// keeps the typing indicator up, and immediately calls back to finish.
const SLOW_TOOLS = new Set(['get_season_odds', 'simulate_roster_change_odds', 'run_scenario']);

// Guards against interim ping-pong if the model keeps chaining slow tools.
const MAX_CONTINUATIONS = 3;

const INTERIM_MESSAGES = [
  'Hang on — actually running the sims instead of vibing. Give me a few seconds.',
  'One sec. Letting the Monte Carlo cook. Try not to make another trade while you wait.',
  'Hold tight — crunching a thousand seasons. Your take can sit in the lobby.',
];

const pickInterimMessage = () =>
  INTERIM_MESSAGES[Math.floor(Math.random() * INTERIM_MESSAGES.length)];

// ── Logging ───────────────────────────────────────────────────────────────────

function logConversation(messages, response = null) {
  const entry = {
    ts: new Date().toISOString(),
    turns: messages.map(m => ({ role: m.role, content: m.content })),
    ...(response !== null ? { response } : {}),
  };
  console.log('[HwangAI]', JSON.stringify(entry));
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

  const { messages, systemPrompt, continuation, mode, scenario } = body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' });
  }
  const continuationDepth = Number(continuation?.depth) || 0;
  const plain = mode === 'plain';
  const scenarioEditor = mode === 'scenario_editor';
  let scenarioSnapshot = scenario;
  if (scenarioEditor && scenario) {
    let trades = [];
    try {
      const seasonTrades = await loadCompletedTrades(scenario.season);
      const yr = String(scenario.season || '');
      if (yr && yr !== String(CURRENT_YEAR)) {
        const currentTrades = await loadCompletedTrades(CURRENT_YEAR);
        const seen = new Set(seasonTrades.map((t) => t.id).filter(Boolean));
        trades = [
          ...currentTrades.filter((t) => t.id && !seen.has(t.id)),
          ...seasonTrades,
        ].sort((a, b) => (b.created || 0) - (a.created || 0));
      } else {
        trades = seasonTrades;
      }
    } catch (err) {
      console.error('[scenario editor] failed to load trades:', err);
    }
    scenarioSnapshot = {
      ...scenario,
      teams: applyOwnerAliases(scenario.teams, loadOwnerAliasesByRoster()),
      trades,
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  // Decide whether to fire the side query this turn
  const doSideQuery = !plain && !scenarioEditor && Math.random() < SIDE_QUERY_PROBABILITY;
  const sideQueryPromise = doSideQuery
    ? fetchChineseCharacters(apiKey)
    : Promise.resolve(null);

  // Execute the tools requested in a model turn's functionCall parts and
  // return the functionResponse turn to append to the conversation.
  let lastScenarioResult = null;
  async function runToolCalls(functionCallParts) {
    const toolResults = await Promise.all(
      functionCallParts.map(async ({ functionCall: { name, args } }) => {
        if (name === 'apply_scenario_edits') {
          const result = applyScenarioEditorOperations(args?.operations, scenarioSnapshot, loadPlayersData());
          if (result.ok) lastScenarioResult = result;
          return { name, result: result.toolMessage };
        }
        return {
          name,
          result: await executeTool(name, args || {}),
        };
      })
    );
    return {
      role: 'user',
      parts: toolResults.map(({ name, result }) => ({
        functionResponse: {
          name,
          response: { result: typeof result === 'string' ? result : JSON.stringify(result) },
        },
      })),
    };
  }

  let contents;
  if (Array.isArray(continuation?.contents) && continuation.contents.length > 0) {
    // Resuming after an interim "hang on" response: the last turn is the
    // model's pending function call(s) — execute them now, then continue.
    contents = continuation.contents;
    const last = contents[contents.length - 1];
    const pendingCalls = last?.role === 'model'
      ? (last.parts || []).filter(p => p.functionCall)
      : [];
    if (pendingCalls.length > 0) {
      contents.push(await runToolCalls(pendingCalls));
    }
  } else {
    // Build the conversation history for Gemini, merging consecutive same-role turns
    // (Phase 2 search responses create back-to-back assistant messages that violate
    // Gemini's strict alternating-role requirement)
    contents = [];
    for (const m of messages) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      const text = m.content || '';
      if (!text) continue;
      const prev = contents[contents.length - 1];
      if (prev && prev.role === role) {
        prev.parts.push({ text });
      } else {
        contents.push({ role, parts: [{ text }] });
      }
    }
  }

  const effectiveSystemPrompt = scenarioEditor
    ? [systemPrompt, formatScenarioContext(scenarioSnapshot, loadPlayersData())].filter(Boolean).join('\n\n')
    : systemPrompt;
  const requestBase = {
    ...(plain ? {} : {
      tools: [{ functionDeclarations: scenarioEditor ? SCENARIO_EDITOR_TOOLS : TOOL_DECLARATIONS }],
    }),
    ...(effectiveSystemPrompt ? { systemInstruction: { parts: [{ text: effectiveSystemPrompt }] } } : {}),
  };

  // Tool-calling loop (max 10 rounds — multi-step value/simulation playbooks
  // chain several tools; the cap only guards against runaway loops)
  const geminiState = newGeminiState();
  let retriedEmptyResponse = false;
  for (let round = 0; round < 10; round++) {
    const geminiRes = await callGemini(apiKey, { ...requestBase, contents }, geminiState);

    if (!geminiRes.ok) {
      if (geminiRes.rateLimited) {
        // Degrade gracefully: a normal chat message instead of a UI error
        logConversation(messages, RATE_LIMITED_MESSAGE);
        return res.status(200).json({ message: RATE_LIMITED_MESSAGE, needsSearch: false });
      }
      return res.status(geminiRes.status).json({ error: 'Gemini API error', details: geminiRes.err });
    }

    const { data } = geminiRes;
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Collect any function calls in this response
    const functionCalls = parts.filter(p => p.functionCall);

    if (functionCalls.length === 0) {
      // No tool calls — extract the text response (skip Gemini 3.x thought-
      // summary parts, join multiple text parts) and stitch side query
      let text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('\n\n');
      const needsSearch = !plain && !scenarioEditor && (
        text.includes('<!--search-->') ||
        RESPONSE_SEARCH_PHRASES.some(re => re.test(text)) ||
        questionNeedsSearch(messages)
      );
      text = text.replace(/<!--search-->/g, '').trim();
      if (!plain && !scenarioEditor) {
        text = await sanitizeInternalLeaks(text, apiKey, geminiState);
      }

      // Never ship an empty bubble: a model can occasionally return a bare
      // <!--search--> marker or an empty/thought-only candidate.
      if (!text) {
        if (needsSearch) {
          text = 'Let me dig into that.';
        } else if (!retriedEmptyResponse) {
          retriedEmptyResponse = true;
          continue; // re-ask the model once with the same conversation
        } else {
          text = 'I blanked on that one — clanker moment. Hit me again.';
        }
      }

      const sideResult = await sideQueryPromise;
      if (sideResult && text) {
        text += `\n\n---\n\n${sideResult}`;
      }
      logConversation(messages, text);
      return res.status(200).json({ message: text, needsSearch });
    }

    // Append model's function call turn verbatim (Gemini 3.x models require
    // thoughtSignature to be echoed back on functionCall parts)
    contents.push({ role: 'model', parts });

    if (scenarioEditor) {
      lastScenarioResult = null;
      contents.push(await runToolCalls(functionCalls));
      if (lastScenarioResult?.ok) {
        const modelText = parts.filter(p => p.text && !p.thought).map(p => p.text).join('\n\n').trim();
        const message = modelText || lastScenarioResult.summary;
        logConversation(messages, message);
        return res.status(200).json({
          message,
          needsSearch: false,
          scenarioEdits: lastScenarioResult.edits,
          reset: Boolean(lastScenarioResult.reset),
        });
      }
      continue;
    }

    // Slow tool requested → hand an interim "hang on" message back to the UI
    // along with the conversation state; the frontend calls back immediately
    // and we execute the pending tools on the continuation request.
    const wantsSlowTool = functionCalls.some(p => SLOW_TOOLS.has(p.functionCall.name));
    if (wantsSlowTool && continuationDepth < MAX_CONTINUATIONS) {
      const interimText = parts.find(p => p.text && !p.thought)?.text?.trim() || pickInterimMessage();
      return res.status(200).json({
        interim: true,
        message: interimText,
        continuation: { contents, depth: continuationDepth + 1 },
      });
    }

    // Execute all requested tools (potentially in parallel) and append results
    contents.push(await runToolCalls(functionCalls));
  }

  // Fallback if we hit the loop limit without a text response
  const sideResult = await sideQueryPromise;
  let fallback = 'Sorry, I ran into an issue generating a response. Please try again.';
  if (sideResult) {
    fallback += `\n\n---\n\n${sideResult}`;
  }
  logConversation(messages, fallback);
  return res.status(200).json({ message: fallback, needsSearch: false });
}
