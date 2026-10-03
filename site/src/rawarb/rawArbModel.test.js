import {
  buildGameMarkets,
  filterGames,
  formatCombinedPct,
  formatJuicePct,
  mergeBookGames,
  moneylineTwoWay,
  parseSignedAmerican,
  pickBestTwoWay,
  quoteFromAmerican,
  sortGames,
  spreadTwoWay,
  totalTwoWay,
} from './rawArbModel';
import { gamesMatch, parseEventTeams, teamsMatch } from './teamMatch';

describe('parseSignedAmerican', () => {
  it('reads unicode minus and plus prefixes', () => {
    expect(parseSignedAmerican('−110')).toBe(-110);
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
