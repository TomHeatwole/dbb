import {
  applyFdAheadLive,
  espnClockAheadOfFd,
  fdLiveFromRows,
  fdStateAheadOfEspn,
  formatFdLiveSpot,
  formatLiveSituationLine,
  liveSourceAheadOf,
  liveSpotsDisagree,
  liveSnapsAgree,
  liveStateAdvanceRank,
  nonEspnSourceAhead,
  parseFdLiveSituation,
  pickBestLiveState,
  postPuntReceiptLock,
  resolveFdPossessionSide,
  situationKey,
} from './fdLiveSituation';

function xmlWith(texts) {
  return texts.map((t) => `<node content-desc="${t}" />`).join('');
}

describe('parseFdLiveSituation', () => {
  it('reads quarter, clock, and down & distance from separate nodes', () => {
    const sit = parseFdLiveSituation(xmlWith([
      'Q1',
      '8:12',
      '2nd &amp; 7',
      'at Florida State 35',
    ]));
    expect(sit.period).toBe(1);
    expect(sit.clockSeconds).toBe(8 * 60 + 12);
    expect(sit.clock).toBe('8:12');
    expect(sit.down).toBe(2);
    expect(sit.distance).toBe(7);
    expect(sit.downDistance).toBe('2nd & 7');
    expect(sit.possessionText).toBe('Florida State 35');
    expect(sit.situationText).toBe('Q1 · 8:12 · 2nd & 7');
  });

  it('parses the live-slate "N minutes remaining" clock as approximate', () => {
    const sit = parseFdLiveSituation(xmlWith([
      'Live game  SMU 7 Florida State 0 QUARTER 1 9 minutes remaining',
    ]));
    expect(sit.period).toBe(1);
    expect(sit.clockSeconds).toBe(9 * 60);
    expect(sit.clockApproximate).toBe(true);
    expect(sit.awayScore).toBe(7);
    expect(sit.homeScore).toBe(0);
  });

  it('prefers an exact M:SS clock over minutes remaining', () => {
    const sit = parseFdLiveSituation(xmlWith([
      'Live game  SMU 7 Florida State 0 QUARTER 1 9 minutes remaining',
      '1st and 10',
      '8:44',
    ]));
    expect(sit.clockSeconds).toBe(8 * 60 + 44);
    expect(sit.clockApproximate).toBe(false);
    expect(sit.down).toBe(1);
    expect(sit.distance).toBe(10);
  });

  it('returns null when the page has no live situation', () => {
    expect(parseFdLiveSituation(xmlWith(['Drive 1 - Result', 'Offensive Touchdown +310']))).toBeNull();
  });

  it('parses 3Q plus a labeled game clock', () => {
    const sit = parseFdLiveSituation(xmlWith([
      '3Q',
      'Game clock 9:10',
      '4th &amp; 5',
    ]));
    expect(sit.period).toBe(3);
    expect(sit.clockSeconds).toBe(9 * 60 + 10);
    expect(sit.down).toBe(4);
    expect(sit.distance).toBe(5);
  });
  it('parses Down N Distance M labels', () => {
    const sit = parseFdLiveSituation(xmlWith(['QUARTER 2', '4:22', 'Down 3 Distance 2']));
    expect(sit.period).toBe(2);
    expect(sit.down).toBe(3);
    expect(sit.distance).toBe(2);
    expect(sit.clockSeconds).toBe(4 * 60 + 22);
  });

  it('does not treat a scheduled kickoff time as a game clock', () => {
    expect(parseFdLiveSituation(xmlWith([
      'Scheduled game SMU versus Florida State start at 7:30',
    ]))).toBeNull();
  });

  it('reads the possession arrow and a bare yardline', () => {
    const sit = parseFdLiveSituation(xmlWith([
      'Q4',
      '2:50',
      '1st &amp; 10',
      'Florida State 25',
      'SMU has the ball',
    ]));
    expect(sit.down).toBe(1);
    expect(sit.distance).toBe(10);
    expect(sit.possessionText).toBe('Florida State 25');
    expect(sit.possessionName).toBe('SMU');
    expect(resolveFdPossessionSide(sit, { home: 'Florida State', away: 'SMU' })).toBe('away');
  });

  it('treats a left/right possession arrow as away/home', () => {
    expect(resolveFdPossessionSide(
      parseFdLiveSituation(xmlWith(['Q4', '2:50', '1st & 10', 'Arrow pointing left'])),
      { home: 'Florida State', away: 'SMU' },
    )).toBe('away');
    expect(resolveFdPossessionSide(
      { possessionArrow: 'right' },
      { home: 'Florida State', away: 'SMU' },
    )).toBe('home');
  });

  it('does not treat Oregon as a hit on Oregon State', () => {
    const teams = { home: 'Oregon', away: 'Oregon State' };
    expect(resolveFdPossessionSide({ possessionName: 'Oregon' }, teams)).toBe('home');
    expect(resolveFdPossessionSide({ possessionName: 'Oregon State' }, teams)).toBe('away');
    expect(resolveFdPossessionSide({ possessionName: 'Oregon St' }, teams)).toBe('away');
    expect(resolveFdPossessionSide(
      { possessionName: 'Portland St' },
      { home: 'Oregon', away: 'Portland State' },
    )).toBe('away');
  });
});

describe('fdStateAheadOfEspn', () => {
  const espn = {
    period: 1,
    clockSeconds: 9 * 60 + 1,
    clock: '9:01',
    down: 1,
    distance: 10,
    yardsToEndzone: 75,
    homeScore: 0,
    awayScore: 7,
  };

  it('flags a later down on the same clock', () => {
    expect(fdStateAheadOfEspn({
      period: 1,
      clockSeconds: 9 * 60,
      down: 2,
      distance: 7,
    }, espn)).toBe(true);
  });

  it('flags a clock that has run further in the same quarter', () => {
    expect(fdStateAheadOfEspn({
      period: 1,
      clockSeconds: 8 * 60 + 12,
      down: 1,
      distance: 10,
    }, espn)).toBe(true);
  });

  it('does not flag an approximate "9 minutes remaining" against 9:01', () => {
    expect(fdStateAheadOfEspn({
      period: 1,
      clockSeconds: 9 * 60,
      clockApproximate: true,
      down: 1,
      distance: 10,
    }, espn)).toBe(false);
  });

  it('flags a shorter distance on the same down', () => {
    expect(fdStateAheadOfEspn({
      period: 1,
      clockSeconds: 9 * 60,
      down: 1,
      distance: 4,
    }, espn)).toBe(true);
  });

  it('flags when FanDuel already has the next score', () => {
    expect(fdStateAheadOfEspn({
      period: 1,
      clockSeconds: 8 * 60,
      down: 1,
      distance: 10,
      homeScore: 7,
      awayScore: 7,
    }, espn)).toBe(true);
  });

  it('does not flag matching spots', () => {
    expect(fdStateAheadOfEspn({
      period: 1,
      clockSeconds: 9 * 60 + 1,
      down: 1,
      distance: 10,
      yardsToEndzone: 75,
    }, espn)).toBe(false);
  });

  it('ignores missing FanDuel fields', () => {
    expect(fdStateAheadOfEspn(null, espn)).toBe(false);
    expect(fdStateAheadOfEspn({}, espn)).toBe(false);
  });
});

describe('fdLiveFromRows', () => {
  it('takes the newest row that has a situation', () => {
    const sit = fdLiveFromRows([
      {
        period: 1,
        clock_seconds: 540,
        clock_text: '9:00',
        down: 1,
        distance: 10,
        fetched_at: '2026-09-08T01:00:00.000Z',
      },
      {
        period: 1,
        clock_seconds: 492,
        clock_text: '8:12',
        down: 2,
        distance: 7,
        situation_text: 'Q1 · 8:12 · 2nd & 7',
        fetched_at: '2026-09-08T01:02:00.000Z',
      },
    ]);
    expect(sit.down).toBe(2);
    expect(sit.clockSeconds).toBe(492);
    expect(formatFdLiveSpot(sit)).toBe('Q1 · 8:12 · 2nd & 7');
    expect(situationKey(sit)).toBe('1|492|2|7|');
  });
});

describe('formatLiveSituationLine', () => {
  it('prints quarter, clock, down, and yardline the way the lag compare needs', () => {
    expect(formatLiveSituationLine({
      period: 3,
      clock: '2:08',
      down: 4,
      distance: 2,
      yardsToEndzone: 2,
      possessionText: 'SMU 2',
    })).toBe('Q3 2:08  4th and Goal  at SMU 2');
    expect(formatLiveSituationLine({
      period: 3,
      clockSeconds: 120,
      down: 1,
      distance: 10,
      yardsToEndzone: 75,
      possessionText: 'Florida State 25',
    })).toBe('Q3 2:00  1st and 10  at Florida State 25');
  });

  it('falls back to own/opp yardline when possession text is missing', () => {
    expect(formatLiveSituationLine({
      period: 1,
      clock: '8:12',
      down: 2,
      distance: 7,
      yardsToEndzone: 65,
    })).toBe('Q1 8:12  2nd and 7  at own 35');
  });
});

describe('liveSpotsDisagree', () => {
  it('does not treat a thinner FanDuel snapshot as a mismatch', () => {
    const espn = {
      period: 4,
      clock: '13:42',
      clockSeconds: 13 * 60 + 42,
      down: 1,
      distance: 10,
      yardsToEndzone: 83,
      possessionText: 'SMU 17',
    };
    const fd = {
      period: 4,
      clock: '13:42',
      clockSeconds: 13 * 60 + 42,
      down: 1,
      distance: 10,
      yardsToEndzone: 75,
    };
    expect(liveSpotsDisagree(espn, fd)).toBe(false);
    expect(liveSnapsAgree(espn, fd)).toBe(true);
    expect(formatLiveSituationLine(espn)).not.toBe(formatLiveSituationLine(fd));
  });

  it('flags a real down/clock change', () => {
    expect(liveSpotsDisagree(
      { period: 3, clock: '2:08', down: 4, distance: 2, yardsToEndzone: 2 },
      { period: 3, clock: '2:00', down: 1, distance: 10, yardsToEndzone: 75 },
    )).toBe(true);
  });
});

describe('espnClockAheadOfFd', () => {
  it('is true when ESPN has less time remaining', () => {
    expect(espnClockAheadOfFd(
      { period: 3, clock: '0:36', clockSeconds: 36 },
      { period: 3, clock: '0:45', clockSeconds: 45 },
    )).toBe(true);
    expect(espnClockAheadOfFd(
      { period: 3, clock: '2:08', clockSeconds: 128 },
      { period: 3, clock: '2:00', clockSeconds: 120 },
    )).toBe(false);
    expect(espnClockAheadOfFd(
      { period: 3, clock: '0:45', clockSeconds: 45 },
      { clock: '0:45', clockSeconds: 45 },
    )).toBe(false);
  });
});

describe('liveStateAdvanceRank', () => {
  it('ranks a later quarter with less clock ahead', () => {
    expect(liveStateAdvanceRank({ period: 3, clockSeconds: 36 }))
      .toBeGreaterThan(liveStateAdvanceRank({ period: 3, clockSeconds: 120 }));
    expect(liveStateAdvanceRank({ period: 4, clockSeconds: 900 }))
      .toBeGreaterThan(liveStateAdvanceRank({ period: 3, clockSeconds: 0 }));
  });

  it('prefers exact clocks over approximate ones in the same spot', () => {
    expect(liveStateAdvanceRank({ period: 1, clockSeconds: 540, clockApproximate: false }))
      .toBeGreaterThan(liveStateAdvanceRank({ period: 1, clockSeconds: 540, clockApproximate: true }));
  });
});

describe('liveSourceAheadOf', () => {
  it('trusts the source with less clock remaining', () => {
    expect(liveSourceAheadOf(
      { period: 2, clockSeconds: 120 },
      { period: 2, clockSeconds: 180 },
    )).toBe(true);
    expect(liveSourceAheadOf(
      { period: 2, clockSeconds: 180 },
      { period: 2, clockSeconds: 120 },
    )).toBe(false);
  });
});

describe('pickBestLiveState', () => {
  it('uses FanDuel when its clock has run further', () => {
    const game = {
      inPlay: true,
      teams: { home: 'Florida State', away: 'SMU' },
      score: { home: 0, away: 7 },
      scoreDisplay: '0-7',
      fdLive: {
        period: 1,
        clockSeconds: 8 * 60 + 12,
        clock: '8:12',
        down: 2,
        distance: 7,
        homeScore: 0,
        awayScore: 7,
      },
      live: {
        period: 1,
        clockSeconds: 9 * 60 + 1,
        clock: '9:01',
        down: 1,
        distance: 10,
        homeScore: 0,
        awayScore: 7,
      },
    };
    const out = pickBestLiveState(game);
    expect(out.live.spotSource).toBe('fd');
    expect(out.live.down).toBe(2);
    expect(out.live.clockSeconds).toBe(492);
    expect(out.live.fdAheadOfEspn).toBe(true);
    expect(out.live.liveSources.espn.clockSeconds).toBe(541);
    expect(out.live.liveSources.fd.clockSeconds).toBe(492);
  });

  it('keeps ESPN when it is further along', () => {
    const game = {
      inPlay: true,
      score: { home: 14, away: 7 },
      fdLive: { period: 2, clockSeconds: 600, down: 1, distance: 10 },
      live: { period: 2, clockSeconds: 540, down: 3, distance: 2 },
    };
    const out = pickBestLiveState(game);
    expect(out.live.spotSource).toBe('espn');
    expect(out.live.down).toBe(3);
  });

  it('is idempotent on repeated picks', () => {
    const game = {
      inPlay: true,
      teams: { home: 'Florida State', away: 'SMU' },
      score: { home: 0, away: 7 },
      fdLive: { period: 1, clockSeconds: 492, down: 2, distance: 7 },
      live: { period: 1, clockSeconds: 541, down: 1, distance: 10, possession: 'away' },
    };
    const once = pickBestLiveState(game);
    const twice = pickBestLiveState(once);
    expect(twice.live.spotSource).toBe('fd');
    expect(twice.live.down).toBe(2);
    expect(twice.live.clockSeconds).toBe(once.live.clockSeconds);
    expect(twice.live.espnSnapshot?.clockSeconds).toBe(541);
  });

  it('pulls a fresher score from FD sbapi when totals differ', () => {
    const game = {
      inPlay: true,
      score: { home: 7, away: 7 },
      fdSbapiLive: { homeScore: 14, awayScore: 7 },
      live: { period: 3, clockSeconds: 300, homeScore: 7, awayScore: 7 },
    };
    const out = pickBestLiveState(game);
    expect(out.score).toEqual({ home: 14, away: 7 });
  });
});

describe('postPuntReceiptLock', () => {
  it('parses Drive Over as a series-over spot', () => {
    const sit = parseFdLiveSituation(xmlWith(['Q2', '8:10', 'Drive Over']));
    expect(sit.downDistance).toBe('Drive Over');
    expect(sit.seriesOver).toBe('drive over');
    expect(sit.down).toBeUndefined();
  });

  it('locks the other team’s 1st-and-10 instead of the Drive Over clock', () => {
    const espn = {
      period: 2,
      clockSeconds: 8 * 60 + 40,
      down: 1,
      distance: 10,
      yardsToEndzone: 68,
      possession: 'home',
      lastPlay: 'Smith punt 42 yards to the FSU32',
      lastPlayType: 'Punt',
    };
    const fd = {
      period: 2,
      clockSeconds: 8 * 60 + 10,
      downDistance: 'Drive Over',
      seriesOver: 'drive over',
      possession: 'away',
    };
    expect(postPuntReceiptLock(espn, fd)).toBe(espn);
    expect(liveSpotsDisagree(espn, fd)).toBe(true);

    const game = {
      inPlay: true,
      teams: { home: 'Florida State', away: 'SMU' },
      live: { ...espn, fd },
    };
    const best = pickBestLiveState(game);
    expect(best.live.spotSource).toBe('espn');
    expect(best.live.down).toBe(1);
    expect(best.live.yardsToEndzone).toBe(68);
    expect(best.live.fdAheadOfEspn).toBeUndefined();
  });
});

describe('nonEspnSourceAhead', () => {
  it('flags when FanDuel clock is ahead of ESPN', () => {
    expect(nonEspnSourceAhead({
      score: { home: 0, away: 7 },
      fdLive: { period: 1, clockSeconds: 492, down: 2, distance: 7 },
      live: { period: 1, clockSeconds: 541, down: 1, distance: 10 },
    })).toBe(true);
  });
});

describe('applyFdAheadLive', () => {
  it('leaves a manual spot alone even when FanDuel looks ahead', () => {
    const game = {
      inPlay: true,
      teams: { home: 'Florida State', away: 'SMU' },
      live: {
        spotSource: 'manual',
        period: 3,
        down: 2,
        distance: 7,
        yardsToEndzone: 40,
        fdAheadOfEspn: true,
        fd: {
          period: 3,
          clockSeconds: 120,
          down: 1,
          distance: 10,
          yardsToEndzone: 75,
        },
      },
    };
    const out = applyFdAheadLive(game);
    expect(out.live.spotSource).toBe('manual');
    expect(out.live.down).toBe(2);
    expect(out.live.yardsToEndzone).toBe(40);
  });
});
