import {
  evaluateDriveGame,
  extractHomeSpread,
  featuresFromGame,
  driveCardRole,
  driveNumberFromName,
  driveNumberForSide,
  firstUpSide,
  formatDriveOrdinal,
  inferOffenseSide,
  listDriveSides,
  livePossessionSide,
  scoringSideAfterMadeKick,
  situationOffenseLabel,
  listDriveMarkets,
  shouldShowBothDriveSides,
  liveClockSeconds,
  nameMatchScore,
  predictDriveResult,
} from './driveModel';
import { parseEspnDriveBlob } from './espnDriveChart';
import { ytgFromSpot } from './ytgFromSpot';

function texasStateAtTexas(overrides = {}) {
  const awayMarket = {
    source: 'dk',
    marketName: '1st Texas State Drive Result',
    offenseName: 'Texas State',
    offenseSide: 'away',
    outcomes: {
      punt: { american: -177 },
      td: { american: 463 },
      other: { american: 537 },
      fg: { american: 508 },
    },
  };
  const homeMarket = {
    source: 'dk',
    marketName: '1st Texas Drive Result',
    offenseName: 'Texas',
    offenseSide: 'home',
    outcomes: {
      punt: { american: 230 },
      td: { american: -121 },
      other: { american: 680 },
      fg: { american: 499 },
    },
  };
  return {
    eventId: 'tex-txst',
    name: 'Texas State @ Texas',
    teams: { home: 'Texas', away: 'Texas State' },
    inPlay: false,
    score: { home: 0, away: 0 },
    scoreDisplay: '0-0',
    lines: {
      spread: {
        runners: [
          { runnerName: 'Texas State', handicap: 29.5, american: -110 },
          { runnerName: 'Texas', handicap: -29.5, american: -110 },
        ],
      },
      total: {
        runners: [{ runnerName: 'Over', handicap: 60.5, american: -110 }],
      },
    },
    driveMarkets: [awayMarket, homeMarket],
    nextDrive: awayMarket,
    ...overrides,
  };
}

describe('CFB name collisions (Texas vs Texas State)', () => {
  it('does not treat Texas as a hit on Texas State', () => {
    expect(nameMatchScore('Texas State', 'Texas')).toBeGreaterThan(0);
    expect(nameMatchScore('Texas', 'Texas State')).toBe(0);
    expect(nameMatchScore('1st Texas Drive Result', 'Texas State')).toBe(0);
    expect(nameMatchScore('1st Texas State Drive Result', 'Texas State'))
      .toBeGreaterThan(nameMatchScore('1st Texas State Drive Result', 'Texas'));
  });

  it('reads the home spread from the Texas runner, not Texas State listed first', () => {
    expect(extractHomeSpread(texasStateAtTexas())).toBe(-29.5);
  });

  it('scores each first drive as that team, even if offenseSide is wrong', () => {
    const game = texasStateAtTexas({
      driveMarkets: [
        {
          source: 'dk',
          marketName: '1st Texas State Drive Result',
          offenseName: 'Texas State',
          offenseSide: 'away',
        },
        {
          source: 'dk',
          marketName: '1st Texas Drive Result',
          offenseName: 'Texas State',
          offenseSide: 'away',
        },
      ],
    });
    const txst = game.driveMarkets[0];
    const texas = game.driveMarkets[1];

    expect(inferOffenseSide({ ...game, nextDrive: txst }, txst)).toBe('away');
    expect(inferOffenseSide({ ...game, nextDrive: texas }, texas)).toBe('home');

    const txstFeat = featuresFromGame({ ...game, nextDrive: txst });
    const texasFeat = featuresFromGame({ ...game, nextDrive: texas });

    expect(txstFeat.features.offense_spread).toBe(29.5);
    expect(txstFeat.features.exp_off).toBeCloseTo(15.5, 5);
    expect(texasFeat.features.offense_spread).toBe(-29.5);
    expect(texasFeat.features.exp_off).toBeCloseTo(45.0, 5);
  });

  it('does not price both first drives as a 45-point favorite', () => {
    const game = texasStateAtTexas();
    const txst = evaluateDriveGame(game, { market: game.driveMarkets[0] });
    const texas = evaluateDriveGame(game, { market: game.driveMarkets[1] });
    const txstTd = txst.rows.find((row) => row.key === 'td');
    const texasTd = texas.rows.find((row) => row.key === 'td');

    expect(txst.offenseSide).toBe('away');
    expect(texas.offenseSide).toBe('home');
    expect(txstTd.p).toBeLessThan(0.35);
    expect(texasTd.p).toBeGreaterThan(0.40);
    expect(txstTd.p).toBeLessThan(texasTd.p - 0.15);
    expect(txstTd.fairAmerican).not.toBe(texasTd.fairAmerican);
  });
});

describe('DK granular market filter', () => {
  const fourWay = {
    source: 'dk',
    marketName: '1st Texas Drive Result',
    granular: false,
    offenseSide: 'home',
  };
  const granular = {
    source: 'dk',
    marketName: '1st Texas Drive Result (Granular)',
    granular: true,
    offenseSide: 'home',
  };
  const game = { driveMarkets: [fourWay, granular] };

  it('defaults to the 4-way menu', () => {
    expect(listDriveMarkets(game)).toEqual([fourWay]);
    expect(listDriveMarkets(game, { granular: false })).toEqual([fourWay]);
  });

  it('returns granular when asked', () => {
    expect(listDriveMarkets(game, { granular: true })).toEqual([granular]);
  });

  it('falls back when the requested flavor is missing', () => {
    expect(listDriveMarkets({ driveMarkets: [granular] })).toEqual([granular]);
    expect(listDriveMarkets({ driveMarkets: [fourWay] }, { granular: true })).toEqual([fourWay]);
  });
});

function wazzuAtWashington(live) {
  return {
    inPlay: true,
    teams: { home: 'Washington', away: 'Washington State' },
    score: { home: 10, away: 0 },
    scoreDisplay: '10-0',
    lines: {
      spread: {
        runners: [
          { runnerName: 'Washington State', handicap: 20.5, american: -110 },
          { runnerName: 'Washington', handicap: -20.5, american: -110 },
        ],
      },
      total: { runners: [{ runnerName: 'Over', handicap: 33.5, american: -110 }] },
    },
    live: {
      period: 2,
      down: 1,
      distance: 10,
      yardsToEndzone: 94,
      possession: 'away',
      possessionName: 'Washington State',
      state: 'in',
      ...live,
    },
  };
}

describe('live clock vs stale end-of-half snaps', () => {
  it('does not treat a missing clockSeconds as 0:00', () => {
    expect(liveClockSeconds({ clockSeconds: null, clock: 'Halftime' })).toBeNaN();
    expect(liveClockSeconds({ clockSeconds: undefined })).toBeNaN();
    expect(liveClockSeconds({ clock: '7:42' })).toBe(462);
    expect(liveClockSeconds({ clockSeconds: 0, clock: '0:00' })).toBe(0);
  });

  it('treats Halftime + a stale own-6 snap as 2nd-half kickoff', () => {
    const pred = predictDriveResult(wazzuAtWashington({
      clockSeconds: null,
      clock: 'Halftime',
      statusText: 'Halftime',
      halfTime: true,
    }));
    expect(pred.layer).toBe('driveStart');
    expect(pred.assumed).toBe(true);
    expect(pred.features.period).toBe(3);
    expect(pred.features.ytg).toBe(75);
    expect(pred.features.clock_sec).toBe(900);
    expect(pred.p.other).toBeLessThan(0.45);
  });

  it('does not price Q2 0:00 / own-6 as 88% Other', () => {
    const dead = predictDriveResult(wazzuAtWashington({ clockSeconds: 0, clock: '0:00' }));
    expect(dead.layer).toBe('driveStart');
    expect(dead.assumed).toBe(true);
    expect(dead.features.period).toBe(3);
    expect(dead.features.ytg).toBe(75);
    expect(dead.p.other).toBeLessThan(0.45);
  });

  it('defaults a live snap to the team that has the ball', () => {
    const game = wazzuAtWashington({ clockSeconds: 7 * 60, clock: '7:00' });
    expect(livePossessionSide(game)).toBe('away');
    expect(inferOffenseSide(game)).toBe('away');
    const live = predictDriveResult(game);
    expect(live.side).toBe('away');
    expect(live.layer).toBe('snap');
    expect(live.firstUp).toBe(true);
    expect(live.features.ytg).toBe(94);
    expect(live.features.down).toBe(1);
    expect(live.features.offense_spread).toBe(20.5);
    expect(driveCardRole(game, live)).toBe('current');
  });

  it('shows both next drives at halftime, each from own 25', () => {
    const game = wazzuAtWashington({
      clockSeconds: null,
      clock: 'Halftime',
      statusText: 'Halftime',
      halfTime: true,
    });
    expect(shouldShowBothDriveSides(game)).toBe(true);
    const sides = listDriveSides(game);
    expect(sides).toHaveLength(2);
    expect(sides.map((row) => row.offenseSide)).toEqual(['away', 'home']);
    const txst = evaluateDriveGame(game, { market: sides[0] });
    const uw = evaluateDriveGame(game, { market: sides[1] });
    expect(txst.offenseSide).toBe('away');
    expect(uw.offenseSide).toBe('home');
    expect(txst.pred.features.ytg).toBe(75);
    expect(uw.pred.features.ytg).toBe(75);
    expect(txst.pred.features.period).toBe(3);
    expect(uw.pred.features.period).toBe(3);
    expect(txst.pred.features.offense_spread).toBe(20.5);
    expect(uw.pred.features.offense_spread).toBe(-20.5);
    expect(txst.rows.find((row) => row.key === 'td').p)
      .toBeLessThan(uw.rows.find((row) => row.key === 'td').p);
  });

  it('prices the waiting team after the current possession, not the same start', () => {
    const game = wazzuAtWashington({
      period: 4,
      clockSeconds: 8 * 60,
      clock: '8:00',
      down: null,
      distance: null,
      yardsToEndzone: null,
      possession: 'away',
      possessionName: 'Washington State',
    });
    const sides = listDriveSides(game);
    const txst = featuresFromGame({ ...game, nextDrive: sides[0] });
    const uw = featuresFromGame({ ...game, nextDrive: sides[1] });
    expect(txst.side).toBe('away');
    expect(txst.afterPriorDrive).toBeFalsy();
    expect(txst.firstUp).toBe(true);
    expect(txst.features.ytg).toBe(75);
    expect(txst.features.sec_left).toBe(480);
    expect(uw.side).toBe('home');
    expect(uw.afterPriorDrive).toBe(true);
    expect(uw.priorSide).toBe('away');
    expect(uw.predictedStart).toBe(true);
    expect(uw.features.sec_left).toBeLessThan(txst.features.sec_left);
    expect(uw.features.ytg).not.toBe(txst.features.ytg);
  });

  it('names both 1st drives pregame even with no book line', () => {
    const game = {
      inPlay: false,
      teams: { home: 'Notre Dame', away: 'Wisconsin' },
      lines: {
        spread: { runners: [{ runnerName: 'Notre Dame', handicap: -21.5 }] },
        total: { runners: [{ runnerName: 'Over', handicap: 46.5 }] },
      },
    };
    expect(shouldShowBothDriveSides(game)).toBe(true);
    const sides = listDriveSides(game);
    expect(sides.map((row) => row.offenseName)).toEqual(['Wisconsin', 'Notre Dame']);
    const wis = evaluateDriveGame(game, { market: sides[0] });
    const nd = evaluateDriveGame(game, { market: sides[1] });
    expect(wis.offenseName).toBe('Wisconsin');
    expect(nd.offenseName).toBe('Notre Dame');
    expect(wis.pred.features.offense_spread).toBe(21.5);
    expect(nd.pred.features.offense_spread).toBe(-21.5);
    expect(wis.rows.find((row) => row.key === 'td').p)
      .toBeLessThan(nd.rows.find((row) => row.key === 'td').p);
  });

  it('shows the current snap and the opponent next drive while a live snap is on', () => {
    const game = wazzuAtWashington({ clockSeconds: 7 * 60, clock: '7:00' });
    expect(shouldShowBothDriveSides(game)).toBe(true);
    const sides = listDriveSides(game);
    expect(sides.map((row) => row.offenseSide)).toEqual(['away', 'home']);
    const current = featuresFromGame({ ...game, nextDrive: sides[0] });
    const next = featuresFromGame({ ...game, nextDrive: sides[1] });
    expect(current.side).toBe('away');
    expect(current.layer).toBe('snap');
    expect(current.features.ytg).toBe(94);
    expect(driveCardRole(game, current)).toBe('current');
    expect(next.side).toBe('home');
    expect(next.afterPriorDrive).toBe(true);
    expect(next.predictedStart).toBe(true);
    expect(next.features.ytg).not.toBe(94);
    expect(next.features.offense_spread).toBe(-20.5);
    expect(driveCardRole(game, next)).toBe('next');
    expect(evaluateDriveGame(game, { market: sides[1] }).pred.p.other).toBeLessThan(0.3);
  });

  it('reads FanDuel-style drive numbers and ESPN drive-chart counts', () => {
    expect(driveNumberFromName("ND's 6th Drive Result")).toBe(6);
    expect(driveNumberFromName('Wisconsin Drive 5 - Result')).toBe(5);
    expect(formatDriveOrdinal(1)).toBe('1st');
    expect(formatDriveOrdinal(2)).toBe('2nd');
    expect(formatDriveOrdinal(3)).toBe('3rd');
    expect(formatDriveOrdinal(11)).toBe('11th');
    expect(formatDriveOrdinal(22)).toBe('22nd');
    const game = wazzuAtWashington({
      clockSeconds: 7 * 60,
      clock: '7:00',
      driveChart: { homeStarted: 4, awayStarted: 6, currentSide: 'away' },
    });
    const sides = listDriveSides(game);
    const current = evaluateDriveGame(game, { market: sides[0] });
    const next = evaluateDriveGame(game, { market: sides[1] });
    expect(current.offenseSide).toBe('away');
    expect(current.driveNumber).toBe(6);
    expect(next.offenseSide).toBe('home');
    expect(next.driveNumber).toBe(5);
    expect(driveNumberForSide(game, 'home', {
      market: { marketName: "Washington's 8th Drive Result" },
    })).toBe(5);
  });

  it('does not render a stale Drive 1 book on a later ESPN drive', () => {
    const stale = {
      source: 'fd',
      driveN: 1,
      offenseSide: 'away',
      offenseName: 'Washington State',
      marketName: 'Washington St Drive 1 - Result',
      outcomes: { td: { american: 220, fd: { american: 220 } } },
    };
    const live = {
      source: 'fd',
      driveN: 6,
      offenseSide: 'away',
      offenseName: 'Washington State',
      marketName: 'Washington St Drive 6 - Result',
      outcomes: { td: { american: 180, fd: { american: 180 } } },
    };
    const chart = { homeStarted: 4, awayStarted: 6, currentSide: 'away' };
    const staleGame = wazzuAtWashington({
      clockSeconds: 7 * 60,
      clock: '7:00',
      driveChart: chart,
    });
    staleGame.driveMarkets = [stale];
    const staleView = evaluateDriveGame(staleGame, { market: listDriveSides(staleGame)[0] });
    expect(staleView.driveNumber).toBe(6);
    expect(staleView.rows.find((row) => row.key === 'td').fdAmerican).toBeNull();

    const liveGame = { ...staleGame, driveMarkets: [stale, live] };
    const liveView = evaluateDriveGame(liveGame, { market: listDriveSides(liveGame)[0] });
    expect(liveView.driveNumber).toBe(6);
    expect(liveView.rows.find((row) => row.key === 'td').fdAmerican).toBe(180);
  });

  it('uses unique ESPN starts, not completed+1, so a current drive is not counted twice', () => {
    const game = wazzuAtWashington({
      clockSeconds: 7 * 60,
      clock: '7:00',
      driveChart: { homeStarted: 6, awayStarted: 8, currentSide: 'away' },
    });
    expect(driveNumberForSide(game, 'away', { role: 'current' })).toBe(8);
    expect(driveNumberForSide(game, 'home', { role: 'next' })).toBe(7);
  });

  it('does not count an End of Half kickoff stub; next is completed series + 1', () => {
    const chart = parseEspnDriveBlob({
      previous: [
        { id: 'm1', team: { abbreviation: 'MISS' }, result: { displayName: 'Punt' }, offensivePlays: 3 },
        { id: 'l1', team: { abbreviation: 'LOU' }, result: { displayName: 'Field Goal' }, offensivePlays: 10 },
        { id: 'm2', team: { abbreviation: 'MISS' }, result: { displayName: 'Fumble' }, offensivePlays: 7 },
        { id: 'l2', team: { abbreviation: 'LOU' }, result: { displayName: 'Punt' }, offensivePlays: 3 },
        { id: 'm3', team: { abbreviation: 'MISS' }, result: { displayName: 'Field Goal' }, offensivePlays: 11 },
        { id: 'l3', team: { abbreviation: 'LOU' }, result: { displayName: 'Fumble' }, offensivePlays: 7 },
        { id: 'm4', team: { abbreviation: 'MISS' }, result: { displayName: 'Touchdown' }, offensivePlays: 4 },
        { id: 'l4', team: { abbreviation: 'LOU' }, result: { displayName: 'Punt' }, offensivePlays: 3 },
        { id: 'm5', team: { abbreviation: 'MISS' }, result: { displayName: 'Interception' }, offensivePlays: 3 },
        { id: 'l5', team: { abbreviation: 'LOU' }, result: { displayName: 'Punt' }, offensivePlays: 3 },
        { id: 'm6', team: { abbreviation: 'MISS' }, result: { displayName: 'Missed FG' }, offensivePlays: 14 },
        { id: 'l6', team: { abbreviation: 'LOU' }, result: { displayName: 'Field Goal' }, offensivePlays: 8 },
        { id: 'eoh', team: { abbreviation: 'LOU' }, result: { displayName: 'END OF HALF' }, offensivePlays: 0 },
        { id: 'l7', team: { abbreviation: 'LOU' }, result: { displayName: 'Touchdown' }, offensivePlays: 9 },
        { id: 'm7', team: { abbreviation: 'MISS' }, result: { displayName: 'Touchdown' }, offensivePlays: 5 },
      ],
      current: { id: 'm7', team: { abbreviation: 'MISS' }, result: { displayName: 'Touchdown' }, offensivePlays: 5 },
    }, (drive) => {
      const abbr = drive?.team?.abbreviation;
      if (abbr === 'MISS') return 'home';
      if (abbr === 'LOU') return 'away';
      return null;
    });
    expect(chart).toEqual({
      homeStarted: 7,
      awayStarted: 7,
      currentSide: null,
      currentResult: 'Touchdown',
      finishedSide: 'home',
    });
    const game = wazzuAtWashington({
      period: 3,
      clockSeconds: 8 * 60 + 53,
      clock: '8:53',
      possession: null,
      possessionName: null,
      down: null,
      distance: null,
      yardsToEndzone: null,
      driveChart: chart,
    });
    expect(driveNumberForSide(game, 'away', { role: 'next' })).toBe(8);
    expect(driveNumberForSide(game, 'home', { role: 'next' })).toBe(8);
  });

  it('after a TD treats the other team as first up for the kickoff', () => {
    const game = wazzuAtWashington({
      period: 4,
      clockSeconds: 4 * 60 + 42,
      clock: '4:42',
      down: null,
      distance: null,
      yardsToEndzone: null,
      possession: 'away',
      possessionName: 'Washington State',
      lastPlay: 'Kienholz pass complete for 54 yards TOUCHDOWN',
      lastPlayType: 'Passing Touchdown',
      lastPlaySide: 'away',
      driveChart: {
        homeStarted: 8,
        awayStarted: 8,
        currentSide: null,
        currentResult: 'Touchdown',
        finishedSide: 'away',
      },
    });
    expect(scoringSideAfterMadeKick(game)).toBe('away');
    expect(firstUpSide(game)).toBe('home');
    expect(situationOffenseLabel(game)).toBe('Washington gets the ball');
    const sides = listDriveSides(game);
    expect(sides[0].offenseSide).toBe('home');
    expect(sides[1].offenseSide).toBe('away');
    const recv = featuresFromGame({ ...game, nextDrive: sides[0] });
    const scorer = featuresFromGame({ ...game, nextDrive: sides[1] });
    expect(recv.firstUp).toBe(true);
    expect(recv.afterPriorDrive).toBeFalsy();
    expect(recv.features.ytg).toBe(75);
    expect(driveCardRole(game, recv)).toBe('current');
    expect(scorer.afterPriorDrive).toBe(true);
    expect(driveCardRole(game, scorer)).toBe('next');
    expect(driveNumberForSide(game, 'home', { pred: recv })).toBe(9);
    expect(driveNumberForSide(game, 'away', { pred: scorer })).toBe(9);
  });

  it('after the extra point, a kickoff-only ESPN current is not the scoring team on offense', () => {
    const sideOf = (drive) => {
      const abbr = drive?.team?.abbreviation;
      if (abbr === 'MISS') return 'home';
      if (abbr === 'LOU') return 'away';
      return null;
    };
    const chart = parseEspnDriveBlob({
      previous: [
        { id: 'td', team: { abbreviation: 'LOU' }, result: { displayName: 'Touchdown' }, offensivePlays: 6 },
        {
          id: 'ko',
          team: { abbreviation: 'LOU' },
          offensivePlays: 0,
          plays: [{ type: { text: 'Kickoff' }, text: 'Keller kickoff 65 yards to the Miss00, Touchback' }],
        },
      ],
      current: {
        id: 'ko',
        team: { abbreviation: 'LOU' },
        offensivePlays: 0,
        plays: [{ type: { text: 'Kickoff' }, text: 'Keller kickoff 65 yards to the Miss00, Touchback' }],
      },
    }, sideOf);
    expect(chart).toEqual({
      homeStarted: 0,
      awayStarted: 1,
      currentSide: null,
      currentResult: null,
      finishedSide: null,
    });
    const game = wazzuAtWashington({
      period: 4,
      clockSeconds: 4 * 60 + 42,
      clock: '4:42',
      down: null,
      yardsToEndzone: null,
      possession: 'home',
      possessionName: 'Washington',
      lastPlay: '(C. Hilbert KICK)',
      lastPlayType: 'Extra Point Good',
      lastPlaySide: 'away',
      driveChart: chart,
    });
    expect(scoringSideAfterMadeKick(game)).toBe('away');
    expect(firstUpSide(game)).toBe('home');
    expect(situationOffenseLabel(game)).toBe('Washington gets the ball');
  });

  it('does not treat a missed FG as a kickoff to the other team', () => {
    const game = wazzuAtWashington({
      clockSeconds: 6 * 60,
      clock: '6:00',
      down: null,
      yardsToEndzone: null,
      possession: 'away',
      lastPlayType: 'Field Goal Missed',
      lastPlaySide: 'away',
      driveChart: {
        homeStarted: 5,
        awayStarted: 5,
        currentSide: null,
        currentResult: 'Missed FG',
        finishedSide: 'away',
      },
    });
    expect(scoringSideAfterMadeKick(game)).toBeNull();
    expect(firstUpSide(game)).toBeNull();
    expect(situationOffenseLabel(game)).toBe('Between possessions');
  });

  it('assigns an untitled live FanDuel line to the team with the ball', () => {
    const game = {
      ...wazzuAtWashington({ clockSeconds: 7 * 60, clock: '7:00' }),
      nextDrive: {
        source: 'fd',
        marketName: 'Drive Result',
        outcomes: { td: { american: 220 } },
      },
    };
    const sides = listDriveSides(game);
    expect(sides[0].offenseSide).toBe('away');
    expect(sides[0].source).toBe('fd');
    expect(sides[0].outcomes.td.american).toBe(220);
    expect(sides[1].offenseSide).toBe('home');
    expect(sides[1].synthetic).toBe(true);
  });

  it('rolls End of 1st into Q2 so the next-drive clock is not stuck at 0:00', () => {
    const game = wazzuAtWashington({
      period: 1,
      clockSeconds: null,
      clock: 'End of 1st',
      statusText: 'End of 1st',
    });
    const sides = listDriveSides(game);
    const current = featuresFromGame({ ...game, nextDrive: sides[0] });
    const next = featuresFromGame({ ...game, nextDrive: sides[1] });
    expect(current.side).toBe('away');
    expect(current.layer).toBe('snap');
    expect(current.features.period).toBe(2);
    expect(current.features.clock_sec).toBe(900);
    expect(next.side).toBe('home');
    expect(next.layer).toBe('driveStart');
    expect(next.predictedStart).toBe(true);
    expect(next.features.period).toBeGreaterThanOrEqual(2);
    expect(next.features.sec_left).toBeLessThanOrEqual(2700);
  });

  it('recovers yards-to-goal from ND 33 when ESPN omits yardsToEndzone', () => {
    expect(ytgFromSpot('ND 33', {
      possession: 'away',
      home: 'Notre Dame',
      away: 'Wisconsin',
    })).toBe(33);
    const game = wazzuAtWashington({
      possession: 'away',
      possessionName: 'Wisconsin',
      possessionText: 'ND 33',
      down: 3,
      distance: 6,
      yardsToEndzone: null,
      clockSeconds: 10 * 60 + 8,
      clock: '10:08',
      period: 1,
    });
    game.teams = { home: 'Notre Dame', away: 'Wisconsin' };
    const pred = predictDriveResult(game);
    expect(pred.layer).toBe('snap');
    expect(pred.features.ytg).toBe(33);
    expect(pred.features.down).toBe(3);
  });
});
