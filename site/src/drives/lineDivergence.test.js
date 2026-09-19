import {
  applyLineDivergenceFilter,
  computeLineDivergence,
  describeLineDivergence,
  lineDivergenceForGame,
  pointsScored,
} from './lineDivergence';

describe('lineDivergence', () => {
  it('computes remaining gap as live total minus pregame total', () => {
    const div = computeLineDivergence({
      liveTotal: 58,
      pregameTotal: 52,
      pointsScored: 45,
      liveSpread: -10.5,
      pregameSpread: -3.5,
      inPlay: true,
    });
    expect(div.totalMove).toBe(6);
    expect(div.impliedRemainingLive).toBe(13);
    expect(div.impliedRemainingPregame).toBe(7);
    expect(div.remainingGap).toBe(6);
    expect(div.filterActive).toBe(false);
  });

  it('flags live games when the total moved beyond the threshold', () => {
    const div = computeLineDivergence({
      liveTotal: 62,
      pregameTotal: 52,
      pointsScored: 21,
      liveSpread: -7,
      pregameSpread: -3,
      inPlay: true,
      totalMoveFilterPts: 7,
    });
    expect(div.filterActive).toBe(true);
    expect(div.filterReason).toBe('total');
  });

  it('does not filter pregame cards even if lines differ', () => {
    const div = computeLineDivergence({
      liveTotal: 62,
      pregameTotal: 52,
      pointsScored: 0,
      liveSpread: -10,
      pregameSpread: -3,
      inPlay: false,
      totalMoveFilterPts: 7,
    });
    expect(div.filterActive).toBe(false);
  });

  it('reads game lines and pregame snapshot', () => {
    const game = {
      inPlay: true,
      score: { home: 21, away: 14 },
      teams: { home: 'Texas', away: 'Texas State' },
      lines: {
        spread: {
          runners: [
            { runnerName: 'Texas', handicap: -10.5 },
            { runnerName: 'Texas State', handicap: 10.5 },
          ],
        },
        total: {
          runners: [{ runnerName: 'Over', handicap: 58.5 }],
        },
      },
      pregameLines: {
        spread: -3.5,
        total: 52.5,
        capturedAt: '2026-09-18T20:00:00.000Z',
      },
    };
    expect(pointsScored(game)).toBe(35);
    const div = lineDivergenceForGame(game, { totalMoveFilterPts: 5 });
    expect(div.liveTotal).toBe(58.5);
    expect(div.pregameTotal).toBe(52.5);
    expect(div.filterActive).toBe(true);
  });

  it('suppresses profitable rows when the filter is active', () => {
    const filtered = applyLineDivergenceFilter({
      rows: [
        { key: 'td', profitable: true, edgePoints: 8.2, kellyStake: 25 },
        { key: 'punt', profitable: false, edgePoints: -2.1, kellyStake: null },
      ],
      evCount: 1,
    }, {
      filterActive: true,
      filterReason: 'total',
      totalMove: 9,
      pregameTotal: 52,
      liveTotal: 61,
    });
    expect(filtered.lineFilterActive).toBe(true);
    expect(filtered.evCount).toBe(0);
    expect(filtered.rows[0].profitable).toBe(false);
    expect(filtered.rows[0].lineFiltered).toBe(true);
    expect(filtered.rows[0].preFilterEdgePoints).toBe(8.2);
    expect(filtered.rows[0].kellyStake).toBeNull();
  });

  it('describes an active filter in plain language', () => {
    const msg = describeLineDivergence({
      hasPregameSnapshot: true,
      filterActive: true,
      filterReason: 'total',
      totalMove: 9,
      liveTotal: 61,
      pregameTotal: 52,
    });
    expect(msg).toMatch(/total moved \+9/);
    expect(msg).toMatch(/\+EV flagged off/);
  });
});
