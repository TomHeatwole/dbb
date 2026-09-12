jest.mock('../utils/database', () => ({
  updatePlayers: jest.fn(),
  readCurrentWeekPlayersSnapshot: jest.fn(),
  readPlayersSnapshot: jest.fn(),
}));

import { hprojPercentile, hprojQuantile } from './hprojVarianceBuckets';
import {
  formatMatchupWinPcts,
  hprojMatchupWinProb,
  liveScaleFromInProgressGames,
  lockedPtsFromCompletedGames,
  simulateTeamHproj,
  weekHasCompletedGames,
  weekHasStartedGames,
} from './hprojTeamSim';

describe('hprojPercentile', () => {
  it('inverts a quantile on the projection band', () => {
    const proj = 22;
    const atP10 = hprojQuantile('QB', proj, 10);
    const atP80 = hprojQuantile('QB', proj, 80);
    expect(hprojPercentile('QB', proj, atP10)).toBeGreaterThanOrEqual(8);
    expect(hprojPercentile('QB', proj, atP10)).toBeLessThanOrEqual(12);
    expect(hprojPercentile('QB', proj, atP80)).toBeGreaterThanOrEqual(78);
    expect(hprojPercentile('QB', proj, atP80)).toBeLessThanOrEqual(82);
    expect(hprojPercentile('QB', proj, 0)).toBe(0);
  });
});

describe('live HProj locks', () => {
  it('locks only Final games', () => {
    const locked = lockedPtsFromCompletedGames(
      {
        starters: [{ id: 'maye', pts: 9.8 }, { id: 'javonte', pts: 0 }],
        bench: [{ id: 'stafford', pts: 4.1 }],
      },
      {
        maye: { completed: true, live: false },
        javonte: { completed: false, live: false },
        stafford: { completed: true, live: false },
      }
    );
    expect(locked).toEqual({ maye: 9.8, stafford: 4.1 });
    expect(weekHasCompletedGames({
      maye: { completed: true },
      javonte: { completed: false },
    })).toBe(true);
    expect(weekHasCompletedGames({
      javonte: { completed: false, live: true },
    })).toBe(false);
    expect(weekHasStartedGames({
      javonte: { completed: false, live: true },
    })).toBe(true);
  });

  it('locks Out players at their current score', () => {
    const locked = lockedPtsFromCompletedGames(
      { starters: [{ id: 'hurt', pts: 6.4 }], bench: [] },
      { hurt: { live: true, completed: false, timeRemainingFrac: 0.6 } },
      { outPlayerIds: new Set(['hurt']) },
    );
    expect(locked).toEqual({ hurt: 6.4 });
  });

  it('scales a live draw as actual + rolled pregame × time left', () => {
    const live = simulateTeamHproj({
      playerIds: ['star', 'backup'],
      projectedPtsById: { star: 20, backup: 14 },
      playerPositions: { star: 'QB', backup: 'QB' },
      liveScaleById: { star: { actual: 8, timeFrac: 0.5 } },
      iterations: 80,
      seed: 'live-scale',
      keepLineups: true,
    });
    expect(live.naiveTotal).toBe(32);
    const pts = live.sims.map((row) => row.weekPts.star);
    expect(Math.min(...pts)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...pts)).toBeLessThan(8 + 20 * 2.2 * 0.5 + 1);
    expect(live.sims[0].starters.find((s) => s.id === 'star').live).toBe(true);
  });

  it('reads live scale from in-progress labels', () => {
    const scale = liveScaleFromInProgressGames(
      { starters: [{ id: 'star', pts: 9 }], bench: [] },
      { star: { live: true, completed: false, timeRemainingFrac: 0.4 } },
      { projectedPtsById: { star: 15 } },
    );
    expect(scale.star).toEqual({ actual: 9, timeFrac: 0.4 });
  });

  it('skips Out players when building live scale', () => {
    const scale = liveScaleFromInProgressGames(
      { starters: [{ id: 'hurt', pts: 6.4 }], bench: [] },
      { hurt: { live: true, completed: false, timeRemainingFrac: 0.6 } },
      { projectedPtsById: { hurt: 18 }, outPlayerIds: new Set(['hurt']) },
    );
    expect(scale).toEqual({});
  });

  it('replaces a boom projection with the finished actual', () => {
    const ids = ['star', 'backup'];
    const positions = { star: 'QB', backup: 'QB' };
    const projected = { star: 22, backup: 14 };
    const open = simulateTeamHproj({
      playerIds: ids,
      projectedPtsById: projected,
      playerPositions: positions,
      iterations: 400,
      seed: 'lock-open',
    });
    const live = simulateTeamHproj({
      playerIds: ids,
      projectedPtsById: projected,
      playerPositions: positions,
      lockedPtsById: { star: 3.2 },
      iterations: 400,
      seed: 'lock-live',
    });
    expect(open.p50.total).toBeGreaterThan(16);
    expect(live.p50.total).toBeLessThan(open.p50.total);
    expect(live.naiveTotal).toBe(17.2);
  });

  it('labels locked starters with a finished-game percentile', () => {
    const live = simulateTeamHproj({
      playerIds: ['star', 'backup'],
      projectedPtsById: { star: 22, backup: 14 },
      playerPositions: { star: 'QB', backup: 'QB' },
      lockedPtsById: { star: 3.2 },
      iterations: 20,
      seed: 'lock-pct',
      keepLineups: true,
    });
    const starter = live.sims[0].starters.find((s) => s.id === 'star');
    expect(starter.locked).toBe(true);
    expect(starter.pts).toBe(3.2);
    expect(starter.playerPct).toBeGreaterThanOrEqual(0);
    expect(starter.playerPct).toBeLessThan(20);
    expect(live.sims[0].playerPct.star).toBe(starter.playerPct);
  });
});

describe('hprojMatchupWinProb', () => {
  it('splits identical ranges 50 / 50', () => {
    const totals = [80, 90, 100, 110, 120];
    expect(hprojMatchupWinProb(totals, totals)).toEqual({
      leftPct: 50,
      rightPct: 50,
      leftShare: 0.5,
      rightShare: 0.5,
    });
  });

  it('returns 100 / 0 when every left outcome is above every right outcome', () => {
    expect(hprojMatchupWinProb([120, 130], [80, 90])).toEqual({
      leftPct: 100,
      rightPct: 0,
      leftShare: 1,
      rightShare: 0,
    });
  });

  it('counts pairwise outscores and splits ties', () => {
    const result = hprojMatchupWinProb([1, 2, 3], [0, 1, 2]);
    expect(result.leftShare).toBeCloseTo(7 / 9, 8);
    expect(result.rightShare).toBeCloseTo(2 / 9, 8);
    expect(result.leftPct + result.rightPct).toBe(100);
    expect(result.leftPct).toBe(78);
  });

  it('keeps a sliver instead of rounding a live chance to 0%', () => {
    expect(formatMatchupWinPcts(0.002, 0.998)).toEqual({
      leftPct: 1,
      rightPct: 99,
      leftShare: 0.002,
      rightShare: 0.998,
    });
  });

  it('returns sorted totals from simulateTeamHproj', () => {
    const result = simulateTeamHproj({
      playerIds: ['star', 'backup'],
      projectedPtsById: { star: 22, backup: 14 },
      playerPositions: { star: 'QB', backup: 'QB' },
      iterations: 40,
      seed: 'totals',
    });
    expect(result.totals).toHaveLength(40);
    for (let i = 1; i < result.totals.length; i += 1) {
      expect(result.totals[i]).toBeGreaterThanOrEqual(result.totals[i - 1]);
    }
  });
});
