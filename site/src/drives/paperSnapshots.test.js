import {
  buildDrivesLiveLinesSnapshot,
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

function withMainLines(game, { spread = -3.5, total = 48.5, clock = '8:42' } = {}) {
  return {
    ...game,
    live: { ...game.live, clock },
    lines: {
      spread: {
        marketName: 'Spread',
        runners: [
          { runnerName: game.teams.home, handicap: spread, american: -110 },
          { runnerName: game.teams.away, handicap: -spread, american: -110 },
        ],
      },
      total: {
        marketName: 'Total Points',
        runners: [
          { runnerName: 'Over', handicap: total, american: -105 },
          { runnerName: 'Under', handicap: total, american: -115 },
        ],
      },
    },
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

  it('stores the current spread and total on pregame first-drive rows', () => {
    const rows = collectDrivesPaperSnapshots([withMainLines(pregameGame())]);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.phase === 'pregame_first')).toBe(true);
    expect(rows.every((row) => row.payload.home_spread === -3.5)).toBe(true);
    expect(rows.every((row) => row.payload.total === 48.5)).toBe(true);
    expect(rows.every((row) => row.payload.total_over_american === -105)).toBe(true);
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

  it('records live spread and total without live drive-result four-ways', () => {
    const live = withMainLines({
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
    });
    expect(drivesCapturePhase(live)).toBe(null);
    const rows = collectDrivesPaperSnapshots([live], {
      pregameByEvent: { cfb1: { home_spread: -7, total: 52.5 } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe('live_lines');
    expect(rows[0].offenseSide).toBeNull();
    expect(rows[0].payload.home_spread).toBe(-3.5);
    expect(rows[0].payload.total).toBe(48.5);
    expect(rows[0].payload.pregame_spread).toBe(-7);
    expect(rows[0].payload.pregame_total).toBe(52.5);
    expect(rows[0].payload.period).toBe(1);
    expect(rows[0].payload.fd_td).toBeUndefined();
  });

  it('keeps the live-lines fingerprint when only the clock ticks', () => {
    const base = {
      ...pregameGame(),
      inPlay: true,
      score: { home: 14, away: 7 },
      live: { period: 1, clock: '8:42', state: 'in' },
    };
    const a = buildDrivesLiveLinesSnapshot(withMainLines(base, { clock: '8:42' }));
    const b = buildDrivesLiveLinesSnapshot(withMainLines(base, { clock: '8:11' }));
    const moved = buildDrivesLiveLinesSnapshot(withMainLines(base, { spread: -6.5, total: 51, clock: '8:11' }));
    expect(a.oddsFingerprint).toBe(b.oddsFingerprint);
    expect(moved.oddsFingerprint).not.toBe(a.oddsFingerprint);
  });
});
