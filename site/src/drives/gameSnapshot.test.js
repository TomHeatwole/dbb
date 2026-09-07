import { buildDrivesGameSnapshot, pickHeadlineDrivePlay, shortDriveGameName } from './gameSnapshot';
import { evaluateDriveGame, listDriveSides } from './driveModel';

describe('drives game snapshot', () => {
  const game = {
    eventId: 'd1',
    name: 'Jacksonville State @ North Dakota State',
    teams: { home: 'North Dakota State', away: 'Jacksonville State' },
    inPlay: true,
    scoreDisplay: '7-0',
    live: {
      period: 1,
      clock: '8:42',
      possession: 'home',
      possessionName: 'North Dakota State',
      down: 2,
      distance: 7,
      yardsToEndzone: 60,
      state: 'in',
    },
    nextDrive: {
      source: 'fd',
      marketName: 'Drive Result',
      outcomes: {
        td: { american: 250 },
        punt: { american: -110 },
        fg: { american: 400 },
        other: { american: 350 },
      },
    },
  };

  it('shortens CFB names as away @ home', () => {
    expect(shortDriveGameName(game)).toBe('Jacksonville @ ND St');
  });

  it('snapshots the highest-edge drive result vs the model', () => {
    const snap = buildDrivesGameSnapshot(game);
    const sides = listDriveSides(game);
    const views = sides.map((market) => evaluateDriveGame(game, { market }));
    const plays = views.map((model) => pickHeadlineDrivePlay(model)).filter(Boolean);
    const play = plays.reduce((best, cur) => (
      cur.edgePoints > best.edgePoints ? cur : best
    ));

    expect(snap.market).toMatch(/^(Jacksonville|ND St) /);
    expect(snap.oddsBook).toBe('fd');
    expect(snap.oddsAmerican).toBe(play.american);
    expect(snap.lineLabel).toMatch(/^model /);
    expect(snap.clock).toBe('Q1 8:42');
    expect(snap.edgePoints).toBeCloseTo(play.edgePoints, 5);
    expect(snap.profitable).toBe(Boolean(play.profitable));
  });

  it('labels a live dead-ball card with the team that is up now', () => {
    const live = {
      eventId: 'd2',
      name: 'East Carolina @ Alabama',
      teams: { home: 'Alabama', away: 'East Carolina' },
      inPlay: true,
      scoreDisplay: '10-0',
      live: {
        period: 1,
        clock: 'End of 1st',
        possession: 'home',
        possessionName: 'Alabama',
      },
    };
    const snap = buildDrivesGameSnapshot(live);
    expect(snap.market).toBe('Alabama current');
  });
});
