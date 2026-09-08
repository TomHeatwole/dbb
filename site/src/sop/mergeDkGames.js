/** Match FanDuel + DraftKings game rows by canonical fixture. */

import { fixtureTeamKey, gameMergeKey } from './fixtureKey';

function dkHasNoGoalData(dkGame) {
  if (!dkGame?.noGoalMarkets) return false;
  return Object.values(dkGame.noGoalMarkets).some((q) => q?.american != null);
}

function quotesHaveAmerican(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Object.values(obj).some((q) => Number.isFinite(q?.american));
}

export function gameHasFdOrDkLines(game) {
  if (quotesHaveAmerican(game?.goalTypes) || quotesHaveAmerican(game?.noGoalMarkets)) return true;
  if (quotesHaveAmerican(game?.dk?.goalTypes) || quotesHaveAmerican(game?.dk?.noGoalMarkets)) return true;
  return false;
}

function dkHasLines(dkGame) {
  return Boolean(dkGame?.goalTypes) || dkHasNoGoalData(dkGame);
}

function dkLookupKeys(game) {
  const keys = [];
  const fixture = fixtureTeamKey(game?.name);
  if (fixture) keys.push(`fix:${fixture}`);
  const merge = gameMergeKey(game?.name);
  if (merge) keys.push(`merge:${merge}`);
  return keys;
}

function indexDkGames(dkGames) {
  const byKey = new Map();
  for (const game of dkGames ?? []) {
    for (const key of dkLookupKeys(game)) {
      if (!byKey.has(key)) byKey.set(key, game);
    }
  }
  return byKey;
}

function findDkMatch(game, byKey) {
  for (const key of dkLookupKeys(game)) {
    const hit = byKey.get(key);
    if (hit) return hit;
  }
  return null;
}

function dkPayloadFor(dk) {
  return {
    goalTypes: dk.goalTypes ?? null,
    noGoalMarkets: dk.noGoalMarkets ?? null,
    error: dk.error ?? null,
    errorCode: dk.errorCode ?? null,
    dkEventId: dk.dkEventId ?? dk.eventId ?? null,
  };
}

function dkOnlyToFdShape(dk) {
  const dkEventId = dk.dkEventId ?? dk.eventId ?? null;
  return {
    eventId: dkEventId != null ? `dk-${dkEventId}` : dk.eventId,
    name: dk.name,
    openDate: dk.openDate ?? null,
    inPlay: Boolean(dk.inPlay),
    score: dk.score ?? { home: 0, away: 0 },
    scoreDisplay: dk.scoreDisplay ?? '0-0',
    teams: dk.teams ?? null,
    competition: dk.competition ?? 'ucl',
    competitionId: dk.competitionId ?? null,
    competitionName: dk.competitionName ?? 'Champions League',
    goalTypes: null,
    noGoalMarkets: null,
    dk: dkPayloadFor(dk),
  };
}

export function mergeDkIntoFdGames(fdGames, dkPayload) {
  const dkGames = dkPayload?.games ?? [];
  const byKey = indexDkGames(dkGames);
  const used = new Set();

  const merged = (fdGames ?? []).map((game) => {
    const dk = findDkMatch(game, byKey);
    if (!dk) return { ...game, dk: null };
    used.add(dk);
    return { ...game, dk: dkPayloadFor(dk) };
  });

  for (const dk of dkGames) {
    if (used.has(dk) || !dkHasLines(dk)) continue;
    merged.push(dkOnlyToFdShape(dk));
  }

  return merged;
}

/** Premier League stays on the board; UCL only if FD or DK posted SOP/no-goal lines. */
export function keepSopDisplayGames(games) {
  return (games ?? []).filter((game) => {
    if (game?.competition === 'ucl') return gameHasFdOrDkLines(game);
    return true;
  });
}

export function dkGamesLoaded(dkPayload) {
  if (!dkPayload?.games?.length) return false;
  return dkPayload.games.some((g) => g.goalTypes || dkHasNoGoalData(g));
}

export { gameMergeKey, fixtureTeamKey };
