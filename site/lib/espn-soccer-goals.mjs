/**
 * Live SOP goal feed: ESPN keyEvents → Gemini classify once → Neon cache.
 */

import { getSql } from './db.mjs';
import { classifyGoalType, GOAL_TYPE_LABELS } from './classify-goal-type.mjs';

const ESPN_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};

const LEAGUE_SLUG = {
  pl: 'eng.1',
  ucl: 'uefa.champions',
};

const CLASSIFY_CONCURRENCY = 4;

export function espnMatchUrl(espnId) {
  if (!espnId) return null;
  return `https://www.espn.com/soccer/match/_/gameId/${espnId}`;
}

export function parseGoalActors(text) {
  const raw = String(text ?? '').trim();
  const own = raw.match(/own goal by\s+(.+?),\s+(.+?)(?:\.|$)/i);
  if (own) {
    return { scorer: own[1].trim(), teamName: own[2].trim(), ownGoal: true };
  }
  const scored = raw.match(/goal!\s+.+?\.\s+(.+?)\s+\((.+?)\)/i);
  if (scored) {
    return { scorer: scored[1].trim(), teamName: scored[2].trim(), ownGoal: false };
  }
  return { scorer: null, teamName: null, ownGoal: false };
}

export function extractScoringPlays(payload) {
  const events = Array.isArray(payload?.keyEvents)
    ? payload.keyEvents
    : Object.values(payload?.keyEvents ?? {});

  return events
    .filter((play) => play?.scoringPlay || /^(goal|own goal|penalty)/i.test(play?.type?.text ?? ''))
    .map((play) => {
      const description = String(play.text ?? play.shortText ?? '').trim();
      const actors = parseGoalActors(description);
      return {
        playId: String(play.id ?? ''),
        clock: play.clock?.displayValue ?? play.time?.displayValue ?? null,
        description,
        scorer: actors.scorer,
        teamName: actors.teamName,
        espnType: play.type ?? null,
      };
    })
    .filter((play) => play.playId && play.description);
}

function summaryUrl(espnId, leagueKey) {
  const slug = LEAGUE_SLUG[leagueKey] ?? LEAGUE_SLUG.ucl;
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${espnId}`;
}

async function espnGetJson(url, referer) {
  const res = await fetch(url, {
    headers: { ...ESPN_HEADERS, Referer: referer ?? 'https://www.espn.com/soccer/' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ESPN ${url} returned ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
  }
  return res.json();
}

export async function fetchEspnMatchSummary(espnId, leagueKey = 'ucl') {
  const tried = [leagueKey, leagueKey === 'pl' ? 'ucl' : 'pl'];
  let lastErr = null;
  for (const key of tried) {
    try {
      const payload = await espnGetJson(
        summaryUrl(espnId, key),
        `https://www.espn.com/soccer/match/_/gameId/${espnId}`,
      );
      const links = payload?.header?.links ?? [];
      const summary = links.find((link) => (link.rel ?? []).includes('summary')) ?? links[0];
      return {
        plays: extractScoringPlays(payload),
        espnUrl: summary?.href ?? espnMatchUrl(espnId),
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('ESPN summary fetch failed');
}

function trySql() {
  try {
    return getSql();
  } catch {
    return null;
  }
}

async function mapPool(items, limit, mapper) {
  const list = [...items];
  const out = new Array(list.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) || 0 }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await mapper(list[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function rowToGoal(row) {
  return {
    playId: row.espn_play_id,
    clock: row.clock_text,
    scorer: row.scorer,
    teamName: row.team_name,
    description: row.description,
    goalType: row.goal_type,
    goalLabel: GOAL_TYPE_LABELS[row.goal_type] ?? row.goal_type,
  };
}

async function loadCachedGoals(espnId) {
  const sql = trySql();
  if (!sql) return [];
  const rows = await sql`
    SELECT espn_play_id, espn_game_id, clock_text, scorer, team_name, description, goal_type
    FROM espn_sop_goals
    WHERE espn_game_id = ${String(espnId)}
    ORDER BY created_at ASC
  `;
  return rows;
}

async function insertClassifiedGoal(espnId, play, goalType) {
  const sql = trySql();
  if (!sql) return;
  await sql`
    INSERT INTO espn_sop_goals (
      espn_play_id, espn_game_id, clock_text, scorer, team_name, description, goal_type
    ) VALUES (
      ${play.playId},
      ${String(espnId)},
      ${play.clock},
      ${play.scorer},
      ${play.teamName},
      ${play.description},
      ${goalType}
    )
    ON CONFLICT (espn_play_id) DO NOTHING
  `;
}

async function classifyUncachedPlays(espnId, plays, cached) {
  const have = new Set(cached.map((row) => String(row.espn_play_id)));
  const missing = plays.filter((play) => !have.has(play.playId));
  if (!missing.length) return;

  await mapPool(missing, CLASSIFY_CONCURRENCY, async (play) => {
    const goalType = await classifyGoalType(play.description, { espnType: play.espnType });
    await insertClassifiedGoal(espnId, play, goalType);
  });
}

export async function pruneFinishedEspnGoalCache(liveEspnIds) {
  const sql = trySql();
  if (!sql) return;
  const ids = [...new Set((liveEspnIds ?? []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) {
    await sql`DELETE FROM espn_sop_goals`;
    return;
  }
  await sql.query(
    `DELETE FROM espn_sop_goals WHERE espn_game_id NOT IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`,
    ids,
  );
}

export function isSopLiveGame(game) {
  if (game?.inPlay) return true;
  const status = String(game?.espn?.status ?? '').toLowerCase();
  return status === 'in' || Boolean(game?.espn?.halfTime);
}

export async function attachEspnGoals(games) {
  const live = (games ?? []).filter((game) => game.espnId && isSopLiveGame(game));
  const liveIds = live.map((game) => String(game.espnId));

  try {
    await pruneFinishedEspnGoalCache(liveIds);
  } catch (err) {
    console.error('[espn-sop-goals] prune', err.message);
  }

  const goalsById = new Map();
  const urlById = new Map();

  await Promise.all(live.map(async (game) => {
    try {
      const summary = await fetchEspnMatchSummary(game.espnId, game.espnLeague ?? game.competition ?? 'ucl');
      if (summary.espnUrl) urlById.set(String(game.espnId), summary.espnUrl);
      let cached = [];
      try {
        cached = await loadCachedGoals(game.espnId);
        await classifyUncachedPlays(game.espnId, summary.plays, cached);
        cached = await loadCachedGoals(game.espnId);
      } catch (err) {
        console.error('[espn-sop-goals] cache', game.espnId, err.message);
        cached = [];
      }
      const byPlay = new Map(cached.map((row) => [String(row.espn_play_id), row]));
      const ordered = summary.plays.map((play) => {
        const row = byPlay.get(play.playId);
        if (row) return rowToGoal(row);
        return {
          playId: play.playId,
          clock: play.clock,
          scorer: play.scorer,
          teamName: play.teamName,
          description: play.description,
          goalType: null,
          goalLabel: '…',
        };
      });
      goalsById.set(String(game.espnId), ordered);
    } catch (err) {
      console.error('[espn-sop-goals] summary', game.espnId, err.message);
    }
  }));

  return (games ?? []).map((game) => {
    const id = game.espnId != null ? String(game.espnId) : null;
    return {
      ...game,
      espnUrl: (id && urlById.get(id)) || game.espnUrl || espnMatchUrl(game.espnId),
      goalsSoFar: (id && goalsById.get(id)) || game.goalsSoFar || [],
    };
  });
}
