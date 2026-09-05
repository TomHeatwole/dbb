import {
  evaluateDriveGame,
  extractHomeSpread,
  featuresFromGame,
  inferOffenseSide,
  listDriveMarkets,
  nameMatchScore,
} from './driveModel';

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
