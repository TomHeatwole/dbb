/** Match FanDuel game rows with Kalshi no-goal proxy quotes. */

import { gameMergeKey } from './mergeDkGames';

function klshHasNoGoalData(klshGame) {
  if (!klshGame?.noGoalMarkets) return false;
  return Object.values(klshGame.noGoalMarkets).some((q) => q?.american != null);
}

export function mergeKalshiIntoFdGames(fdGames, kalshiPayload) {
  const kalshiGames = kalshiPayload?.games ?? [];
  const kalshiByKey = new Map();
  for (const game of kalshiGames) {
    kalshiByKey.set(gameMergeKey(game.name), game);
  }

  return (fdGames ?? []).map((game) => {
    const klsh = kalshiByKey.get(gameMergeKey(game.name));
    if (!klsh || !klshHasNoGoalData(klsh)) {
      return { ...game, klsh: null };
    }

    return {
      ...game,
      klsh: {
        noGoalMarkets: klsh.noGoalMarkets ?? null,
        kalshiEventTickers: klsh.kalshiEventTickers ?? null,
        error: klsh.error ?? null,
      },
    };
  });
}

export function kalshiGamesLoaded(kalshiPayload) {
  if (!kalshiPayload?.games?.length) return false;
  return kalshiPayload.games.some((g) => klshHasNoGoalData(g));
}
