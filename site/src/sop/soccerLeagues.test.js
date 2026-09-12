import {
  collectLeagueOptions,
  competitionMetaForFd,
  dkLeagueEntries,
  filterSopBookGames,
  gameHasNextGoalMethod,
  gameMatchesTiming,
  slugCompetitionKey,
} from './soccerLeagues';

describe('soccer league catalog', () => {
  it('maps FanDuel La Liga and Bundesliga ids', () => {
    expect(competitionMetaForFd(117)).toEqual({
      competitionId: 117,
      competition: 'lal',
      competitionName: 'La Liga',
    });
    expect(competitionMetaForFd(59)).toEqual({
      competitionId: 59,
      competition: 'bun',
      competitionName: 'Bundesliga',
    });
  });

  it('slugs unknown FanDuel competitions from the sport page name', () => {
    expect(competitionMetaForFd(9404054, { 9404054: { name: 'Dutch Eredivisie' } })).toEqual({
      competitionId: 9404054,
      competition: 'dutch-eredivisie',
      competitionName: 'Dutch Eredivisie',
    });
    expect(slugCompetitionKey('English Premier League', 1)).toBe('english-premier-league');
  });

  it('uses live DraftKings league ids for La Liga and Bundesliga', () => {
    const byKey = Object.fromEntries(dkLeagueEntries('all').map((row) => [row.competition, row]));
    expect(byKey.lal).toMatchObject({ id: '40031', seo: 'spain---la-liga' });
    expect(byKey.bun).toMatchObject({ id: '40481', seo: 'germany---1.bundesliga' });
  });
});

describe('Next Goal Method gate', () => {
  it('requires the market on FanDuel or DraftKings', () => {
    expect(gameHasNextGoalMethod({
      noGoalMarkets: { totalGoalsUnder: { american: 120 } },
    })).toBe(false);
    expect(gameHasNextGoalMethod({
      noGoalMarkets: { nextGoalMethod: { american: 400 } },
    })).toBe(true);
    expect(gameHasNextGoalMethod({
      goalTypes: { sop: { american: 150 } },
    })).toBe(true);
    expect(gameHasNextGoalMethod({
      dk: { noGoalMarkets: { nextGoalMethod: { american: 350 } } },
    })).toBe(true);
    expect(gameHasNextGoalMethod({
      noGoalMarkets: { nextGoalMethod: { market: 'Next Goal Method' } },
    })).toBe(false);
  });
});

describe('SOP2 book filters', () => {
  const games = [
    { eventId: 'live-pl', name: 'Arsenal v Chelsea', competition: 'pl', inPlay: true },
    { eventId: 'fut-lal', name: 'Barca v Real', competition: 'lal', competitionName: 'La Liga', inPlay: false },
    { eventId: 'done', name: 'Koln v Bremen', competition: 'bun', inPlay: false, espn: { finished: true } },
  ];

  it('filters live vs future and skips finished games in Future only', () => {
    expect(gameMatchesTiming(games[0], 'live')).toBe(true);
    expect(gameMatchesTiming(games[1], 'future')).toBe(true);
    expect(gameMatchesTiming(games[2], 'future')).toBe(false);
    expect(filterSopBookGames(games, { timing: 'live' }).map((g) => g.eventId)).toEqual(['live-pl']);
    expect(filterSopBookGames(games, { timing: 'future' }).map((g) => g.eventId)).toEqual(['fut-lal']);
  });

  it('hides disabled leagues and still searches team names', () => {
    const hidden = new Set(['pl']);
    expect(filterSopBookGames(games, { disabledLeagues: hidden }).map((g) => g.eventId))
      .toEqual(['fut-lal', 'done']);
    expect(filterSopBookGames(games, { teamQuery: 'barca' }).map((g) => g.eventId)).toEqual(['fut-lal']);
  });

  it('lists present leagues in catalog order', () => {
    expect(collectLeagueOptions(games).map((row) => row.key)).toEqual(['pl', 'lal', 'bun']);
  });
});
