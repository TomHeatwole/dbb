import { americanToImpliedProb, computeBreakevenOdds } from './sopModel';
import { buildSopPaperSnapshot, sopSituationKey } from './paperSnapshots';

function arsenalGame(extra = {}) {
  return {
    eventId: 'e1',
    name: 'Arsenal v Chelsea',
    teams: { home: 'Arsenal', away: 'Chelsea' },
    openDate: '2026-10-16T19:00:00Z',
    inPlay: false,
    score: { home: 0, away: 0 },
    scoreDisplay: '0-0',
    noGoalMarkets: {
      totalGoalsUnder: { american: 250, line: 2.5, selection: 'Under 2.5' },
      nextGoalMethod: { american: 1100, selection: 'No Goal' },
    },
    goalTypes: { sop: { american: 120 }, header: { american: 500 } },
    ...extra,
  };
}

describe('SOP paper snapshots', () => {
  it('records model and live probabilities plus every displayed no-goal line', () => {
    const row = buildSopPaperSnapshot(arsenalGame(), { capturedAt: new Date('2026-10-16T12:00:00Z') });
    expect(row.phase).toBe('pregame');
    expect(row.payload.fd_ng_totalGoalsUnder).toBe(250);
    expect(row.payload.fd_ng_nextGoalMethod).toBe(1100);
    expect(row.payload.fd_sop).toBe(120);
    expect(row.payload.longest_ng_american).toBe(1100);
    const model = computeBreakevenOdds(1100);
    expect(row.payload.model_no_goal_p).toBeCloseTo(model.noGoalProb, 8);
    expect(row.payload.model_goal_p).toBeCloseTo(model.goalProb, 8);
    expect(row.payload.live_sop_p).toBeCloseTo(americanToImpliedProb(120), 8);
    expect(row.payload.model_sop_p).toBeCloseTo(model.sop.implied / 100, 8);
  });

  it('does not change fingerprint when only the clock ticks', () => {
    const pre = buildSopPaperSnapshot(arsenalGame({
      inPlay: true,
      score: { home: 1, away: 0 },
      scoreDisplay: '1-0',
      espn: { status: 'in', clock: "34'" },
    }));
    const later = buildSopPaperSnapshot(arsenalGame({
      inPlay: true,
      score: { home: 1, away: 0 },
      scoreDisplay: '1-0',
      espn: { status: 'in', clock: "35'" },
    }));
    expect(sopSituationKey(arsenalGame({ inPlay: true, score: { home: 1, away: 0 } }))).toBe('live:1-0');
    expect(pre.oddsFingerprint).toBe(later.oddsFingerprint);
    expect(pre.payload.clock).toBe("34'");
    expect(later.payload.clock).toBe("35'");
  });

  it('opens a new snapshot when the score or odds change', () => {
    const live = buildSopPaperSnapshot(arsenalGame({
      inPlay: true,
      score: { home: 0, away: 0 },
    }));
    const scored = buildSopPaperSnapshot(arsenalGame({
      inPlay: true,
      score: { home: 1, away: 0 },
      scoreDisplay: '1-0',
    }));
    const moved = buildSopPaperSnapshot(arsenalGame({
      inPlay: true,
      score: { home: 0, away: 0 },
      noGoalMarkets: {
        totalGoalsUnder: { american: 280, line: 2.5 },
        nextGoalMethod: { american: 1100 },
      },
    }));
    expect(live.oddsFingerprint).not.toBe(scored.oddsFingerprint);
    expect(live.oddsFingerprint).not.toBe(moved.oddsFingerprint);
  });

  it('copies latest pregame lines onto a live row', () => {
    const pregame = buildSopPaperSnapshot(arsenalGame());
    const live = buildSopPaperSnapshot(arsenalGame({
      inPlay: true,
      score: { home: 0, away: 0 },
      espn: { status: 'in', clock: "12'" },
    }), { pregame: pregame.payload });
    expect(live.payload.pregame_longest_ng_american).toBe(1100);
    expect(live.payload.pregame_fd_sop).toBe(120);
    expect(live.payload.pregame_json).toContain('"fd_sop":120');
  });
});
