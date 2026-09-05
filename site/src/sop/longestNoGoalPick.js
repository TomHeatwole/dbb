import { DEFAULT_NO_GOAL_SOURCE, NO_GOAL_SOURCE_KEYS } from './sopModel';

const NO_GOAL_SOURCE_ORDER = [
  NO_GOAL_SOURCE_KEYS.totalGoalsUnder,
  NO_GOAL_SOURCE_KEYS.correctScore,
  NO_GOAL_SOURCE_KEYS.nextGoalMethod,
  NO_GOAL_SOURCE_KEYS.nthGoalNeither,
  NO_GOAL_SOURCE_KEYS.nextGoalscorer,
];

const SOURCE_RANK = Object.fromEntries(NO_GOAL_SOURCE_ORDER.map((key, index) => [key, index]));
const BOOK_RANK = { fd: 0, dk: 1, klsh: 2 };

export function quoteForNoGoalBook(game, sourceKey, book) {
  if (book === 'dk') return game.dk?.noGoalMarkets?.[sourceKey];
  if (book === 'klsh') return game.klsh?.noGoalMarkets?.[sourceKey];
  return game.noGoalMarkets?.[sourceKey];
}

function isBetterPick(candidate, current) {
  if (candidate.american > current.american) return true;
  if (candidate.american < current.american) return false;

  const sourceDelta = SOURCE_RANK[candidate.sourceKey] - SOURCE_RANK[current.sourceKey];
  if (sourceDelta !== 0) return sourceDelta < 0;

  return BOOK_RANK[candidate.book] - BOOK_RANK[current.book] < 0;
}

/** Highest American no-goal odds across FD, DK, KLSH and all proxy columns. */
export function findLongestNoGoalPick(game) {
  const books = [
    { book: 'fd', available: true },
    { book: 'dk', available: Boolean(game.dk) },
    { book: 'klsh', available: Boolean(game.klsh) },
  ];

  let best = null;

  for (const sourceKey of NO_GOAL_SOURCE_ORDER) {
    for (const { book, available } of books) {
      if (!available) continue;
      const american = quoteForNoGoalBook(game, sourceKey, book)?.american;
      if (!Number.isFinite(american)) continue;

      const candidate = { sourceKey, book, american };
      if (!best || isBetterPick(candidate, best)) {
        best = candidate;
      }
    }
  }

  if (!best) {
    return { sourceKey: DEFAULT_NO_GOAL_SOURCE, book: 'fd', american: null };
  }

  return { sourceKey: best.sourceKey, book: best.book, american: best.american };
}
