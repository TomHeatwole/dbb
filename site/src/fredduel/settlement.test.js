import {
  MARKET_RESULT,
  assignPlaces,
  playoffCutDecision,
  weeksNeededForMarket,
  settlementModeForOffer,
  resolveOffer,
  settlementPayout,
  applyResolvedOfferToBet,
  applyAutoSettlementsToDb,
  applyManualSettlementToBet,
} from './settlement';
import { buildSettlementSnapshot, playoffFormatForSeason } from './settlementSnapshot';
import { PLAYOFF_FORMAT_BRACKET, PLAYOFF_FORMAT_CUMULATIVE } from '../scenarios/playoffStandings';

function snap(weekPoints, completedWeeks, extra = {}) {
  const rosterIds = extra.rosterIds || [...new Set(
    Object.values(weekPoints).flatMap((m) => Object.keys(m).map(Number)),
  )].sort((a, b) => a - b);
  return {
    completedWeeks,
    weekPoints,
    rosterIds,
    finalStandings: extra.finalStandings || null,
    playoffFormat: extra.playoffFormat || PLAYOFF_FORMAT_BRACKET,
  };
}

describe('settlementModeForOffer', () => {
  it('marks custom as manual and structured as auto', () => {
    expect(settlementModeForOffer({ marketKind: 'custom', market: null })).toBe('manual');
    expect(settlementModeForOffer({
      marketKind: 'weekly',
      market: { kind: 'weekly', outcome: 'weekly_points_over', week: 1, teamRosterId: 1, points: 100 },
    })).toBe('auto');
  });
});

describe('weeksNeededForMarket', () => {
  it('uses the market window', () => {
    expect(weeksNeededForMarket('weekly', { week: 3 })).toBe(3);
    expect(weeksNeededForMarket('season', { outcome: 'make_playoffs' })).toBe(14);
    expect(weeksNeededForMarket('season', { outcome: 'win_league' })).toBe(17);
    expect(weeksNeededForMarket('custom', null)).toBe(null);
  });
});

describe('playoffCutDecision', () => {
  const standings = assignPlaces([
    { rosterId: 1, points: 200 },
    { rosterId: 2, points: 180 },
    { rosterId: 3, points: 160 },
    { rosterId: 4, points: 140 },
    { rosterId: 5, points: 140 },
    { rosterId: 6, points: 100 },
  ], 'points');

  it('locks the clear top 3 in and the clear 6th out', () => {
    expect(playoffCutDecision(standings, 1).decision).toBe(MARKET_RESULT.YES);
    expect(playoffCutDecision(standings, 3).decision).toBe(MARKET_RESULT.YES);
    expect(playoffCutDecision(standings, 6).decision).toBe(MARKET_RESULT.NO);
  });

  it('hands a 4th-place points tie to a human', () => {
    expect(playoffCutDecision(standings, 4).decision).toBe(MARKET_RESULT.MANUAL);
    expect(playoffCutDecision(standings, 5).decision).toBe(MARKET_RESULT.MANUAL);
  });
});

describe('resolveOffer weekly', () => {
  const week1 = { 1: 120, 2: 110, 3: 90, 4: 110 };
  const snapshot = snap({ 1: week1 }, 1);

  it('waits until the week is complete', () => {
    const pending = resolveOffer({
      marketKind: 'weekly',
      market: { week: 2, teamRosterId: 1, outcome: 'weekly_points_over', points: 100 },
    }, snapshot);
    expect(pending.status).toBe(MARKET_RESULT.PENDING);
  });

  it('grades over / under / outscore including a push', () => {
    expect(resolveOffer({
      marketKind: 'weekly',
      market: { week: 1, teamRosterId: 1, outcome: 'weekly_points_over', points: 100 },
    }, snapshot).status).toBe(MARKET_RESULT.YES);
    expect(resolveOffer({
      marketKind: 'weekly',
      market: { week: 1, teamRosterId: 1, outcome: 'weekly_points_over', points: 120 },
    }, snapshot).status).toBe(MARKET_RESULT.PUSH);
    expect(resolveOffer({
      marketKind: 'weekly',
      market: { week: 1, teamRosterId: 1, outcome: 'weekly_outscore', opponentRosterId: 2 },
    }, snapshot).status).toBe(MARKET_RESULT.YES);
    expect(resolveOffer({
      marketKind: 'weekly',
      market: { week: 1, teamRosterId: 2, outcome: 'weekly_outscore', opponentRosterId: 4 },
    }, snapshot).status).toBe(MARKET_RESULT.PUSH);
  });

  it('grades weekly place lines', () => {
    expect(resolveOffer({
      marketKind: 'weekly',
      market: { week: 1, teamRosterId: 1, outcome: 'weekly_finish_above', place: 1.5 },
    }, snapshot).status).toBe(MARKET_RESULT.YES);
    expect(resolveOffer({
      marketKind: 'weekly',
      market: { week: 1, teamRosterId: 3, outcome: 'weekly_finish_below', place: 2.5 },
    }, snapshot).status).toBe(MARKET_RESULT.YES);
  });
});

describe('resolveOffer season', () => {
  it('grades 14-week points and playoff makes after week 14', () => {
    const weekPoints = {};
    for (let w = 1; w <= 14; w += 1) {
      weekPoints[w] = { 1: 20, 2: 15, 3: 10, 4: 8, 5: 5 };
    }
    const snapshot = snap(weekPoints, 14);
    expect(resolveOffer({
      marketKind: 'season',
      market: { outcome: 'points_over_14', teamRosterId: 1, points: 200 },
    }, snapshot).status).toBe(MARKET_RESULT.YES);
    expect(resolveOffer({
      marketKind: 'season',
      market: { outcome: 'make_playoffs', teamRosterId: 1 },
    }, snapshot).status).toBe(MARKET_RESULT.YES);
    expect(resolveOffer({
      marketKind: 'season',
      market: { outcome: 'miss_playoffs', teamRosterId: 5 },
    }, snapshot).status).toBe(MARKET_RESULT.YES);
    expect(resolveOffer({
      marketKind: 'season',
      market: { outcome: 'win_league', teamRosterId: 1 },
    }, snapshot).status).toBe(MARKET_RESULT.PENDING);
  });

  it('uses final standings for finish / champion', () => {
    const snapshot = snap({}, 17, {
      finalStandings: [
        { rosterId: 1, place: 1 },
        { rosterId: 2, place: 2 },
        { rosterId: 3, place: 8 },
      ],
    });
    expect(resolveOffer({
      marketKind: 'season',
      market: { outcome: 'win_league', teamRosterId: 1 },
    }, snapshot).status).toBe(MARKET_RESULT.YES);
    expect(resolveOffer({
      marketKind: 'season',
      market: { outcome: 'win_league', teamRosterId: 2 },
    }, snapshot).status).toBe(MARKET_RESULT.NO);
    expect(resolveOffer({
      marketKind: 'season',
      market: { outcome: 'finish_better', teamRosterId: 2, place: 2.5 },
    }, snapshot).status).toBe(MARKET_RESULT.YES);
    expect(resolveOffer({
      marketKind: 'season',
      market: { outcome: 'finish_above_team', teamRosterId: 1, opponentRosterId: 3 },
    }, snapshot).status).toBe(MARKET_RESULT.YES);
  });

  it('leaves custom markets manual', () => {
    expect(resolveOffer({ marketKind: 'custom', market: null, title: 'Both miss' }, snap({}, 17)).status)
      .toBe(MARKET_RESULT.MANUAL);
  });
});

describe('applyResolvedOfferToBet', () => {
  const bet = {
    id: 'b1', offerId: 'o1', status: 'live', takerStake: 10, creatorRisk: 15,
  };

  it('pays the taker on yes and the creator on no; voids a push', () => {
    const yesBet = applyResolvedOfferToBet(bet, { status: MARKET_RESULT.YES, detail: 'hit' }, {
      now: '2026-09-11T12:00:00.000Z',
    });
    expect(yesBet.status).toBe('settled');
    expect(yesBet.result).toBe('taker');
    expect(settlementPayout(bet, 'taker')).toEqual({ takerDelta: 15, creatorDelta: -15 });

    const noBet = applyResolvedOfferToBet(bet, { status: MARKET_RESULT.NO });
    expect(noBet.result).toBe('creator');
    expect(settlementPayout(bet, 'creator')).toEqual({ takerDelta: -10, creatorDelta: 10 });

    const voidBet = applyResolvedOfferToBet(bet, { status: MARKET_RESULT.PUSH, detail: 'tie' });
    expect(voidBet.status).toBe('void');
    expect(voidBet.result).toBe(null);
    expect(settlementPayout(bet, null)).toEqual({ takerDelta: 0, creatorDelta: 0 });
  });

  it('does not grade pending or manual', () => {
    expect(applyResolvedOfferToBet(bet, { status: MARKET_RESULT.PENDING })).toBe(bet);
    expect(applyResolvedOfferToBet(bet, { status: MARKET_RESULT.MANUAL })).toBe(bet);
  });
});

describe('applyManualSettlementToBet', () => {
  const bet = { id: 'b1', status: 'live', takerStake: 10, creatorRisk: 30 };

  it('grades taker, layer, and void by hand', () => {
    expect(applyManualSettlementToBet(bet, 'taker').result).toBe('taker');
    expect(applyManualSettlementToBet(bet, 'creator').status).toBe('settled');
    expect(applyManualSettlementToBet(bet, 'push').status).toBe('void');
    expect(applyManualSettlementToBet(bet, 'push').settledBy).toBe('manual');
  });
});

describe('applyAutoSettlementsToDb', () => {
  it('grades only the live structured bets that are ready', () => {
    const offers = [
      {
        id: 'o1', title: 'A over 100', marketKind: 'weekly',
        market: { week: 1, teamRosterId: 1, outcome: 'weekly_points_over', points: 100 },
      },
      { id: 'o2', title: 'Custom', marketKind: 'custom', market: null },
    ];
    const bets = [
      { id: 'b1', offerId: 'o1', status: 'live', takerStake: 5, creatorRisk: 5 },
      { id: 'b2', offerId: 'o2', status: 'live', takerStake: 5, creatorRisk: 5 },
    ];
    const { bets: next, changes } = applyAutoSettlementsToDb(
      offers,
      bets,
      snap({ 1: { 1: 130 } }, 1),
    );
    expect(next[0].status).toBe('settled');
    expect(next[1].status).toBe('live');
    expect(changes).toHaveLength(1);
    expect(changes[0].winner).toBe('taker');
  });
});

describe('buildSettlementSnapshot', () => {
  it('uses only completed weeks and builds finals after week 17', () => {
    const weeks = [];
    for (let w = 0; w < 17; w += 1) {
      weeks.push([
        { roster_id: 1, points: w < 14 ? 100 : 40 },
        { roster_id: 2, points: w < 14 ? 90 : 50 },
        { roster_id: 3, points: w < 14 ? 80 : 30 },
        { roster_id: 4, points: w < 14 ? 70 : 20 },
        { roster_id: 5, points: 10 },
      ]);
    }
    const partial = buildSettlementSnapshot(weeks, { completedWeeks: 3, season: 2026 });
    expect(partial.completedWeeks).toBe(3);
    expect(partial.weekPoints[4]).toBeUndefined();
    expect(partial.finalStandings).toBe(null);
    expect(playoffFormatForSeason(2026)).toBe(PLAYOFF_FORMAT_CUMULATIVE);
    expect(playoffFormatForSeason(2025)).toBe(PLAYOFF_FORMAT_BRACKET);
    expect(playoffFormatForSeason(2024)).toBe(PLAYOFF_FORMAT_CUMULATIVE);

    const full = buildSettlementSnapshot(weeks, { completedWeeks: 17, season: 2026 });
    expect(full.finalStandings.find((r) => r.place === 1).rosterId).toBe(2);
    expect(resolveOffer({
      marketKind: 'season',
      market: { outcome: 'win_league', teamRosterId: 2 },
    }, full).status).toBe(MARKET_RESULT.YES);
  });
});
