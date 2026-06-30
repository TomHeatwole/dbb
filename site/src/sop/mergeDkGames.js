/** Match FanDuel + DraftKings game rows by normalized fixture name. */

export function gameMergeKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+v\s+/gi, '|')
    .replace(/[^a-z0-9|]+/g, '')
    .trim();
}

function dkHasNoGoalData(dkGame) {
  if (!dkGame?.noGoalMarkets) return false;
  return Object.values(dkGame.noGoalMarkets).some((q) => q?.american != null);
}

export function mergeDkIntoFdGames(fdGames, dkPayload) {
  const dkGames = dkPayload?.games ?? [];
  const dkByKey = new Map();
  for (const game of dkGames) {
    dkByKey.set(gameMergeKey(game.name), game);
  }

  return (fdGames ?? []).map((game) => {
    const dk = dkByKey.get(gameMergeKey(game.name));
    if (!dk) return { ...game, dk: null };

    const dkPayload = {
      goalTypes: dk.goalTypes ?? null,
      noGoalMarkets: dk.noGoalMarkets ?? null,
      error: dk.error ?? null,
      errorCode: dk.errorCode ?? null,
      dkEventId: dk.dkEventId ?? null,
    };

    return { ...game, dk: dkPayload };
  });
}

export function dkGamesLoaded(dkPayload) {
  if (!dkPayload?.games?.length) return false;
  return dkPayload.games.some(
    (g) => g.goalTypes || dkHasNoGoalData(g),
  );
}
