/**
 * Live SOP goal feed: ESPN keyEvents → Gemini classify once → Neon cache.
 */

import { getSql } from './db.mjs';
import {
  classifyGoalTypeFromCommentary,
  GOAL_TYPE_LABELS,
  hasClassifiableCommentary,
} from './classify-goal-type.mjs';

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

function commentaryTextByPlayId(payload) {
  const byId = new Map();
  for (const item of payload?.commentary ?? []) {
    const playId = item?.play?.id != null ? String(item.play.id) : null;
    const text = String(item?.play?.text ?? item?.text ?? '').trim();
    if (playId && text && !byId.has(playId)) byId.set(playId, text);
  }
  return byId;
}

function isScoringPlay(play) {
  if (play?.scoringPlay) return true;
  const token = String(play?.type?.type ?? play?.type?.text ?? '').toLowerCase();
  if (token.includes('miss') || token.includes('saved') || token.includes('woodwork')) return false;
  return token === 'goal'
    || token.startsWith('goal')
    || token.includes('own-goal')
    || token.includes('own goal')
    || token.includes('penalty---scored')
    || token === 'penalty-scored';
}

function scorerFromPlay(play, actors) {
  if (actors.scorer) return actors.scorer;
  const athlete = play?.participants?.[0]?.athlete?.displayName;
  if (athlete) return String(athlete).trim();
  const short = String(play?.shortText ?? '').replace(/\s+goal$/i, '').trim();
  return short || null;
}

function teamFromPlay(play, actors) {
  if (actors.teamName) return actors.teamName;
  return play?.team?.displayName ?? play?.team?.name ?? null;
}

function arrayish(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function collectCandidatePlays(payload) {
  const extraText = commentaryTextByPlayId(payload);
  const merged = new Map();
  const push = (play) => {
    if (!play || typeof play !== 'object') return;
    const playId = String(play.id ?? '').trim();
    const key = playId || `anon-${merged.size}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, play);
      return;
    }
    if (!existing.text && (play.text || extraText.get(playId))) {
      merged.set(key, { ...existing, ...play });
    }
  };
  for (const play of arrayish(payload?.keyEvents)) push(play);
  for (const play of arrayish(payload?.plays?.items ?? payload?.plays)) push(play);
  for (const item of payload?.commentary ?? []) push(item?.play);
  return { plays: [...merged.values()], extraText };
}

export function extractScoringPlays(payload) {
  const { plays: events, extraText } = collectCandidatePlays(payload);

  return events
    .filter(isScoringPlay)
    .map((play) => {
      const playId = String(play.id ?? '').trim();
      const description = String(
        play.text
        || extraText.get(playId)
        || play.shortText
        || '',
      ).trim();
      const actors = parseGoalActors(description);
      const clock = play.clock?.displayValue || play.time?.displayValue || null;
      return {
        playId: playId || [clock, play.shortText, play.type?.type].filter(Boolean).join('|'),
        clock,
        description,
        scorer: scorerFromPlay(play, actors),
        teamName: teamFromPlay(play, actors),
        espnType: play.type ?? null,
        classifiable: hasClassifiableCommentary(description),
      };
    })
    .filter((play) => play.playId);
}

const ESPN_SUMMARY_HOSTS = [
  'https://site.web.api.espn.com/apis/site/v2/sports/soccer',
  'https://site.api.espn.com/apis/site/v2/sports/soccer',
];

function summaryUrls(espnId, leagueKey) {
  const slugs = [
    LEAGUE_SLUG[leagueKey] ?? LEAGUE_SLUG.ucl,
    leagueKey === 'pl' ? LEAGUE_SLUG.ucl : LEAGUE_SLUG.pl,
  ];
  const urls = [];
  for (const host of ESPN_SUMMARY_HOSTS) {
    for (const slug of slugs) {
      urls.push(`${host}/${slug}/summary?event=${espnId}`);
      urls.push(`${host}/${slug}/playbyplay?event=${espnId}`);
    }
  }
  return urls;
}

async function espnGetJson(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, {
      headers: { ...ESPN_HEADERS, Referer: referer ?? 'https://www.espn.com/soccer/' },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ESPN ${url} returned ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchEspnMatchSummary(espnId, leagueKey = 'ucl') {
  const referer = `https://www.espn.com/soccer/match/_/gameId/${espnId}`;
  let lastErr = null;
  for (const url of summaryUrls(espnId, leagueKey)) {
    try {
      const payload = await espnGetJson(url, referer);
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

function isRecordedGoal(row) {
  return Boolean(row?.goal_type) && hasClassifiableCommentary(row.description);
}

async function upsertClassifiedGoal(espnId, play, goalType) {
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
    ON CONFLICT (espn_play_id) DO UPDATE SET
      clock_text = EXCLUDED.clock_text,
      scorer = EXCLUDED.scorer,
      team_name = EXCLUDED.team_name,
      description = EXCLUDED.description,
      goal_type = EXCLUDED.goal_type
  `;
}

async function classifyUncachedPlays(espnId, plays, cached) {
  const recorded = new Set(
    cached.filter(isRecordedGoal).map((row) => String(row.espn_play_id)),
  );
  const pending = plays.filter((play) => play.classifiable && !recorded.has(play.playId));
  if (!pending.length) return;

  await mapPool(pending, CLASSIFY_CONCURRENCY, async (play) => {
    const goalType = await classifyGoalTypeFromCommentary(play.description);
    if (!goalType) return;
    await upsertClassifiedGoal(espnId, play, goalType);
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
  const errors = [];

  await Promise.all(live.map(async (game) => {
    const id = String(game.espnId);
    try {
      const summary = await fetchEspnMatchSummary(game.espnId, game.espnLeague ?? game.competition ?? 'ucl');
      if (summary.espnUrl) urlById.set(id, summary.espnUrl);
      let cached = [];
      try {
        cached = await loadCachedGoals(game.espnId);
        await classifyUncachedPlays(game.espnId, summary.plays, cached);
        cached = await loadCachedGoals(game.espnId);
      } catch (err) {
        console.error('[espn-sop-goals] cache', game.espnId, err.message);
        errors.push(`${id}: cache ${err.message}`);
        cached = [];
      }
      const byPlay = new Map(cached.map((row) => [String(row.espn_play_id), row]));
      const ordered = summary.plays.map((play) => {
        const row = byPlay.get(play.playId);
        if (row && isRecordedGoal(row)) return rowToGoal(row);
        return {
          playId: play.playId,
          clock: play.clock || row?.clock_text,
          scorer: play.scorer || row?.scorer,
          teamName: play.teamName || row?.team_name,
          description: play.description || row?.description,
          goalType: null,
          goalLabel: '…',
        };
      });
      goalsById.set(id, ordered);
    } catch (err) {
      console.error('[espn-sop-goals] summary', game.espnId, err.message);
      errors.push(`${id}: ${err.message}`);
      try {
        const cached = (await loadCachedGoals(game.espnId)).filter(isRecordedGoal);
        if (cached.length) goalsById.set(id, cached.map(rowToGoal));
      } catch (_) {
        /* keep empty */
      }
    }
  }));

  const nextGames = (games ?? []).map((game) => {
    const id = game.espnId != null ? String(game.espnId) : null;
    return {
      ...game,
      espnUrl: (id && urlById.get(id)) || game.espnUrl || espnMatchUrl(game.espnId),
      goalsSoFar: (id && goalsById.get(id)) || game.goalsSoFar || [],
    };
  });

  return {
    games: nextGames,
    goalStats: {
      live: live.length,
      withGoals: [...goalsById.values()].filter((rows) => rows.length).length,
      errors,
    },
  };
}
