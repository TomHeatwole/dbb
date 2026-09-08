import {
  cornerFixtureKey,
  gameHasFdOrDkCornerLines,
  keepCornersDisplayGames,
  mergeDkCornersIntoFdGames,
} from './mergeCornerBooks';

describe('corners fixture matching', () => {
  it('matches FanDuel and DraftKings Champions League names', () => {
    expect(cornerFixtureKey('Real Madrid v Inter')).toBe(
      cornerFixtureKey('Real Madrid vs Inter Milan'),
    );
    expect(cornerFixtureKey('Paris St-G v Slovan Bratislava')).toBe(
      cornerFixtureKey('Paris St-Germain vs Slovan Bratislava'),
    );
    expect(cornerFixtureKey('PSV v Shakhtar')).toBe(
      cornerFixtureKey('PSV Eindhoven vs Shakhtar Donetsk'),
    );
  });
});

describe('corners book merge', () => {
  it('merges DK onto FD rows by alias and appends DK-only games with lines', () => {
    const merged = mergeDkCornersIntoFdGames(
      [
        { eventId: 1, name: 'Real Madrid v Inter', competition: 'ucl' },
        { eventId: 2, name: 'Arsenal v Chelsea', competition: 'pl' },
      ],
      {
        games: [
          {
            name: 'Real Madrid vs Inter Milan',
            dkEventId: '34592818',
            total: { line: 9.5, over: { american: -110 } },
          },
          {
            name: 'Napoli vs Arsenal',
            dkEventId: '34592955',
            competition: 'ucl',
            total: { line: 10.5, over: { american: -105 } },
          },
        ],
      },
    );

    expect(merged[0].dk.dkEventId).toBe('34592818');
    expect(merged[0].dk.total.line).toBe(9.5);
    expect(merged[1].dk).toBeNull();
    expect(merged[2].eventId).toBe('dk-34592955');
    expect(merged[2].competition).toBe('ucl');
    expect(merged[2].dk.total.line).toBe(10.5);
  });

  it('keeps Premier League games without lines and drops UCL without FD/DK lines', () => {
    const pl = { eventId: 'pl', name: 'A v B', competition: 'pl' };
    const uclBare = { eventId: 'ucl-bare', name: 'C v D', competition: 'ucl' };
    const uclFd = {
      eventId: 'ucl-fd',
      name: 'E v F',
      competition: 'ucl',
      total: { line: 10.5, over: { american: -110 } },
    };
    const uclDk = {
      eventId: 'ucl-dk',
      name: 'G v H',
      competition: 'ucl',
      dk: { total: { line: 9.5, under: { american: 100 } } },
    };

    expect(gameHasFdOrDkCornerLines(uclBare)).toBe(false);
    expect(keepCornersDisplayGames([pl, uclBare, uclFd, uclDk]).map((g) => g.eventId))
      .toEqual(['pl', 'ucl-fd', 'ucl-dk']);
  });
});
