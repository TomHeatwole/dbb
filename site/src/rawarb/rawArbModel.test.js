import {
  buildGameMarkets,
  filterGames,
  formatCombinedPct,
  formatJuicePct,
  gameHasMinOdds,
  isBestTwoWay,
  mergeBookGames,
  moneylineTwoWay,
  parseSignedAmerican,
  pickBestTwoWay,
  quoteFromAmerican,
  sortGames,
  spreadTwoWay,
  totalTwoWay,
  visibleBestPSum,
} from './rawArbModel';
import { gamesMatch, parseEventTeams, personMatch, teamsMatch } from './teamMatch';
import { isThreeWayMoneyline, SPORT_FILTERS, sportFiltersFor } from './sportCatalog';
import { fillMainsFromExtras } from './mergeDeep';

describe('parseSignedAmerican', () => {
  it('reads unicode minus and plus prefixes', () => {
    expect(parseSignedAmerican('−110')).toBe(-110);
    expect(parseSignedAmerican('–1660')).toBe(-1660);
    expect(parseSignedAmerican('+150')).toBe(150);
    expect(parseSignedAmerican(-105)).toBe(-105);
  });
});

describe('team matching', () => {
  it('matches DK abbreviations to FanDuel NFL names', () => {
    expect(teamsMatch('Indianapolis Colts', 'IND Colts')).toBe(true);
    expect(teamsMatch('Washington Commanders', 'WAS Commanders')).toBe(true);
    expect(teamsMatch('New York Giants', 'NY Giants')).toBe(true);
    expect(teamsMatch('New York Jets', 'NY Jets')).toBe(true);
    expect(teamsMatch('New York Giants', 'NY Jets')).toBe(false);
    expect(teamsMatch('Los Angeles Rams', 'LA Rams')).toBe(true);
    expect(teamsMatch('Los Angeles Chargers', 'LA Rams')).toBe(false);
    expect(teamsMatch('Detroit Lions', 'DET Lions')).toBe(true);
    expect(teamsMatch('Denver Broncos', 'DEN Broncos')).toBe(true);
    expect(teamsMatch('Chicago Bears', 'CHI Bears')).toBe(true);
    expect(teamsMatch('Atlanta Falcons', 'ATL Falcons')).toBe(true);
    expect(teamsMatch('Philadelphia Eagles', 'PHI Eagles')).toBe(true);
    expect(teamsMatch('Dallas Cowboys', 'DAL Cowboys')).toBe(true);
    expect(gamesMatch(
      parseEventTeams('Detroit Lions @ Carolina Panthers'),
      parseEventTeams('DET Lions @ CAR Panthers'),
    )).toBe(true);
  });

  it('does not collapse Georgia / Georgia Tech', () => {
    expect(teamsMatch('Georgia', 'Georgia Tech')).toBe(false);
    expect(teamsMatch('Texas', 'Texas State')).toBe(false);
  });

  it('pairs games on home and away', () => {
    expect(gamesMatch(
      parseEventTeams('Georgia @ Alabama'),
      parseEventTeams('Georgia @ Alabama'),
    )).toBe(true);
    expect(gamesMatch(
      parseEventTeams('IND Colts @ WAS Commanders'),
      parseEventTeams('Indianapolis Colts @ Washington Commanders'),
    )).toBe(true);
    expect(gamesMatch(
      parseEventTeams('Texas @ Oklahoma'),
      parseEventTeams('Oklahoma @ Texas'),
    )).toBe(true);
    expect(teamsMatch('Connecticut', 'UConn')).toBe(true);
    expect(teamsMatch('Massachusetts', 'UMass')).toBe(true);
  });

  it('strips pitcher notes and matches soccer / tennis names', () => {
    expect(parseEventTeams('Atlanta Braves (TBD) @ Los Angeles Dodgers (T Skubal)')).toEqual({
      away: 'Atlanta Braves',
      home: 'Los Angeles Dodgers',
    });
    expect(teamsMatch('Manchester City', 'Man City')).toBe(true);
    expect(teamsMatch('Newcastle United', 'Manchester United')).toBe(false);
    expect(personMatch('Elena Rybakina', 'E. Rybakina')).toBe(true);
    expect(parseEventTeams('Polina Kudermetova v Mirra Andreeva')).toEqual({
      home: 'Polina Kudermetova',
      away: 'Mirra Andreeva',
    });
    expect(parseEventTeams('Polina Kudermetova vs Mirra Andreeva')).toEqual({
      home: 'Polina Kudermetova',
      away: 'Mirra Andreeva',
    });
    expect(isThreeWayMoneyline('Moneyline (3-way)', ['Liverpool', 'Draw', 'Man City'])).toBe(true);
    expect(isThreeWayMoneyline('Moneyline', ['Inter', 'Draw', 'Parma'])).toBe(true);
    expect(isThreeWayMoneyline('Moneyline', ['Celtics', 'Pistons'])).toBe(false);
    expect(isThreeWayMoneyline('Draw No Bet', ['Inter', 'Parma'])).toBe(false);
  });
});

describe('cross-book two-way', () => {
  it('picks the cheaper opposite sides on moneyline', () => {
    const twoWay = moneylineTwoWay(
      { away: { american: 150 }, home: { american: -175 } },
      { away: { american: 145 }, home: { american: -166 } },
      { away: 'Georgia', home: 'Alabama' },
    );
    expect(twoWay.legs.map((leg) => `${leg.book}:${leg.side}:${leg.american}`)).toEqual([
      'fd:away:150',
      'dk:home:-166',
    ]);
    expect(twoWay.pSum).toBeCloseTo(
      quoteFromAmerican(150).implied + quoteFromAmerican(-166).implied,
      6,
    );
    expect(twoWay.hasArb).toBe(false);
  });

  it('flags a true arb when implieds sum under 100%', () => {
    const twoWay = moneylineTwoWay(
      { away: { american: 110 }, home: { american: -130 } },
      { away: { american: -120 }, home: { american: 115 } },
      { away: 'Away', home: 'Home' },
    );
    expect(twoWay.hasArb).toBe(true);
    expect(twoWay.pSum).toBeLessThan(1);
  });

  it('does not pair the same tennis player on both books', () => {
    const twoWay = moneylineTwoWay(
      {
        away: { american: -1800, team: 'Mirra Andreeva' },
        home: { american: 920, team: 'Polina Kudermetova' },
      },
      {
        away: { american: 860, team: 'Polina Kudermetova' },
        home: { american: 860, team: 'Polina Kudermetova' },
      },
      { away: 'Mirra Andreeva', home: 'Polina Kudermetova' },
    );
    expect(twoWay).toBe(null);
  });

  it('keeps complementary spreads and +3.5 vs -3 middles, drops -3.5 vs +3 gaps', () => {
    const locked = spreadTwoWay(
      { away: { american: -110, line: 3.5 }, home: { american: -110, line: -3.5 } },
      { away: { american: -108, line: 3.5 }, home: { american: -112, line: -3.5 } },
      { away: 'Georgia', home: 'Alabama' },
    );
    expect(locked.lineFit).toBe('lock');

    // FD -3.5 / +3.5 vs DK -3 / +3: the cheap pair is a gap; keep the 3/4-pot middle.
    const louisville = spreadTwoWay(
      { away: { american: 100, line: -3.5 }, home: { american: -122, line: 3.5 } },
      { away: { american: -118, line: -3 }, home: { american: -102, line: 3 } },
      { away: 'Louisville', home: 'NC State' },
    );
    expect(louisville.lineFit).toBe('middle');
    expect(louisville.legs.map((leg) => `${leg.book}:${leg.side}:${leg.line}:${leg.american}`)).toEqual([
      'fd:home:3.5:-122',
      'dk:away:-3:-118',
    ]);
    expect(louisville.pSum).toBeGreaterThan(1.08);

    const noSides = spreadTwoWay(
      { away: { american: 100, line: -3.5 } },
      { home: { american: -102, line: 3 } },
      { away: 'Louisville', home: 'NC State' },
    );
    expect(noSides).toBe(null);
  });

  it('locks matching totals and keeps the over-low / under-high middle', () => {
    const locked = totalTwoWay(
      { over: { american: -110, line: 47.5 }, under: { american: -110, line: 47.5 } },
      { over: { american: -105, line: 47.5 }, under: { american: -115, line: 47.5 } },
    );
    expect(locked.lineFit).toBe('lock');

    const middle = totalTwoWay(
      { over: { american: -110, line: 47.5 }, under: { american: -110, line: 47.5 } },
      { over: { american: -105, line: 48 }, under: { american: -115, line: 48 } },
    );
    expect(middle.lineFit).toBe('middle');
    expect(middle.legs.map((leg) => `${leg.book}:${leg.side}:${leg.line}`)).toEqual([
      'fd:over:47.5',
      'dk:under:48',
    ]);
  });

  it('picks the lower implied sum between the two pairings', () => {
    const a = quoteFromAmerican(-110);
    const b = quoteFromAmerican(100);
    const picked = pickBestTwoWay(
      {
        a,
        b: quoteFromAmerican(-120),
        numberMatch: true,
        legA: { book: 'fd' },
        legB: { book: 'dk' },
      },
      {
        a: quoteFromAmerican(-105),
        b,
        numberMatch: true,
        legA: { book: 'fd' },
        legB: { book: 'dk' },
      },
    );
    expect(picked.pSum).toBeCloseTo(quoteFromAmerican(-105).implied + b.implied, 6);
  });
});

describe('merge + sort', () => {
  const fd = [{
    eventId: 'fd-1',
    home: 'Alabama',
    away: 'Georgia',
    openDate: '2026-10-10T23:30:00.000Z',
    moneyline: { away: { american: 150 }, home: { american: -175 } },
    spread: { away: { american: -110, line: 3.5 }, home: { american: -110, line: -3.5 } },
    total: { over: { american: -110, line: 55.5 }, under: { american: -110, line: 55.5 } },
  }];
  const dk = [{
    eventId: 'dk-1',
    home: 'Alabama',
    away: 'Georgia',
    openDate: '2026-10-10T23:30:00.000Z',
    moneyline: { away: { american: 145 }, home: { american: -166 } },
    spread: { away: { american: -108, line: 3.5 }, home: { american: -112, line: -3.5 } },
    total: { over: { american: -105, line: 55.5 }, under: { american: -115, line: 55.5 } },
  }];

  it('does not treat an NBA home-and-home as one flipped game', () => {
    const [xmas] = mergeBookGames(
      [{
        eventId: 'fd-xmas',
        home: 'Minnesota Timberwolves',
        away: 'Oklahoma City Thunder',
        openDate: '2026-12-26T01:00:00.000Z',
        moneyline: { away: { american: -158 }, home: { american: 134 } },
      }],
      [
        {
          eventId: 'dk-nov',
          home: 'Oklahoma City Thunder',
          away: 'Minnesota Timberwolves',
          openDate: '2026-11-26T00:40:00.000Z',
          moneyline: { away: { american: 295 }, home: { american: -375 } },
        },
        {
          eventId: 'dk-xmas',
          home: 'Minnesota Timberwolves',
          away: 'Oklahoma City Thunder',
          openDate: '2026-12-26T01:10:00.000Z',
          moneyline: { away: { american: -155 }, home: { american: 130 } },
        },
      ],
      'nba',
    );
    expect(xmas.dkEventId).toBe('dk-xmas');
    expect(xmas.moneyline.dk.away.american).toBe(-155);
    expect(xmas.moneyline.dk.home.american).toBe(130);
    expect(xmas.moneyline.twoWay.hasArb).toBe(false);
  });

  it('flips DK sides when home/away are reversed', () => {
    const [game] = mergeBookGames(
      [{
        eventId: 'fd-tex',
        home: 'Oklahoma',
        away: 'Texas',
        moneyline: { away: { american: 150 }, home: { american: -175 } },
      }],
      [{
        eventId: 'dk-tex',
        home: 'Texas',
        away: 'Oklahoma',
        moneyline: { away: { american: -166 }, home: { american: 145 } },
      }],
      'cfb',
    );
    expect(game.home).toBe('Oklahoma');
    expect(game.dkEventId).toBe('dk-tex');
    expect(game.moneyline.dk.away.american).toBe(145);
    expect(game.moneyline.dk.home.american).toBe(-166);
    expect(game.moneyline.twoWay.legs.map((leg) => `${leg.book}:${leg.side}:${leg.american}`)).toEqual([
      'fd:away:150',
      'dk:home:-166',
    ]);
  });

  it('merges matching books and computes a best pSum', () => {
    const [game] = mergeBookGames(fd, dk, 'cfb');
    expect(game.dkEventId).toBe('dk-1');
    expect(game.moneyline.twoWay).toBeTruthy();
    expect(game.bestPSum).toBeCloseTo(game.moneyline.twoWay.pSum, 8);
    expect(game.bestPSum).toBeLessThanOrEqual(game.spread.twoWay.pSum);
    expect(game.bestPSum).toBeLessThanOrEqual(game.total.twoWay.pSum);
  });

  it('sorts closest-to-even first and filters by sport', () => {
    const close = buildGameMarkets({
      sport: 'nfl',
      home: 'Bills',
      away: 'Jets',
      moneyline: {
        fd: { away: { american: 100 }, home: { american: -120 } },
        dk: { away: { american: -110 }, home: { american: 100 } },
      },
    });
    const wide = buildGameMarkets({
      sport: 'cfb',
      home: 'Alabama',
      away: 'Georgia',
      moneyline: {
        fd: { away: { american: -110 }, home: { american: -110 } },
        dk: { away: { american: -110 }, home: { american: -110 } },
      },
    });
    const sorted = sortGames([wide, close], 'best');
    expect(sorted[0].sport).toBe('nfl');
    expect(filterGames(sorted, 'cfb')).toHaveLength(1);
    const live = { ...close, inPlay: true };
    const upcoming = { ...wide, inPlay: false };
    expect(filterGames([live, upcoming], 'all', 'live')).toEqual([live]);
    expect(filterGames([live, upcoming], 'all', 'upcoming')).toEqual([upcoming]);
    expect(sportFiltersFor(sorted).map((row) => row.id)).toEqual(SPORT_FILTERS.map((row) => row.id));
    expect(gameHasMinOdds(close, 'fd', 1500)).toBe(false);
    const longshot = {
      ...close,
      extras: [{
        key: 'fg|yesno|anytime|player:foo',
        fd: { yes: { american: 1600 }, no: { american: -4000 } },
        dk: { yes: { american: 900 }, no: { american: -2000 } },
      }],
    };
    expect(gameHasMinOdds(longshot, 'fd', 1500)).toBe(true);
    expect(gameHasMinOdds(longshot, 'dk', 1500)).toBe(false);
    expect(filterGames([close, longshot], 'all', 'all', { oddsFilter: { book: 'fd', minAmerican: 1500 } })).toEqual([longshot]);
    expect(gameHasMinOdds({ moneyline: { fd: { away: { american: -110 }, home: { american: -110 } } } }, 'fd', -110)).toBe(true);
    expect(gameHasMinOdds({ moneyline: { fd: { away: { american: -150 }, home: { american: 130 } } } }, 'fd', -110)).toBe(true);
    expect(gameHasMinOdds({ moneyline: { fd: { away: { american: -150 }, home: { american: -170 } } } }, 'fd', -110)).toBe(false);

    const emptyMainsHiddenExtra = buildGameMarkets({
      sport: 'soccer',
      home: 'Netherlands',
      away: 'Serbia',
      moneyline: { fd: null, dk: null },
      spread: { fd: null, dk: null },
      total: { fd: null, dk: null },
    });
    emptyMainsHiddenExtra.extras = [{
      key: 'fg|moneyline|winner|game',
      label: 'ML',
      kind: 'moneyline',
      main: true,
      twoWay: { pSum: 0.57, hasArb: true, legs: [] },
    }];
    expect(visibleBestPSum(emptyMainsHiddenExtra)).toBeNull();
    const withMain = buildGameMarkets({
      sport: 'tennis',
      home: 'Coco Gauff',
      away: 'Xinran Sun',
      moneyline: {
        fd: { away: { american: 1160 }, home: { american: -2800 } },
        dk: { away: { american: -2200 }, home: { american: 1020 } },
      },
    });
    expect(sortGames([emptyMainsHiddenExtra, withMain], 'best')[0].home).toBe('Coco Gauff');

    const juiceLongshot = {
      ...close,
      away: 'Broncos',
      extras: [{
        key: 'fg|yesno|anytime|player:juice',
        fd: { yes: { american: 1600 }, no: { american: -4000 } },
        twoWay: {
          pSum: 1.12,
          legs: [{ book: 'fd', american: 1600 }, { book: 'dk', american: -220 }],
        },
      }],
    };
    const evenLongshot = {
      ...wide,
      extras: [{
        key: 'fg|yesno|anytime|player:even',
        fd: { yes: { american: 1800 }, no: { american: -5000 } },
        twoWay: {
          pSum: 1.03,
          legs: [{ book: 'fd', american: 1800 }, { book: 'dk', american: -110 }],
        },
      }],
    };
    expect(sortGames([juiceLongshot, evenLongshot], 'best')[0].away).toBe('Broncos');
    expect(sortGames([juiceLongshot, evenLongshot], 'best', { oddsFilter: { book: 'fd', minAmerican: 1500 } })[0].away).toBe('Georgia');
    expect(isBestTwoWay(juiceLongshot.moneyline, juiceLongshot, { oddsFilter: { book: 'fd', minAmerican: 1500 } })).toBe(false);
    expect(isBestTwoWay(evenLongshot.extras[0], evenLongshot, { oddsFilter: { book: 'fd', minAmerican: 1500 } })).toBe(true);
  });

  it('fills empty soccer mains from deep extras', () => {
    const game = buildGameMarkets({
      sport: 'soccer',
      home: 'Liverpool',
      away: 'Man City',
      moneyline: { fd: null, dk: null },
      spread: { fd: null, dk: null },
      total: { fd: null, dk: null },
    });
    const filled = fillMainsFromExtras(game, [{
      key: 'fg|total|points|game',
      kind: 'total',
      main: true,
      fd: { over: { american: -110, line: 2.5 }, under: { american: -110, line: 2.5 } },
      dk: { over: { american: 100, line: 2.5 }, under: { american: -120, line: 2.5 } },
      twoWay: { pSum: 0.99, hasArb: true, legs: [] },
    }]);
    expect(filled.total.twoWay.pSum).toBe(0.99);
    expect(filled.bestPSum).toBe(0.99);
  });

  it('does not rank a gap spread as the game best', () => {
    const game = buildGameMarkets({
      sport: 'cfb',
      home: 'NC State',
      away: 'Louisville',
      moneyline: {
        fd: { away: { american: -156 }, home: { american: 130 } },
        dk: { away: { american: -166 }, home: { american: 140 } },
      },
      spread: {
        fd: { away: { american: 100, line: -3.5 }, home: { american: -122, line: 3.5 } },
        dk: { away: { american: -118, line: -3 }, home: { american: -102, line: 3 } },
      },
    });
    expect(game.spread.twoWay.lineFit).toBe('middle');
    expect(game.bestPSum).toBeCloseTo(game.moneyline.twoWay.pSum, 8);
    expect(game.bestPSum).toBeLessThan(game.spread.twoWay.pSum);
  });
});

describe('display helpers', () => {
  it('formats combined and juice', () => {
    expect(formatCombinedPct(1.0241)).toBe('102.41%');
    expect(formatJuicePct(1.024)).toBe('+2.40%');
    expect(formatJuicePct(0.988)).toBe('1.20% arb');
    expect(formatJuicePct(1)).toBe('even');
  });
});
