import {
  fixtureTeamKey,
  gameHasFdOrDkLines,
  keepSopDisplayGames,
  mergeDkIntoFdGames,
} from './mergeDkGames';

describe('SOP fixture matching', () => {
  it('matches FanDuel and DraftKings Champions League names', () => {
    expect(fixtureTeamKey('Real Madrid v Inter')).toBe(
      fixtureTeamKey('Real Madrid vs Inter Milan'),
    );
    expect(fixtureTeamKey('Paris St-G v Slovan Bratislava')).toBe(
      fixtureTeamKey('Paris St-Germain vs Slovan Bratislava'),
    );
    expect(fixtureTeamKey('Lille v Betis')).toBe(
      fixtureTeamKey('Lille vs Real Betis'),
    );
    expect(fixtureTeamKey('PSV v Shakhtar')).toBe(
      fixtureTeamKey('PSV Eindhoven vs Shakhtar Donetsk'),
    );
    expect(fixtureTeamKey('Man Utd v FC Sabah')).toBe(
      fixtureTeamKey('Man Utd vs Sabah FK'),
    );
    expect(fixtureTeamKey('Bayern Munich v Bodo Glimt')).toBe(
      fixtureTeamKey('Bayern Munchen vs Bodo Glimt'),
    );
  });
});

describe('SOP book merge', () => {
  it('merges DK onto FD rows by alias and appends DK-only games with lines', () => {
    const merged = mergeDkIntoFdGames(
      [
        { eventId: 1, name: 'Real Madrid v Inter', competition: 'ucl' },
        { eventId: 2, name: 'Arsenal v Chelsea', competition: 'pl' },
      ],
      {
        games: [
          {
            name: 'Real Madrid vs Inter Milan',
            dkEventId: 'dk-inter',
            goalTypes: { sop: { american: 150 } },
            noGoalMarkets: { totalGoalsUnder: { american: -110 } },
          },
          {
            name: 'Napoli vs Arsenal',
            dkEventId: '34592955',
            competition: 'ucl',
            teams: { home: 'Napoli', away: 'Arsenal' },
            goalTypes: { sop: { american: 200 } },
            noGoalMarkets: { nextGoalMethod: { american: 400 } },
          },
        ],
      },
    );

    expect(merged[0].dk.dkEventId).toBe('dk-inter');
    expect(merged[0].dk.goalTypes.sop.american).toBe(150);
    expect(merged[1].dk).toBeNull();
    expect(merged[2].eventId).toBe('dk-34592955');
    expect(merged[2].competition).toBe('ucl');
    expect(merged[2].dk.goalTypes.sop.american).toBe(200);
  });

  it('keeps Premier League games without lines and drops UCL without FD/DK lines', () => {
    const pl = { eventId: 'pl', name: 'A v B', competition: 'pl' };
    const uclBare = { eventId: 'ucl-bare', name: 'C v D', competition: 'ucl' };
    const uclFd = {
      eventId: 'ucl-fd',
      name: 'E v F',
      competition: 'ucl',
      noGoalMarkets: { totalGoalsUnder: { american: 120 } },
    };
    const uclDk = {
      eventId: 'ucl-dk',
      name: 'G v H',
      competition: 'ucl',
      dk: { goalTypes: { sop: { american: 180 } } },
    };

    expect(gameHasFdOrDkLines(uclBare)).toBe(false);
    expect(keepSopDisplayGames([pl, uclBare, uclFd, uclDk]).map((g) => g.eventId))
      .toEqual(['pl', 'ucl-fd', 'ucl-dk']);
  });
});
