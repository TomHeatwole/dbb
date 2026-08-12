// Structured market definitions for FredDuel offers.
//
// A "market" describes what the bet is about. Structured offers pick a team
// plus an outcome (season-long or single-week); custom offers are freeform
// title + description. The offer's title is always rendered from the market
// at creation time so cards can just display `offer.title`.

export const MARKET_KINDS = {
  SEASON: 'season',
  WEEKLY: 'weekly',
  CUSTOM: 'custom',
};

export function ordinal(n) {
  const v = Number(n);
  const rem100 = v % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}

// Place lines use Vegas-style half points so there's never a push in a
// 10-team league: "better than 1.5" = 1st overall, "worse than 9.5" = last.
export const PLACE_LINES = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5];

/** Human helper for a half-point place line, from the given direction. */
export function describePlaceLine(place, direction) {
  const p = Number(place);
  if (direction === 'better') {
    return p === 1.5 ? '1st only' : `top ${p - 0.5}`;
  }
  return p === 9.5 ? 'last only' : `${ordinal(p + 0.5)} or worse`;
}

// needs: which extra input the outcome requires
// ('place' | 'points' | 'opponent' | null).
export const SEASON_OUTCOMES = [
  { id: 'win_league', label: 'To win the league', needs: null },
  { id: 'make_playoffs', label: 'To make the playoffs', needs: null },
  { id: 'miss_playoffs', label: 'To miss the playoffs', needs: null },
  { id: 'finish_better', label: 'To finish better than N.5 place', needs: 'place', placeDirection: 'better' },
  { id: 'finish_worse', label: 'To finish worse than N.5 place', needs: 'place', placeDirection: 'worse' },
  { id: 'finish_above_team', label: 'To finish better than… (head-to-head)', needs: 'opponent' },
  { id: 'season_outscore_14', label: 'To outscore… (head-to-head, weeks 1-14)', needs: 'opponent' },
  { id: 'season_outscore_17', label: 'To outscore… (head-to-head, weeks 1-17)', needs: 'opponent' },
  { id: 'points_over_14', label: 'To score more than N points (weeks 1-14)', needs: 'points' },
  { id: 'points_under_14', label: 'To score fewer than N points (weeks 1-14)', needs: 'points' },
  { id: 'points_over_17', label: 'To score more than N points (weeks 1-17)', needs: 'points' },
  { id: 'points_under_17', label: 'To score fewer than N points (weeks 1-17)', needs: 'points' },
];

export const WEEKLY_OUTCOMES = [
  { id: 'weekly_outscore', label: 'To outscore… (head-to-head)', needs: 'opponent' },
  { id: 'weekly_finish_above', label: 'To finish better than N.5 in weekly scoring', needs: 'place', placeDirection: 'better' },
  { id: 'weekly_finish_below', label: 'To finish worse than N.5 in weekly scoring', needs: 'place', placeDirection: 'worse' },
  { id: 'weekly_points_over', label: 'To score more than N points', needs: 'points' },
  { id: 'weekly_points_under', label: 'To score fewer than N points', needs: 'points' },
];

export function outcomesForKind(kind) {
  if (kind === MARKET_KINDS.SEASON) return SEASON_OUTCOMES;
  if (kind === MARKET_KINDS.WEEKLY) return WEEKLY_OUTCOMES;
  return [];
}

export function findOutcome(kind, outcomeId) {
  return outcomesForKind(kind).find((o) => o.id === outcomeId) || null;
}

function fmtPoints(points) {
  const n = Number(points);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '?';
}

/**
 * Render a human title for a structured market:
 * { kind, teamName, outcome, place, points, week }
 * Custom markets carry their own title and never call this.
 */
export function describeMarket(market) {
  if (!market) return '';
  const team = market.teamName || 'Team ?';
  const opp = market.opponentName || 'Team ?';
  const { outcome, place, points, week } = market;

  if (market.kind === MARKET_KINDS.SEASON) {
    switch (outcome) {
      case 'win_league': return `${team} to win the league`;
      case 'make_playoffs': return `${team} to make the playoffs`;
      case 'miss_playoffs': return `${team} to miss the playoffs`;
      case 'finish_better': return `${team} to finish better than ${place} place`;
      case 'finish_worse': return `${team} to finish worse than ${place} place`;
      case 'finish_above_team': return `${team} to finish better than ${opp} in the standings`;
      case 'season_outscore_14': return `${team} to outscore ${opp} (weeks 1-14)`;
      case 'season_outscore_17': return `${team} to outscore ${opp} (weeks 1-17)`;
      case 'points_over_14': return `${team} to score more than ${fmtPoints(points)} points (weeks 1-14)`;
      case 'points_under_14': return `${team} to score fewer than ${fmtPoints(points)} points (weeks 1-14)`;
      case 'points_over_17': return `${team} to score more than ${fmtPoints(points)} points (weeks 1-17)`;
      case 'points_under_17': return `${team} to score fewer than ${fmtPoints(points)} points (weeks 1-17)`;
      default: return `${team} — ${outcome}`;
    }
  }

  if (market.kind === MARKET_KINDS.WEEKLY) {
    const wk = `week ${week}`;
    switch (outcome) {
      case 'weekly_outscore': return `${team} to outscore ${opp} in ${wk}`;
      case 'weekly_finish_above': return `${team} to finish better than ${place} in ${wk} scoring`;
      case 'weekly_finish_below': return `${team} to finish worse than ${place} in ${wk} scoring`;
      case 'weekly_points_over': return `${team} to score more than ${fmtPoints(points)} points in ${wk}`;
      case 'weekly_points_under': return `${team} to score fewer than ${fmtPoints(points)} points in ${wk}`;
      default: return `${team} — ${outcome} (${wk})`;
    }
  }

  return '';
}

/**
 * Validate a structured market spec. Returns an error string or null.
 */
export function validateMarket(market) {
  if (!market || !market.kind) return 'Pick a bet type.';
  if (market.kind === MARKET_KINDS.CUSTOM) return null;

  if (market.teamRosterId == null) return 'Pick a team.';
  const def = findOutcome(market.kind, market.outcome);
  if (!def) return 'Pick an outcome.';
  if (market.kind === MARKET_KINDS.WEEKLY) {
    const wk = Number(market.week);
    if (!Number.isInteger(wk) || wk < 1 || wk > 17) return 'Pick a week (1-17).';
  }
  if (def.needs === 'place') {
    const p = Number(market.place);
    if (!PLACE_LINES.includes(p)) {
      return 'Pick a place line between 1.5 and 9.5.';
    }
  }
  if (def.needs === 'points') {
    const pts = Number(market.points);
    if (!Number.isFinite(pts) || pts <= 0) return 'Enter a points total.';
  }
  if (def.needs === 'opponent') {
    if (market.opponentRosterId == null) return 'Pick an opponent.';
    if (Number(market.opponentRosterId) === Number(market.teamRosterId)) {
      return 'Head-to-head needs two different teams.';
    }
  }
  return null;
}
