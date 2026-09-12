/**
 * FredDuel settlement resolver.
 *
 * Structured season / weekly markets settle from a completed-week snapshot
 * of Sleeper scores + the same final-standings rules as /yoffs. Custom
 * markets are always manual — they have no machine-readable outcome.
 *
 * The one structured case that still needs a human: a points tie that
 * straddles the 4-team playoff cut (make_playoffs / miss_playoffs). Vegas
 * half-point place lines never push; exact points / head-to-head score
 * ties void (push).
 *
 * This module is pure. It does not write Neon, pay anyone, or run on a
 * timer. A later job can call resolveOffer / applyAutoSettlementsToDb.
 */

import { MARKET_KINDS } from './markets';
import { roundCents } from './oddsMath';

export const MARKET_RESULT = {
  PENDING: 'pending',
  YES: 'yes',
  NO: 'no',
  PUSH: 'push',
  MANUAL: 'manual',
};

export const SETTLED_BY = {
  AUTO: 'auto',
  MANUAL: 'manual',
};

export const BET_WINNER = {
  TAKER: 'taker',
  CREATOR: 'creator',
};

const PLAYOFF_SPOTS = 4;
const REG_SEASON_END = 14;
const SEASON_END = 17;

function asMarket(market) {
  if (!market) return null;
  if (typeof market === 'string') {
    try { return JSON.parse(market); } catch { return null; }
  }
  return market;
}

function rid(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function tenth(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

/** Rank rows by points desc; ties share place and skip (1,1,3). */
export function assignPlaces(rows, pointsKey = 'points') {
  const arr = (rows || []).map((row) => ({ ...row }));
  arr.sort((a, b) => tenth(b[pointsKey]) - tenth(a[pointsKey]));
  let place = 1;
  let i = 0;
  while (i < arr.length) {
    const pts = tenth(arr[i][pointsKey]);
    let j = i;
    while (j < arr.length && tenth(arr[j][pointsKey]) === pts) j += 1;
    const numTied = j - i;
    for (let k = i; k < j; k += 1) {
      arr[k].place = place;
      arr[k].numTied = numTied;
    }
    i = j;
    place += numTied;
  }
  return arr;
}

function weekScore(snapshot, rosterId, week) {
  const id = rid(rosterId);
  const pts = snapshot?.weekPoints?.[week]?.[id];
  if (pts == null && snapshot?.weekPoints?.[week]?.[String(id)] == null) return null;
  return tenth(pts ?? snapshot.weekPoints[week][String(id)]);
}

function pointsThrough(snapshot, rosterId, startWeek, endWeek) {
  let sum = 0;
  let saw = false;
  for (let w = startWeek; w <= endWeek; w += 1) {
    const pts = weekScore(snapshot, rosterId, w);
    if (pts == null) continue;
    saw = true;
    sum += pts;
  }
  return saw ? tenth(sum) : null;
}

function standingsThrough(snapshot, endWeek) {
  const ids = new Set(snapshot?.rosterIds || []);
  const weekMap = snapshot?.weekPoints || {};
  Object.keys(weekMap).forEach((w) => {
    Object.keys(weekMap[w] || {}).forEach((id) => ids.add(Number(id)));
  });
  const rows = [...ids].filter((id) => Number.isInteger(id)).map((rosterId) => ({
    rosterId,
    points: pointsThrough(snapshot, rosterId, 1, endWeek) ?? 0,
  }));
  return assignPlaces(rows, 'points');
}

function placeOf(standings, rosterId) {
  const row = (standings || []).find((r) => Number(r.rosterId) === rid(rosterId));
  return row ? Number(row.place) : null;
}

function result(status, extra = {}) {
  return { status, ...extra };
}

function yes(detail) { return result(MARKET_RESULT.YES, { detail }); }
function no(detail) { return result(MARKET_RESULT.NO, { detail }); }
function push(detail) { return result(MARKET_RESULT.PUSH, { detail }); }
function pending(detail) { return result(MARKET_RESULT.PENDING, { detail }); }
function manual(detail) { return result(MARKET_RESULT.MANUAL, { detail }); }

function compareOver(score, line) {
  if (score > line) return yes(`${score} > ${line}`);
  if (score < line) return no(`${score} < ${line}`);
  return push(`${score} exactly ${line}`);
}

function compareUnder(score, line) {
  if (score < line) return yes(`${score} < ${line}`);
  if (score > line) return no(`${score} > ${line}`);
  return push(`${score} exactly ${line}`);
}

function compareGreater(a, b, aLabel, bLabel) {
  if (a > b) return yes(`${aLabel} ${a} > ${bLabel} ${b}`);
  if (a < b) return no(`${aLabel} ${a} < ${bLabel} ${b}`);
  return push(`${aLabel} and ${bLabel} tied at ${a}`);
}

/**
 * Playoff-cut rule without a tiebreak: a team is in if fewer than 4 teams
 * are strictly ahead and at most 4 teams have ≥ their points. Out if at
 * least 4 teams are strictly ahead. Anything else straddles the cut.
 */
export function playoffCutDecision(standings, rosterId) {
  const id = rid(rosterId);
  const me = (standings || []).find((r) => Number(r.rosterId) === id);
  if (!me) return { decision: MARKET_RESULT.MANUAL, detail: 'Team has no regular-season score.' };
  const myPts = tenth(me.points);
  let ahead = 0;
  let geq = 0;
  for (const row of standings) {
    const pts = tenth(row.points);
    if (pts > myPts) ahead += 1;
    if (pts >= myPts) geq += 1;
  }
  if (ahead >= PLAYOFF_SPOTS) {
    return { decision: MARKET_RESULT.NO, detail: `${ahead} teams scored more than ${myPts}` };
  }
  if (geq <= PLAYOFF_SPOTS) {
    return { decision: MARKET_RESULT.YES, detail: `${ahead} ahead, ${geq} at-or-above ${myPts}` };
  }
  return {
    decision: MARKET_RESULT.MANUAL,
    detail: `Points tie straddles the top-${PLAYOFF_SPOTS} cut (${ahead} ahead, ${geq} at-or-above ${myPts}).`,
  };
}

export function weeksNeededForMarket(marketKind, market) {
  const m = asMarket(market);
  if (marketKind === MARKET_KINDS.CUSTOM || !m) return null;
  if (marketKind === MARKET_KINDS.WEEKLY) {
    const week = Number(m.week);
    return Number.isInteger(week) ? week : null;
  }
  switch (m.outcome) {
    case 'make_playoffs':
    case 'miss_playoffs':
    case 'season_outscore_14':
    case 'points_over_14':
    case 'points_under_14':
      return REG_SEASON_END;
    default:
      return SEASON_END;
  }
}

export function settlementModeForOffer(offer) {
  const kind = offer?.marketKind;
  const market = asMarket(offer?.market);
  if (kind === MARKET_KINDS.CUSTOM || !market) return SETTLED_BY.MANUAL;
  if (kind === MARKET_KINDS.SEASON || kind === MARKET_KINDS.WEEKLY) return SETTLED_BY.AUTO;
  return SETTLED_BY.MANUAL;
}

function resolveWeekly(market, snapshot) {
  const week = Number(market.week);
  const completed = Number(snapshot?.completedWeeks) || 0;
  if (!Number.isInteger(week) || week < 1) {
    return manual('Weekly market is missing a week.');
  }
  if (completed < week) {
    return pending(`Week ${week} is not complete (completed through ${completed}).`);
  }
  const team = rid(market.teamRosterId);
  const score = weekScore(snapshot, team, week);
  if (score == null) return manual(`No week-${week} score for roster ${team}.`);

  if (market.outcome === 'weekly_points_over') {
    return compareOver(score, Number(market.points));
  }
  if (market.outcome === 'weekly_points_under') {
    return compareUnder(score, Number(market.points));
  }
  if (market.outcome === 'weekly_outscore') {
    const opp = weekScore(snapshot, market.opponentRosterId, week);
    if (opp == null) return manual(`No week-${week} score for opponent.`);
    return compareGreater(score, opp, 'team', 'opponent');
  }
  if (market.outcome === 'weekly_finish_above' || market.outcome === 'weekly_finish_below') {
    const ids = snapshot.rosterIds?.length
      ? snapshot.rosterIds
      : Object.keys(snapshot.weekPoints?.[week] || {});
    const standings = assignPlaces(
      ids.map((id) => ({
        rosterId: Number(id),
        points: weekScore(snapshot, id, week) ?? 0,
      })),
      'points',
    );
    const place = placeOf(standings, team);
    if (place == null) return manual('Team is missing from weekly standings.');
    const line = Number(market.place);
    if (market.outcome === 'weekly_finish_above') {
      return place < line ? yes(`place ${place} < ${line}`) : no(`place ${place} is not better than ${line}`);
    }
    return place > line ? yes(`place ${place} > ${line}`) : no(`place ${place} is not worse than ${line}`);
  }
  return manual(`Unknown weekly outcome ${market.outcome}.`);
}

function resolveSeason(market, snapshot) {
  const needed = weeksNeededForMarket(MARKET_KINDS.SEASON, market);
  const completed = Number(snapshot?.completedWeeks) || 0;
  if (completed < needed) {
    return pending(`Needs week ${needed} (completed through ${completed}).`);
  }
  const team = rid(market.teamRosterId);

  if (market.outcome === 'points_over_14' || market.outcome === 'points_under_14'
    || market.outcome === 'points_over_17' || market.outcome === 'points_under_17') {
    const end = market.outcome.endsWith('_14') ? REG_SEASON_END : SEASON_END;
    const score = pointsThrough(snapshot, team, 1, end);
    if (score == null) return manual(`No points through week ${end} for roster ${team}.`);
    return market.outcome.includes('over')
      ? compareOver(score, Number(market.points))
      : compareUnder(score, Number(market.points));
  }

  if (market.outcome === 'season_outscore_14' || market.outcome === 'season_outscore_17') {
    const end = market.outcome.endsWith('_14') ? REG_SEASON_END : SEASON_END;
    const score = pointsThrough(snapshot, team, 1, end);
    const opp = pointsThrough(snapshot, market.opponentRosterId, 1, end);
    if (score == null || opp == null) return manual('Missing season points for a side.');
    return compareGreater(score, opp, 'team', 'opponent');
  }

  if (market.outcome === 'make_playoffs' || market.outcome === 'miss_playoffs') {
    const standings = standingsThrough(snapshot, REG_SEASON_END);
    const cut = playoffCutDecision(standings, team);
    if (cut.decision === MARKET_RESULT.MANUAL) return manual(cut.detail);
    if (market.outcome === 'make_playoffs') {
      return cut.decision === MARKET_RESULT.YES ? yes(cut.detail) : no(cut.detail);
    }
    return cut.decision === MARKET_RESULT.NO ? yes(cut.detail) : no(cut.detail);
  }

  const finals = snapshot?.finalStandings;
  if (!Array.isArray(finals) || finals.length === 0) {
    return pending('Final standings are not ready.');
  }
  const place = placeOf(finals, team);
  if (place == null) return manual(`Roster ${team} is missing from final standings.`);

  if (market.outcome === 'win_league') {
    return place === 1 ? yes('Finished 1st') : no(`Finished ${place}`);
  }
  if (market.outcome === 'finish_better') {
    const line = Number(market.place);
    return place < line ? yes(`place ${place} < ${line}`) : no(`place ${place} is not better than ${line}`);
  }
  if (market.outcome === 'finish_worse') {
    const line = Number(market.place);
    return place > line ? yes(`place ${place} > ${line}`) : no(`place ${place} is not worse than ${line}`);
  }
  if (market.outcome === 'finish_above_team') {
    const oppPlace = placeOf(finals, market.opponentRosterId);
    if (oppPlace == null) return manual('Opponent is missing from final standings.');
    if (place < oppPlace) return yes(`place ${place} beats ${oppPlace}`);
    if (place > oppPlace) return no(`place ${place} loses to ${oppPlace}`);
    return push(`Both finished ${place}`);
  }
  return manual(`Unknown season outcome ${market.outcome}.`);
}

/**
 * Decide a structured (or custom) market. Never writes.
 *
 * @returns {{ status: string, detail?: string }}
 */
export function resolveOffer(offer, snapshot) {
  const kind = offer?.marketKind;
  const market = asMarket(offer?.market);
  if (kind === MARKET_KINDS.CUSTOM || !market) {
    return manual('Custom markets settle by hand.');
  }
  if (kind === MARKET_KINDS.WEEKLY) return resolveWeekly(market, snapshot);
  if (kind === MARKET_KINDS.SEASON) return resolveSeason(market, snapshot);
  return manual(`Unknown market kind ${kind}.`);
}

/** Informational P&L if this bet is graded. Deltas are from each side's pocket. */
export function settlementPayout(bet, winner) {
  const stake = Number(bet?.takerStake) || 0;
  const risk = Number(bet?.creatorRisk) || 0;
  if (winner === BET_WINNER.TAKER) {
    return { takerDelta: roundCents(risk), creatorDelta: roundCents(-risk) };
  }
  if (winner === BET_WINNER.CREATOR) {
    return { takerDelta: roundCents(-stake), creatorDelta: roundCents(stake) };
  }
  return { takerDelta: 0, creatorDelta: 0 };
}

export function winnerFromMarketResult(status) {
  if (status === MARKET_RESULT.YES) return BET_WINNER.TAKER;
  if (status === MARKET_RESULT.NO) return BET_WINNER.CREATOR;
  return null;
}

export function betStatusFromMarketResult(status) {
  if (status === MARKET_RESULT.PUSH) return 'void';
  if (status === MARKET_RESULT.YES || status === MARKET_RESULT.NO) return 'settled';
  return null;
}

/**
 * Grade a live bet from a resolved offer. Returns the same object when
 * the market is still pending or manual.
 */
export function applyResolvedOfferToBet(bet, resolved, { now = new Date(), settledBy = SETTLED_BY.AUTO } = {}) {
  if (!bet || bet.status !== 'live') return bet;
  const nextStatus = betStatusFromMarketResult(resolved?.status);
  if (!nextStatus) return bet;
  const winner = winnerFromMarketResult(resolved.status);
  return {
    ...bet,
    status: nextStatus,
    result: winner,
    settledAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    settledBy,
    settlementNote: resolved.detail || '',
  };
}

export function applyManualSettlementToBet(bet, result, { now = new Date(), note } = {}) {
  if (result === 'push') {
    return applyResolvedOfferToBet(
      bet,
      { status: MARKET_RESULT.PUSH, detail: note || 'Voided by hand.' },
      { now, settledBy: SETTLED_BY.MANUAL },
    );
  }
  if (result === BET_WINNER.TAKER) {
    return applyResolvedOfferToBet(
      bet,
      { status: MARKET_RESULT.YES, detail: note || 'Graded by hand: backer.' },
      { now, settledBy: SETTLED_BY.MANUAL },
    );
  }
  if (result === BET_WINNER.CREATOR) {
    return applyResolvedOfferToBet(
      bet,
      { status: MARKET_RESULT.NO, detail: note || 'Graded by hand: layer.' },
      { now, settledBy: SETTLED_BY.MANUAL },
    );
  }
  return bet;
}

export function applyAutoSettlementsToDb(offers, bets, snapshot, now = new Date()) {
  const byOffer = new Map((offers || []).map((o) => [o.id, o]));
  const changes = [];
  const nextBets = (bets || []).map((bet) => {
    if (bet.status !== 'live') return bet;
    const offer = byOffer.get(bet.offerId);
    if (!offer) return bet;
    const resolved = resolveOffer(offer, snapshot);
    const graded = applyResolvedOfferToBet(bet, resolved, { now, settledBy: SETTLED_BY.AUTO });
    if (graded === bet) return bet;
    changes.push({
      betId: bet.id,
      offerId: offer.id,
      title: offer.title,
      marketResult: resolved.status,
      detail: resolved.detail || '',
      winner: graded.result,
      status: graded.status,
      payout: settlementPayout(bet, graded.result),
    });
    return graded;
  });
  return { bets: nextBets, changes };
}

export function previewOfferSettlements(offers, snapshot) {
  return (offers || []).map((offer) => ({
    offerId: offer.id,
    title: offer.title,
    marketKind: offer.marketKind,
    mode: settlementModeForOffer(offer),
    weeksNeeded: weeksNeededForMarket(offer.marketKind, offer.market),
    ...resolveOffer(offer, snapshot),
  }));
}
