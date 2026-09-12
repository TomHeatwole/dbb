import {
  buildDrivesGameSnapshot,
  buildDrivesMonitorRows,
  compareDriveSnapshotRows,
  pickHeadlineDrivePlay,
  shortDriveGameName,
} from './gameSnapshot';
import { evaluateDriveGame, listDriveSides } from './driveModel';

function liveDualMarketGame({
  eventId = 'd1',
  currentTd = 900,
  nextTd = 220,
} = {}) {
  const homeMarket = {
    source: 'fd',
    offenseSide: 'home',
    offenseName: 'North Dakota State',
    driveN: 2,
    marketName: 'NDSU Drive 2 - Result',
    outcomes: {
      td: { american: currentTd },
      punt: { american: -110 },
      fg: { american: 400 },
      other: { american: 350 },
    },
  };
  const awayMarket = {
    source: 'fd',
    offenseSide: 'away',
    offenseName: 'Jacksonville State',
    driveN: 2,
    marketName: 'Jacksonville State Drive 2 - Result',
    outcomes: {
      td: { american: nextTd },
      punt: { american: -130 },
      fg: { american: 380 },
      other: { american: 400 },
    },
  };
  return {
    eventId,
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
    driveMarkets: [homeMarket, awayMarket],
    nextDrive: homeMarket,
  };
}

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

  it('sorts the snapshot by largest edge', () => {
    const ranked = [
      { eventId: 'low', name: 'Zed @ Zee', edgePoints: -3 },
      { eventId: 'mid', name: 'Ann @ Ada', edgePoints: 1.5 },
      { eventId: 'high', name: 'Bob @ Bo', edgePoints: 12 },
      { eventId: 'none', name: 'Cal @ Co', edgePoints: null },
    ].sort(compareDriveSnapshotRows);
    expect(ranked.map((row) => row.eventId)).toEqual(['high', 'mid', 'low', 'none']);

    const priced = { ...game, eventId: 'priced' };
    const dead = {
      eventId: 'dead',
      name: 'East Carolina @ Alabama',
      teams: { home: 'Alabama', away: 'East Carolina' },
      inPlay: true,
      scoreDisplay: '10-0',
      live: { period: 1, clock: 'End of 1st', possession: 'home', possessionName: 'Alabama' },
    };
    const rows = buildDrivesMonitorRows([dead, priced]);
    expect(rows.map((row) => row.eventId)).toEqual(['priced', 'dead']);
    expect(rows[0].edgePoints).toBeGreaterThan(rows[1].edgePoints ?? -Infinity);
  });

  it('can headline the next drive instead of a lagged current line', () => {
    const live = liveDualMarketGame();
    const all = buildDrivesGameSnapshot(live);
    const next = buildDrivesGameSnapshot(live, { nextDriveOnly: true });
    expect(all.role).toBe('current');
    expect(next.role).toBe('next');
    expect(next.market).toMatch(/^Jacksonville /);
    expect(next.edgePoints).toBeLessThan(all.edgePoints);
    const rows = buildDrivesMonitorRows([live], Date.now(), { nextDriveOnly: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('next');
  });
});
