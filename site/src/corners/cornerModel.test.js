import {
  CORNER_BINS,
  MEAN_CORNERS_PER_MATCH,
  TYPICAL_FT_STOPPAGE_MIN,
  TYPICAL_MATCH_MINUTES,
  evaluateGameCorners,
  parseClockState,
  stoppagePlan,
  windowRemainingShare,
} from './cornerModel';

function liveClock(clock, extras = {}) {
  return parseClockState({ status: 'in', period: 2, clock, ...extras });
}

function ftPlan(clock) {
  return stoppagePlan(clock, { status: 'in', period: 2, clock: clock.inStoppage ? `${clock.elapsed}'+${clock.plus}'` : `${clock.elapsed}'` });
}

describe('FanDuel 5/10-min windows do not pay added time', () => {
  const lateWindow = { window: '85:00-89:59', minutes: 5 };

  it('does not dump 90+ into 85:00–89:59 (the 12.26% bug)', () => {
    const clock = liveClock("81'");
    const win = windowRemainingShare(lateWindow, clock, ftPlan(clock), 'bucketed');
    const bin8690 = CORNER_BINS.find((b) => b.id === '86-90');
    const bin90 = CORNER_BINS.find((b) => b.id === '90+');
    const regularOnly = bin8690.share * ((89 + 59 / 60 - 85) / 5);

    expect(win.includeFt).toBe(false);
    expect(win.bits.some((b) => b.id === '90+' || b.extra)).toBe(false);
    expect(win.histWindowShare).toBeCloseTo(regularOnly, 5);
    expect(win.histWindowShare).toBeCloseTo(0.04845, 3);
    expect(win.histWindowShare).toBeLessThan(0.06);
    expect(regularOnly + bin90.share).toBeCloseTo(0.1226, 3);
    expect(win.uniformWindowShare).toBeCloseTo((4 + 59 / 60) / TYPICAL_MATCH_MINUTES, 5);
    expect(win.uniformWindowShare).not.toBeCloseTo(
      (4 + 59 / 60 + TYPICAL_FT_STOPPAGE_MIN) / TYPICAL_MATCH_MINUTES,
      3,
    );
  });

  it('gives 40:00–44:59 only regular first-half minutes, not 45+', () => {
    const clock = parseClockState({ status: 'in', period: 1, clock: "38'" });
    const win = windowRemainingShare(
      { window: '40:00-44:59' },
      clock,
      stoppagePlan(clock, { status: 'in', period: 1, clock: "38'" }),
      'bucketed',
    );
    const bin4145 = CORNER_BINS.find((b) => b.id === '41-45');
    expect(win.bits.some((b) => b.id === '45+' || b.extra)).toBe(false);
    expect(win.histWindowShare).toBeCloseTo(bin4145.share * ((44 + 59 / 60 - 40) / 5), 5);
    expect(win.minutes).toBeCloseTo(4 + 59 / 60, 5);
  });

  it('is already dead once the half is in added time', () => {
    const clock = liveClock("90'+2'", { inStoppage: true, plus: 2, elapsed: 90 });
    const win = windowRemainingShare(lateWindow, clock, ftPlan(clock), 'bucketed');
    expect(win.minutes).toBe(0);
    expect(win.remainingShare).toBe(0);
    expect(win.bits).toEqual([]);
  });

  it('prices Tottenham-at-81 1+ from regular 85–90 only', () => {
    const game = {
      inPlay: true,
      cornersSoFar: 8,
      stoppage: { status: 'in', period: 2, clock: "81'" },
      total: {
        line: 9.5,
        over: { american: -108 },
        under: { american: -122 },
      },
      next5: {
        window: '85:00-89:59',
        minutes: 5,
        startSeconds: 85 * 60,
        endSeconds: 89 * 60 + 59,
        plus: [{ n: 1, american: 135 }],
      },
    };
    const model = evaluateGameCorners(game, { bucketed: true });
    const plus = model.bets.find((b) => b.kind === 'next5-plus' && b.label === '1+');
    expect(model.next5.win.histWindowShare).toBeLessThan(0.06);
    expect(model.next5.win.bits.some((b) => b.id === '90+')).toBe(false);
    expect(model.next5.lambda).toBeLessThan(1);
    expect(plus.pModel).toBeLessThan(0.55);
    expect(plus.pModel).toBeCloseTo(1 - Math.exp(-model.next5.lambda), 5);
    expect(MEAN_CORNERS_PER_MATCH).toBeGreaterThan(10);
  });
});
