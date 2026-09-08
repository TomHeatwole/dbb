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
  espnStateUnreachable,
  situationUntrusted,
  spotLagKind,
  espnSituationLagsLastPlay,
  applyOddsAheadFlags,
  applyFdAheadLive,
  playYardageFromText,
  describeSpotLag,
  listDriveMarkets,
  shouldShowBothDriveSides,
  liveClockSeconds,
  nameMatchScore,
  predictDriveResult,
  puntStyleWarningForOffense,
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

  it('flags a live game with no ESPN attach as unreachable', () => {
    expect(espnStateUnreachable({
      inPlay: true,
      debug: { espnMatched: false },
      live: { state: 'in' },
    })).toBe(true);
    expect(espnStateUnreachable({
      inPlay: true,
      espnId: '401858212',
      debug: { espnMatched: true },
      live: { state: 'in', down: 1, yardsToEndzone: 75 },
    })).toBe(false);
    expect(espnStateUnreachable({ inPlay: false })).toBe(false);
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

  it('does not keep a leftover SMU Drive 9 current while FanDuel has FSU Drive 10', () => {
    const fsu10 = {
      source: 'fd',
      driveN: 10,
      offenseSide: 'home',
      offenseName: 'Florida State',
      marketName: 'Florida St Drive 10 - Result',
      outcomes: { td: { american: 250, fd: { american: 250 } } },
    };
    const smu9 = {
      source: 'fd',
      driveN: 9,
      offenseSide: 'away',
      offenseName: 'SMU',
      marketName: 'SMU Drive 9 - Result',
      outcomes: { td: { american: 180, fd: { american: 180 } } },
    };
    const game = {
      inPlay: true,
      teams: { home: 'Florida State', away: 'SMU' },
      driveMarkets: [smu9, fsu10],
      live: {
        period: 4,
        clock: '13:42',
        clockSeconds: 13 * 60 + 42,
        down: 1,
        distance: 10,
        yardsToEndzone: 83,
        possession: 'away',
        possessionName: 'SMU',
        possessionText: 'SMU 17',
        state: 'in',
        driveChart: { homeStarted: 9, awayStarted: 9, currentSide: 'away' },
        fdAheadOfEspn: true,
        fd: {
          period: 4,
          clock: '13:20',
          clockSeconds: 13 * 60 + 20,
          down: 1,
          distance: 10,
          possessionText: 'SMU 17',
          possession: 'home',
          possessionName: 'Florida State',
          yardsToEndzone: 17,
        },
      },
    };
    expect(firstUpSide(game)).toBe('home');
    expect(driveNumberForSide(game, 'home', { role: 'current' })).toBe(10);
    expect(driveNumberForSide(game, 'away', { role: 'next' })).toBe(10);
    const sides = listDriveSides(game);
    expect(sides.map((row) => [row.offenseSide, row.driveN ?? row.synthetic])).toEqual([
      ['home', 10],
      ['away', true],
    ]);
    const current = evaluateDriveGame(game, { market: sides[0] });
    const next = evaluateDriveGame(game, { market: sides[1] });
    expect(current.offenseName).toBe('Florida State');
    expect(current.driveNumber).toBe(10);
    expect(driveCardRole(game, current.pred)).toBe('current');
    expect(next.offenseName).toBe('SMU');
    expect(next.driveNumber).toBe(10);
    expect(driveCardRole(game, next.pred)).toBe('next');
    expect(next.rows.find((row) => row.key === 'td').fdAmerican).toBeNull();
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

  it('bumps to the next drive after a completed series even if ESPN still tags that team current', () => {
    const game = wazzuAtWashington({
      period: 3,
      clockSeconds: 11 * 60 + 40,
      clock: '11:40',
      down: 2,
      distance: 5,
      yardsToEndzone: 28,
      possession: 'away',
      possessionName: 'Washington State',
      driveChart: {
        homeStarted: 6,
        awayStarted: 6,
        currentSide: 'home',
        currentResult: 'Punt',
        finishedSide: 'home',
      },
    });
    expect(firstUpSide(game)).toBe('away');
    expect(driveNumberForSide(game, 'home', { role: 'next' })).toBe(7);
    expect(driveNumberForSide(game, 'away', { role: 'current' })).toBe(7);
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

  it('counts an End of Half series that had offensive plays (SMU Drive 6 → next is 7)', () => {
    const sideOf = (drive) => {
      const abbr = drive?.team?.abbreviation;
      if (abbr === 'FSU') return 'home';
      if (abbr === 'SMU') return 'away';
      return null;
    };
    const chart = parseEspnDriveBlob({
      previous: [
        { id: 's1', team: { abbreviation: 'SMU' }, result: { displayName: 'Fumble' }, offensivePlays: 6 },
        { id: 'f1', team: { abbreviation: 'FSU' }, result: { displayName: 'Punt' }, offensivePlays: 3 },
        { id: 's2', team: { abbreviation: 'SMU' }, result: { displayName: 'Touchdown' }, offensivePlays: 6 },
        { id: 'f2', team: { abbreviation: 'FSU' }, result: { displayName: 'Touchdown' }, offensivePlays: 13 },
        { id: 's3', team: { abbreviation: 'SMU' }, result: { displayName: 'Missed FG' }, offensivePlays: 12 },
        { id: 'f3', team: { abbreviation: 'FSU' }, result: { displayName: 'Downs' }, offensivePlays: 6 },
        { id: 's4', team: { abbreviation: 'SMU' }, result: { displayName: 'Touchdown' }, offensivePlays: 8 },
        { id: 'f4', team: { abbreviation: 'FSU' }, result: { displayName: 'Field Goal' }, offensivePlays: 5 },
        { id: 's5', team: { abbreviation: 'SMU' }, result: { displayName: 'Field Goal' }, offensivePlays: 5 },
        { id: 'f5', team: { abbreviation: 'FSU' }, result: { displayName: 'Punt' }, offensivePlays: 5 },
        {
          id: 's6',
          team: { abbreviation: 'SMU' },
          result: { displayName: 'End of Half' },
          offensivePlays: 4,
          plays: [
            { type: { text: 'Rush' } },
            { type: { text: 'Pass Incompletion' } },
            { type: { text: 'Pass Incompletion' } },
            { type: { text: 'Rush' } },
            { type: { text: 'End of Half' } },
          ],
        },
      ],
      current: {
        id: 's6',
        team: { abbreviation: 'SMU' },
        result: { displayName: 'End of Half' },
        offensivePlays: 4,
      },
    }, sideOf);
    expect(chart).toEqual({
      homeStarted: 5,
      awayStarted: 6,
      currentSide: null,
      currentResult: 'End of Half',
      finishedSide: 'away',
    });
    const game = {
      inPlay: true,
      teams: { home: 'Florida State', away: 'SMU' },
      live: {
        period: 2,
        clock: '0:00',
        clockSeconds: 0,
        statusText: 'Halftime',
        halfTime: true,
        state: 'halftime',
        lastPlayType: 'End of Half',
        driveChart: chart,
      },
    };
    expect(driveNumberForSide(game, 'away', { role: 'next' })).toBe(7);
    expect(driveNumberForSide(game, 'home', { role: 'next' })).toBe(6);
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

function liveFdGame(live, outcomes) {
  const game = wazzuAtWashington(live);
  const market = {
    source: 'fd',
    driveN: 6,
    offenseSide: 'away',
    offenseName: 'Washington State',
    marketName: 'Washington St Drive 6 - Result',
    outcomes,
  };
  game.driveMarkets = [market];
  game.nextDrive = market;
  game.eventId = 'wazzu-uw';
  game.live = {
    ...game.live,
    driveChart: { homeStarted: 4, awayStarted: 6, currentSide: 'away' },
  };
  return game;
}

const goalLineFd = {
  td: { american: -120, fd: { american: -120 } },
  fg: { american: 280, fd: { american: 280 } },
  punt: { american: 900, fd: { american: 900 } },
  other: { american: 700, fd: { american: 700 } },
};

describe('ESPN situation lag vs live FanDuel prices', () => {
  it('parses gain/loss yardage from last-play text', () => {
    expect(playYardageFromText('Smith pass complete to Jones for 42 yards')).toBe(42);
    expect(playYardageFromText('Williams sacked for a loss of 8 yards')).toBe(-8);
  });

  it('flags a lagged 3rd-and-long spot without hiding the model edge', () => {
    const snap = {
      clockSeconds: 7 * 60,
      clock: '7:00',
      down: 3,
      distance: 8,
      yardsToEndzone: 50,
      yardLine: 50,
    };
    const naive = liveFdGame(snap, goalLineFd);
    const naiveView = evaluateDriveGame(naive, { market: listDriveSides(naive)[0] });
    expect(naiveView.pred.layer).toBe('snap');
    expect(naiveView.situationLag).toBe(false);
    expect(naiveView.evCount).toBeGreaterThan(0);

    const lagged = liveFdGame({
      ...snap,
      lastPlay: 'Kienholz pass complete for 42 yards to the WAS 8',
      lastPlayType: 'Pass Reception',
      lastPlaySide: 'away',
      lastPlayYards: 42,
      lastPlayStartYardLine: 50,
      lastPlayEndYardLine: 8,
    }, goalLineFd);
    expect(espnSituationLagsLastPlay(lagged)).toBe(true);
    const view = evaluateDriveGame(lagged, { market: listDriveSides(lagged)[0] });
    expect(view.situationLag).toBe(true);
    expect(view.situationLagKind).toBe('espnBehind');
    expect(view.evCount).toBeGreaterThan(0);
    expect(view.rows.some((row) => row.edgePoints != null)).toBe(true);
    expect(view.situationLagDetail.espnSpot).toBe('3rd and 8');
    expect(view.situationLagDetail.impliedSpot).toBe('1st & Goal');
    expect(view.situationLagDetail.espnLine).toMatch(/Q2 7:00/);
    expect(view.situationLagDetail.espnLine).toMatch(/3rd and 8/);
    expect(view.situationLagDetail.text).toMatch(/ESPN shows:/);
    expect(view.situationLagDetail.text).toMatch(/Last play: 1st & Goal \(gained 42\)/);
    expect(describeSpotLag(lagged).text).toMatch(/gained 42/);
  });

  it('shows model edges again after ESPN applies the same chunk play', () => {
    const caughtUp = liveFdGame({
      clockSeconds: 6 * 60 + 40,
      clock: '6:40',
      down: 1,
      distance: 8,
      yardsToEndzone: 8,
      yardLine: 8,
      lastPlay: 'Kienholz pass complete for 42 yards to the WAS 8',
      lastPlayType: 'Pass Reception',
      lastPlaySide: 'away',
      lastPlayYards: 42,
      lastPlayStartYardLine: 50,
      lastPlayEndYardLine: 8,
    }, goalLineFd);
    expect(espnSituationLagsLastPlay(caughtUp)).toBe(false);
    const liveView = evaluateDriveGame(caughtUp, { market: listDriveSides(caughtUp)[0] });
    expect(liveView.pred.layer).toBe('snap');
    expect(liveView.situationLag).toBe(false);
    expect(liveView.rows.every((row) => row.edgePoints == null)).toBe(false);
  });

  it('does not flag a timeout that leaves the snap unchanged', () => {
    const game = liveFdGame({
      clockSeconds: 6 * 60 + 35,
      clock: '6:35',
      down: 1,
      distance: 10,
      yardsToEndzone: 51,
      yardLine: 49,
      lastPlay: 'Official Timeout at 06:35.',
      lastPlayType: 'Official Timeout',
      lastPlayYards: 0,
      lastPlayStartYardLine: 49,
      lastPlayEndYardLine: 49,
    }, goalLineFd);
    expect(espnSituationLagsLastPlay(game)).toBe(false);
  });

  it('keeps the odds-ahead flag until ESPN’s spot actually changes', () => {
    const spot = {
      clockSeconds: 7 * 60,
      clock: '7:00',
      down: 3,
      distance: 8,
      yardsToEndzone: 50,
      yardLine: 50,
    };
    const prev = liveFdGame(spot, {
      td: { american: 220, fd: { american: 220 } },
      punt: { american: -150, fd: { american: -150 } },
    });
    const next = liveFdGame(spot, {
      td: { american: -120, fd: { american: -120 } },
      punt: { american: 400, fd: { american: 400 } },
    });
    const flagged = applyOddsAheadFlags([prev], [next]);
    expect(flagged[0].live.oddsAheadOfSpot).toBe(true);
    expect(evaluateDriveGame(flagged[0], { market: listDriveSides(flagged[0])[0] }).situationLag)
      .toBe(true);

    const still = applyOddsAheadFlags(flagged, [next]);
    expect(still[0].live.oddsAheadOfSpot).toBe(true);

    const moved = liveFdGame({
      ...spot,
      down: 1,
      distance: 10,
      yardsToEndzone: 8,
      yardLine: 8,
      clock: '6:40',
      clockSeconds: 6 * 60 + 40,
    }, {
      td: { american: -120, fd: { american: -120 } },
      punt: { american: 400, fd: { american: 400 } },
    });
    const cleared = applyOddsAheadFlags(still, [moved]);
    expect(cleared[0].live.oddsAheadOfSpot).toBeUndefined();
  });

  it('still prices the current drive when FanDuel is ahead of ESPN', () => {
    const game = liveFdGame({
      period: 3,
      clockSeconds: 2 * 60 + 8,
      clock: '2:08',
      down: 4,
      distance: 2,
      yardsToEndzone: 2,
      yardLine: 2,
      possessionText: 'SMU 2',
    }, goalLineFd);
    game.live.fdAheadOfEspn = true;
    game.live.fd = {
      period: 3,
      clockSeconds: 2 * 60,
      clock: '2:00',
      down: 1,
      distance: 10,
      yardsToEndzone: 75,
      possessionText: 'Florida State 25',
    };
    expect(situationUntrusted(game)).toBe(false);
    expect(spotLagKind(game)).toBeNull();
    const overlaid = applyFdAheadLive(game);
    expect(overlaid.live.spotSource).toBe('fd');
    expect(overlaid.live.down).toBe(1);
    expect(overlaid.live.yardsToEndzone).toBe(75);
    const view = evaluateDriveGame(game, { market: listDriveSides(game)[0] });
    expect(view.situationLag).toBe(false);
    expect(view.pred.layer).toBe('snap');
    expect(view.pred.features.down).toBe(1);
    expect(view.pred.features.ytg).toBe(75);
    expect(view.evCount).toBeGreaterThan(0);
  });

  it('uses FanDuel possession and yardline when FD is ahead of a leftover book drive', () => {
    const game = {
      inPlay: true,
      teams: { home: 'Florida State', away: 'SMU' },
      score: { home: 24, away: 24 },
      driveMarkets: [
        {
          marketName: 'Florida St Drive 12 - Result',
          offenseName: 'Florida St',
          offenseSide: 'home',
          driveN: 12,
          outcomes: goalLineFd,
        },
        {
          marketName: 'SMU Drive 11 - Result',
          offenseName: 'SMU',
          offenseSide: 'away',
          driveN: 11,
          outcomes: {},
        },
      ],
      live: {
        period: 4,
        clock: '3:45',
        clockSeconds: 3 * 60 + 45,
        down: 3,
        distance: 10,
        yardsToEndzone: 39,
        possession: 'home',
        possessionName: 'Florida State',
        possessionText: 'SMU 39',
        lastPlay: 'Raphael, Kendrick rush for 27 yards to the FLORIDAST25, PENALTY SMU holding 9 yards',
        lastPlayType: 'Rush',
        lastPlaySide: 'away',
        state: 'in',
        fdAheadOfEspn: true,
        fd: {
          period: 4,
          clock: '2:50',
          clockSeconds: 2 * 60 + 50,
          down: 1,
          distance: 10,
          possessionText: 'Florida State 25',
          possession: 'away',
          possessionName: 'SMU',
        },
      },
    };
    expect(firstUpSide(game)).toBe('away');
    expect(situationOffenseLabel(game)).toBe('SMU on offense');
    expect(spotLagKind(game)).toBeNull();
    const sides = listDriveSides(game);
    expect(sides[0].offenseSide).toBe('away');
    const view = evaluateDriveGame(game, { market: sides[0] });
    expect(view.situationLag).toBe(false);
    expect(view.pred.layer).toBe('snap');
    expect(view.pred.features.down).toBe(1);
    expect(view.pred.features.ytg).toBe(25);
    expect(view.pred.features.clock_sec).toBe(2 * 60 + 50);
  });

  it('treats ESPN-ahead of FanDuel as stale odds, not a lagged-spot warning', () => {
    const game = liveFdGame({
      period: 3,
      clockSeconds: 2 * 60,
      clock: '2:00',
      down: 1,
      distance: 10,
      yardsToEndzone: 75,
      yardLine: 25,
      possessionText: 'Florida State 25',
    }, goalLineFd);
    game.live.fd = {
      period: 3,
      clockSeconds: 2 * 60 + 8,
      clock: '2:08',
      down: 4,
      distance: 2,
      yardsToEndzone: 2,
      possessionText: 'SMU 2',
    };
    expect(situationUntrusted(game)).toBe(false);
    expect(spotLagKind(game)).toBe('oddsStale');
    const view = evaluateDriveGame(game, { market: listDriveSides(game)[0] });
    expect(view.situationLag).toBe(true);
    expect(view.situationLagKind).toBe('oddsStale');
    expect(view.situationLagDetail.espnLine).toBe('Q3 2:00  1st and 10  at Florida State 25');
    expect(view.situationLagDetail.fdLine).toBe('Q3 2:08  4th and Goal  at SMU 2');
    expect(view.evCount).toBeGreaterThan(0);
  });

  it('does not red-warn when ESPN clock has run further than FanDuel even if last play lagged', () => {
    const game = liveFdGame({
      period: 3,
      clockSeconds: 36,
      clock: '0:36',
      down: 3,
      distance: 10,
      yardsToEndzone: 61,
      possessionText: 'SMU 39',
      lastPlay: 'Kienholz pass complete for 12 yards to the SMU 39',
      lastPlayType: 'Pass Reception',
      lastPlaySide: 'away',
      lastPlayYards: 12,
      lastPlayStartYardLine: 49,
      lastPlayEndYardLine: 39,
    }, goalLineFd);
    game.live.fdAheadOfEspn = true;
    game.live.fd = {
      clock: '0:45',
      clockSeconds: 45,
      down: 3,
      distance: 10,
    };
    expect(espnSituationLagsLastPlay(game)).toBe(true);
    expect(spotLagKind(game)).toBe('oddsStale');
    expect(situationUntrusted(game)).toBe(false);
    const view = evaluateDriveGame(game, { market: listDriveSides(game)[0] });
    expect(view.situationLagKind).toBe('oddsStale');
    expect(view.situationLagDetail.espnLine).toMatch(/0:36/);
    expect(view.situationLagDetail.fdLine).toMatch(/0:45/);
  });

  it('does not flag matching ESPN and FanDuel spots when FD omits quarter and yardline', () => {
    const game = liveFdGame({
      period: 3,
      clockSeconds: 45,
      clock: '0:45',
      down: 3,
      distance: 10,
      yardsToEndzone: 61,
      possessionText: 'SMU 39',
    }, goalLineFd);
    game.live.fd = {
      clock: '0:45',
      clockSeconds: 45,
      down: 3,
      distance: 10,
    };
    expect(spotLagKind(game)).toBeNull();
    expect(evaluateDriveGame(game, { market: listDriveSides(game)[0] }).situationLag).toBe(false);
  });

  it('does not red-warn when clock and down match even if leftover FD yards-to-endzone disagrees', () => {
    const game = liveFdGame({
      period: 4,
      clockSeconds: 13 * 60 + 42,
      clock: '13:42',
      down: 1,
      distance: 10,
      yardsToEndzone: 83,
      possessionText: 'SMU 17',
    }, goalLineFd);
    game.live.fdAheadOfEspn = true;
    game.live.oddsAheadOfSpot = true;
    game.live.fd = {
      period: 4,
      clock: '13:42',
      clockSeconds: 13 * 60 + 42,
      down: 1,
      distance: 10,
      yardsToEndzone: 75,
    };
    expect(spotLagKind(game)).toBeNull();
    expect(evaluateDriveGame(game, { market: listDriveSides(game)[0] }).situationLag).toBe(false);
  });
});

describe('FAU / Army punt style warning', () => {
  it('matches FAU and Army names, not other teams', () => {
    expect(puntStyleWarningForOffense('Florida Atlantic Owls')?.id).toBe('fau');
    expect(puntStyleWarningForOffense('FAU')?.id).toBe('fau');
    expect(puntStyleWarningForOffense('Army Black Knights')?.id).toBe('army');
    expect(puntStyleWarningForOffense('Army')?.id).toBe('army');
    expect(puntStyleWarningForOffense('Texas')).toBeNull();
    expect(puntStyleWarningForOffense('Navy Midshipmen')).toBeNull();
    expect(puntStyleWarningForOffense('Florida State')).toBeNull();
  });

  it('flags a profitable FAU punt without changing the model mix', () => {
    const market = {
      source: 'fd',
      marketName: '1st Florida Atlantic Drive Result',
      offenseName: 'Florida Atlantic',
      offenseSide: 'away',
      outcomes: {
        punt: { american: 250 },
        td: { american: 200 },
        other: { american: 400 },
        fg: { american: 500 },
      },
    };
    const game = {
      eventId: 'fau-test',
      name: 'Florida Atlantic @ Memphis',
      teams: { home: 'Memphis', away: 'Florida Atlantic' },
      inPlay: false,
      score: { home: 0, away: 0 },
      scoreDisplay: '0-0',
      lines: {
        spread: {
          runners: [
            { runnerName: 'Florida Atlantic', handicap: 7.5, american: -110 },
            { runnerName: 'Memphis', handicap: -7.5, american: -110 },
          ],
        },
        total: { runners: [{ runnerName: 'Over', handicap: 54.5, american: -110 }] },
      },
      driveMarkets: [market],
      nextDrive: market,
    };
    const view = evaluateDriveGame(game, { market });
    const punt = view.rows.find((row) => row.key === 'punt');
    expect(punt.profitable).toBe(true);
    expect(punt.styleWarning?.id).toBe('fau');
    expect(punt.p).toBeCloseTo(view.pred.p.punt, 8);
  });

  it('does not warn on a profitable Texas punt', () => {
    const game = texasStateAtTexas();
    const texas = game.driveMarkets[1];
    texas.outcomes.punt = { american: 400 };
    const view = evaluateDriveGame(game, { market: texas });
    const punt = view.rows.find((row) => row.key === 'punt');
    expect(punt.styleWarning).toBeNull();
  });
});
