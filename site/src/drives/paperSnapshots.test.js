import {
  buildDrivesPaperSnapshot,
  collectDrivesPaperSnapshots,
  drivesCapturePhase,
} from './paperSnapshots';

function firstDriveMarket(side, name, td) {
  return {
    source: 'fd',
    offenseSide: side,
    offenseName: name,
    driveN: 1,
    marketName: `${name} 1st Drive Result`,
    outcomes: {
      td: { american: td, fd: { american: td } },
      punt: { american: -110, fd: { american: -110 } },
      fg: { american: 400, fd: { american: 400 } },
      other: { american: 350, fd: { american: 350 } },
    },
  };
}

function pregameGame() {
  const home = firstDriveMarket('home', 'Alabama', 150);
  const away = firstDriveMarket('away', 'Georgia', 180);
  return {
    eventId: 'cfb1',
    name: 'Georgia @ Alabama',
    teams: { home: 'Alabama', away: 'Georgia' },
    openDate: '2026-10-17T16:00:00Z',
    inPlay: false,
    score: { home: 0, away: 0 },
    live: { state: 'pre' },
    driveMarkets: [away, home],
    nextDrive: away,
  };
}

describe('drives paper snapshots', () => {
  it('records pregame first-drive lines for both teams', () => {
    const game = pregameGame();
    expect(drivesCapturePhase(game)).toBe('pregame_first');
    const rows = collectDrivesPaperSnapshots([game]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.offenseSide).sort()).toEqual(['away', 'home']);
    expect(rows.every((row) => row.phase === 'pregame_first')).toBe(true);
    expect(rows.some((row) => row.payload.fd_td === 150)).toBe(true);
    expect(rows.some((row) => row.payload.fd_td === 180)).toBe(true);
    expect(rows[0].payload.model_p_td).toEqual(expect.any(Number));
    expect(rows[0].payload.live_p_td).toEqual(expect.any(Number));
  });

  it('records halftime next-drive lines and skips ordinary in-play snaps', () => {
    const live = {
      ...pregameGame(),
      inPlay: true,
      score: { home: 14, away: 7 },
      live: {
        period: 1,
        clock: '8:42',
        possession: 'home',
        down: 2,
        distance: 7,
        yardsToEndzone: 60,
        state: 'in',
      },
    };
    expect(drivesCapturePhase(live)).toBe(null);
    expect(collectDrivesPaperSnapshots([live])).toHaveLength(0);

    const ht = {
      ...pregameGame(),
      inPlay: true,
      score: { home: 17, away: 10 },
      live: {
        period: 2,
        clock: '0:00',
        halfTime: true,
        state: 'halftime',
      },
    };
    expect(drivesCapturePhase(ht)).toBe('halftime_next');
    const rows = collectDrivesPaperSnapshots([ht]);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((row) => row.phase === 'halftime_next')).toBe(true);
    expect(rows.every((row) => row.payload.score_home === 17)).toBe(true);
  });

  it('keeps the same fingerprint when HT odds and score are unchanged', () => {
    const ht = {
      ...pregameGame(),
      inPlay: true,
      score: { home: 17, away: 10 },
      live: { period: 2, clock: '0:00', halfTime: true, state: 'halftime' },
    };
    const a = buildDrivesPaperSnapshot(ht, ht.driveMarkets[0]);
    const b = buildDrivesPaperSnapshot(ht, ht.driveMarkets[0]);
    expect(a.oddsFingerprint).toBe(b.oddsFingerprint);
  });
});
