// Seed data for the FredDuel test database (localStorage-backed).
//
// Team roster ids match the real league so the "acting as" picker lines up
// with live Sleeper data when it loads; names are a snapshot fallback.

import { MARKET_KINDS, describeMarket } from './markets';

export const FALLBACK_TEAMS = [
  { rosterId: 1, teamName: 'PUPpy Bowl', ownerName: 'sleeperdotcom' },
  { rosterId: 2, teamName: 'Team MrZaccheaus', ownerName: 'MrZaccheaus' },
  { rosterId: 3, teamName: 'The Boomers', ownerName: 'jheatwole' },
  { rosterId: 4, teamName: 'Team seanjcrow', ownerName: 'seanjcrow' },
  { rosterId: 5, teamName: 'House of Hwang', ownerName: 'mhwang12' },
  { rosterId: 6, teamName: 'DrakeHigginsAchane ²', ownerName: 'davisdaniel1' },
  { rosterId: 7, teamName: 'The Ladds', ownerName: 'KobeCopters' },
  { rosterId: 8, teamName: 'Lord Pittsy Flacco Joedy', ownerName: 'dwol11' },
  { rosterId: 9, teamName: 'Sell for Sellers', ownerName: 'fumland7' },
  { rosterId: 10, teamName: 'Eat It While She Sleeper', ownerName: 'GIVEDADDYASPIKE' },
];

export function testActorForRosterId(rosterId, teams) {
  const list = Array.isArray(teams) && teams.length ? teams : FALLBACK_TEAMS;
  const team = list.find((t) => Number(t.rosterId) === Number(rosterId)) || list[0];
  return { id: `test-${team.rosterId}`, name: team.teamName, rosterId: team.rosterId };
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function team(rosterId) {
  return FALLBACK_TEAMS.find((t) => t.rosterId === rosterId);
}

function seasonMarket(rosterId, outcome, extra = {}) {
  return {
    kind: MARKET_KINDS.SEASON,
    teamRosterId: rosterId,
    teamName: team(rosterId).teamName,
    outcome,
    ...extra,
  };
}

function weeklyMarket(rosterId, outcome, week, extra = {}) {
  return {
    kind: MARKET_KINDS.WEEKLY,
    teamRosterId: rosterId,
    teamName: team(rosterId).teamName,
    outcome,
    week,
    ...extra,
  };
}

/**
 * Build a fresh test DB. Times are relative to `now` so countdowns are
 * always interesting when you reset.
 */
export function buildTestSeed(now = Date.now()) {
  const actor = (rid) => ({ id: `test-${rid}`, name: team(rid).teamName });
  const iso = (t) => new Date(t).toISOString();

  const offers = [];
  const bets = [];
  let nextId = 1;

  const addOffer = (o) => {
    const id = `o${nextId++}`;
    offers.push({ status: 'open', minTake: 1, description: '', ...o, id });
    return id;
  };
  const addBet = (b) => {
    const id = `b${nextId++}`;
    bets.push({ status: 'live', ...b, id });
    return id;
  };

  // 1. Fresh season-long offer, untouched.
  const m1 = seasonMarket(5, 'win_league');
  addOffer({
    creatorId: actor(5).id, creatorName: actor(5).name,
    marketKind: m1.kind, market: m1, title: describeMarket(m1),
    line: 450, maxExposure: 90, remainingExposure: 90,
    createdAt: iso(now - 3 * HOUR), expiresAt: iso(now + 2 * DAY),
  });

  // 2. Partially-filled offer: DrakeHigginsAchane ² already took $90 of the
  //    $150 ceiling (staked $135 at -150), leaving $60 on the market.
  const m2 = seasonMarket(9, 'miss_playoffs');
  const partialOfferId = addOffer({
    creatorId: actor(9).id, creatorName: actor(9).name,
    marketKind: m2.kind, market: m2, title: describeMarket(m2),
    line: -150, maxExposure: 150, remainingExposure: 60, minTake: 5,
    maxExposurePerPerson: 90,
    createdAt: iso(now - 26 * HOUR), expiresAt: iso(now + 6 * HOUR),
  });
  addBet({
    offerId: partialOfferId, offerTitle: describeMarket(m2), line: -150,
    creatorId: actor(9).id, creatorName: actor(9).name,
    takerId: actor(6).id, takerName: actor(6).name,
    takerStake: 135, creatorRisk: 90,
    createdAt: iso(now - 5 * HOUR),
  });

  // 2b. Weekly head-to-head offer.
  const m2b = weeklyMarket(3, 'weekly_outscore', 1, {
    opponentRosterId: 4, opponentName: team(4).teamName,
  });
  addOffer({
    creatorId: actor(3).id, creatorName: actor(3).name,
    marketKind: m2b.kind, market: m2b, title: describeMarket(m2b),
    line: -110, maxExposure: 55, remainingExposure: 55,
    createdAt: iso(now - 90 * MIN), expiresAt: iso(now + 18 * HOUR),
  });

  // 3. Weekly offer expiring soon (countdown demo).
  const m3 = weeklyMarket(1, 'weekly_finish_above', 1, { place: 3.5 });
  addOffer({
    creatorId: actor(1).id, creatorName: actor(1).name,
    marketKind: m3.kind, market: m3, title: describeMarket(m3),
    line: 200, maxExposure: 50, remainingExposure: 50,
    createdAt: iso(now - 40 * MIN), expiresAt: iso(now + 12 * MIN),
  });

  // 4. Custom freeform offer.
  addOffer({
    creatorId: actor(8).id, creatorName: actor(8).name,
    marketKind: MARKET_KINDS.CUSTOM, market: null,
    title: 'Mike and Mac to both miss the playoffs',
    description: 'Settles yes only if BOTH teams miss the playoffs. Commissioner is the judge.',
    line: 300, maxExposure: 30, remainingExposure: 30,
    createdAt: iso(now - DAY), expiresAt: iso(now + 5 * DAY),
  });

  // 5. Season points total with a higher minimum.
  const m5 = seasonMarket(7, 'points_over_17', { points: 1650 });
  addOffer({
    creatorId: actor(7).id, creatorName: actor(7).name,
    marketKind: m5.kind, market: m5, title: describeMarket(m5),
    line: -120, maxExposure: 120, remainingExposure: 120, minTake: 10,
    createdAt: iso(now - 8 * HOUR), expiresAt: iso(now + 3 * DAY),
  });

  // 6. Fully-filled offer -> shows up only as a live bet.
  const m6 = seasonMarket(10, 'make_playoffs');
  const filledOfferId = addOffer({
    creatorId: actor(10).id, creatorName: actor(10).name,
    marketKind: m6.kind, market: m6, title: describeMarket(m6),
    line: -200, maxExposure: 100, remainingExposure: 0, status: 'filled',
    createdAt: iso(now - 2 * DAY), expiresAt: iso(now + DAY),
  });
  addBet({
    offerId: filledOfferId, offerTitle: describeMarket(m6), line: -200,
    creatorId: actor(10).id, creatorName: actor(10).name,
    takerId: actor(9).id, takerName: actor(9).name,
    takerStake: 200, creatorRisk: 100,
    createdAt: iso(now - 30 * HOUR),
  });

  // 7. Per-person cap demo: $80 on the board, $25 max to any one account,
  //    so one counterparty can't vacuum the whole offer.
  const mPer = seasonMarket(2, 'make_playoffs');
  addOffer({
    creatorId: actor(2).id, creatorName: actor(2).name,
    marketKind: mPer.kind, market: mPer, title: describeMarket(mPer),
    line: 250, maxExposure: 80, remainingExposure: 80,
    maxExposurePerPerson: 25,
    createdAt: iso(now - 2 * HOUR), expiresAt: iso(now + 4 * DAY),
  });

  // 8. An expired offer (for the "my offers" graveyard).
  const m7 = weeklyMarket(9, 'weekly_points_over', 1, { points: 130 });
  addOffer({
    creatorId: actor(9).id, creatorName: actor(9).name,
    marketKind: m7.kind, market: m7, title: describeMarket(m7),
    line: 110, maxExposure: 25, remainingExposure: 25, status: 'expired',
    createdAt: iso(now - 3 * DAY), expiresAt: iso(now - DAY),
  });

  return { offers, bets, nextId };
}
