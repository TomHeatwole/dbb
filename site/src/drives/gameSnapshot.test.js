import { buildDrivesGameSnapshot, pickHeadlineDrivePlay, shortDriveGameName } from './gameSnapshot';
import { evaluateDriveGame } from './driveModel';

describe('drives game snapshot', () => {
  const game = {
    eventId: 'd1',
    name: 'Jacksonville State @ North Dakota State',
    teams: { home: 'North Dakota State', away: 'Jacksonville State' },
    inPlay: true,
    scoreDisplay: '7-0',
    live: { period: 1, clock: '8:42' },
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
    const model = evaluateDriveGame(game);
    const play = pickHeadlineDrivePlay(model);

    expect(snap.market).toBe(play.key === 'td' ? 'TD' : play.key === 'fg' ? 'FG' : play.label);
    expect(snap.oddsBook).toBe('fd');
    expect(snap.oddsAmerican).toBe(play.american);
    expect(snap.lineLabel).toMatch(/^model /);
    expect(snap.clock).toBe('Q1 8:42');
    expect(snap.edgePoints).toBeCloseTo(play.edgePoints, 5);
    expect(snap.profitable).toBe(Boolean(play.profitable));
  });
});
