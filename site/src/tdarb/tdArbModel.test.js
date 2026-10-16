import {
  buildPlayerHedge,
  findKalshiPlayer,
  kalshiEventMatchesGame,
  parseKalshiTdEventTeams,
  parseKalshiTdPlayerTitle,
} from './tdArbCore';

describe('parseKalshiTdPlayerTitle', () => {
  it('parses 1+ TD player names', () => {
    expect(parseKalshiTdPlayerTitle('Jalen Hurts: 1+ touchdowns')).toBe('Jalen Hurts');
    expect(parseKalshiTdPlayerTitle('Foo: 2+ touchdowns')).toBeNull();
  });
});

describe('kalshiEventMatchesGame', () => {
  it('matches Kalshi title to raw arb game', () => {
    const event = { title: 'Philadelphia vs Jacksonville: Touchdowns' };
    const game = { sport: 'nfl', away: 'Philadelphia Eagles', home: 'Jacksonville Jaguars' };
    expect(kalshiEventMatchesGame(event, game)).toBe(true);
    expect(parseKalshiTdEventTeams(event.title).teamA).toBe('Philadelphia');
  });
});

describe('findKalshiPlayer', () => {
  it('fuzzy-matches book names to Kalshi', () => {
    const rows = [{ name: 'Jalen Hurts', noAmerican: -400 }];
    expect(findKalshiPlayer(rows, 'J. Hurts')?.name).toBe('Jalen Hurts');
  });
});

describe('buildPlayerHedge', () => {
  it('pairs best book YES with Kalshi NO', () => {
    const row = buildPlayerHedge({
      name: 'Test Player',
      fd: { american: 150 },
      dk: { american: 120 },
      kalshi: { name: 'Test Player', noAmerican: -130, yesAmerican: 120 },
    });
    expect(row.bestBook.book).toBe('fd');
    expect(row.hedge).toBeTruthy();
    expect(row.hedge.legs.some((l) => l.book === 'kalshi')).toBe(true);
    expect(row.hedge.pSum).toBeGreaterThan(0);
  });
});
