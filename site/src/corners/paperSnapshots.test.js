import { americanToImpliedProb } from '../sop/sopModel';
import {
  buildCornersPaperSnapshot,
  cornersClockBin,
  cornersSituationKey,
} from './paperSnapshots';

function arsenalGame(extra = {}) {
  return {
    eventId: 'c1',
    name: 'Arsenal v Chelsea',
    teams: { home: 'Arsenal', away: 'Chelsea' },
    competition: 'pl',
    openDate: '2026-10-16T19:00:00Z',
    inPlay: false,
    score: { home: 0, away: 0 },
    scoreDisplay: '0-0',
    cornersSoFar: 0,
    total: {
      line: 10.5,
      over: { american: -110 },
      under: { american: -110 },
    },
    dk: {
      total: {
        line: 11.5,
        over: { american: -105 },
        under: { american: -115 },
      },
    },
    next5: {
      minutes: 5,
      plus: [{ n: 1, american: 240 }],
      overUnder: [],
    },
    ...extra,
  };
}

describe('corners paper snapshots', () => {
  it('records totals, remaining, and next-5 model vs live probability', () => {
    const row = buildCornersPaperSnapshot(arsenalGame(), {
      capturedAt: new Date('2026-10-16T12:00:00Z'),
    });
    expect(row.phase).toBe('pregame');
    expect(row.eventId).toBe('pl:c1');
    expect(row.payload.fd_total_line).toBe(10.5);
    expect(row.payload.dk_total_line).toBe(11.5);
    expect(row.payload.next5_1plus_american).toBe(240);
    expect(row.payload.next5_1plus_live_p).toBeCloseTo(americanToImpliedProb(240), 8);
    expect(row.payload.next5_1plus_model_p).toEqual(expect.any(Number));
    expect(row.payload.model_remaining).toEqual(expect.any(Number));
  });

  it('does not change fingerprint when only the clock ticks inside a 5-minute bin', () => {
    const a = buildCornersPaperSnapshot(arsenalGame({
      inPlay: true,
      cornersSoFar: 4,
      score: { home: 0, away: 0 },
      stoppage: { status: 'in', clock: "12'", elapsed: 12, period: 1 },
    }));
    const b = buildCornersPaperSnapshot(arsenalGame({
      inPlay: true,
      cornersSoFar: 4,
      score: { home: 0, away: 0 },
      stoppage: { status: 'in', clock: "14'", elapsed: 14, period: 1 },
    }));
    expect(cornersClockBin(arsenalGame({
      inPlay: true,
      stoppage: { status: 'in', clock: "12'", elapsed: 12, period: 1 },
    }))).toBe('10-15');
    expect(a.oddsFingerprint).toBe(b.oddsFingerprint);
  });

  it('opens a new snapshot when corners-so-far, minute bin, or odds change', () => {
    const live = buildCornersPaperSnapshot(arsenalGame({
      inPlay: true,
      cornersSoFar: 4,
      stoppage: { status: 'in', clock: "12'", elapsed: 12, period: 1 },
    }));
    const moreCorners = buildCornersPaperSnapshot(arsenalGame({
      inPlay: true,
      cornersSoFar: 5,
      stoppage: { status: 'in', clock: "12'", elapsed: 12, period: 1 },
    }));
    const laterBin = buildCornersPaperSnapshot(arsenalGame({
      inPlay: true,
      cornersSoFar: 4,
      stoppage: { status: 'in', clock: "16'", elapsed: 16, period: 1 },
    }));
    const moved = buildCornersPaperSnapshot(arsenalGame({
      inPlay: true,
      cornersSoFar: 4,
      stoppage: { status: 'in', clock: "12'", elapsed: 12, period: 1 },
      total: { line: 10.5, over: { american: 100 }, under: { american: -130 } },
    }));
    expect(cornersSituationKey(arsenalGame({
      inPlay: true,
      cornersSoFar: 5,
      score: { home: 0, away: 0 },
      stoppage: { status: 'in', elapsed: 12, period: 1 },
    }))).toMatch(/5c/);
    expect(live.oddsFingerprint).not.toBe(moreCorners.oddsFingerprint);
    expect(live.oddsFingerprint).not.toBe(laterBin.oddsFingerprint);
    expect(live.oddsFingerprint).not.toBe(moved.oddsFingerprint);
  });

  it('copies latest pregame totals onto a live row', () => {
    const pregame = buildCornersPaperSnapshot(arsenalGame());
    const live = buildCornersPaperSnapshot(arsenalGame({
      inPlay: true,
      cornersSoFar: 3,
      stoppage: { status: 'in', clock: "22'", elapsed: 22, period: 1 },
    }), { pregame: pregame.payload });
    expect(live.payload.pregame_fd_total_line).toBe(10.5);
    expect(live.payload.pregame_dk_over).toBe(-105);
    expect(live.payload.pregame_json).toContain('"fd_total_line":10.5');
  });
});
