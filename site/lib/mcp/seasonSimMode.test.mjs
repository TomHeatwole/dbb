import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simModeFromClock } from './seasonContext.mjs';
import { loadRosRankMap } from './simData.mjs';
import { prepareSimContext, runSeasonSim } from './simEngine.mjs';

test('preseason clock keeps the full-season ADP sim', () => {
  assert.deepEqual(simModeFromClock({ seasonStarted: false, completedWeeks: 0 }), {
    mode: 'preseason',
    lockedWeekCount: 0,
  });
});

test('after kickoff the odds tool is the ROS sim, with finished weeks locked', () => {
  assert.deepEqual(simModeFromClock({ seasonStarted: true, completedWeeks: 0 }), {
    mode: 'ros',
    lockedWeekCount: 0,
  });
  assert.deepEqual(simModeFromClock({ seasonStarted: true, completedWeeks: 5 }), {
    mode: 'ros',
    lockedWeekCount: 5,
  });
  assert.deepEqual(simModeFromClock({ seasonStarted: true, completedWeeks: 17 }), {
    mode: 'ros',
    lockedWeekCount: 14,
  });
});

test('ROS board tags Josh Allen as QB1', () => {
  const ranks = loadRosRankMap();
  assert.equal(ranks['4984'].position, 'QB');
  assert.equal(ranks['4984'].posRank, 1);
});

test('locked team weeks stay the real scores and later weeks still roll', () => {
  const ctx = prepareSimContext({
    scenarioRosters: { 1: ['p1'], 2: ['p2'] },
    hwangAdpRankMap: {},
    catalog: [],
    positionMaxRanks: {},
    basePointsByYear: {},
    playersData: {},
    lockedWeekCount: 2,
    lockedTeamWeekPoints: [
      { 1: 100, 2: 40 },
      { 1: 80, 2: 30 },
      { 1: 999, 2: 999 },
    ],
  });
  const { results } = runSeasonSim(ctx, 20);
  const byId = Object.fromEntries(results.map((row) => [row.rosterId, row]));
  assert.equal(byId[1].avgRegSeason, 180);
  assert.equal(byId[2].avgRegSeason, 70);
});
