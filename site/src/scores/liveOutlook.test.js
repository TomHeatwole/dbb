jest.mock('../utils/database', () => ({
  updatePlayers: jest.fn(),
  readCurrentWeekPlayersSnapshot: jest.fn(),
  readPlayersSnapshot: jest.fn(),
}));

import {
  collectOutPlayerIds,
  displayActualPts,
  espnLiveProjection,
  nflTimeRemainingFrac,
  playerIsRuledOut,
  scaledLiveOutcome,
  simulatedLockedPts,
} from './liveOutlook';

describe('nflTimeRemainingFrac', () => {
  it('is 1 at the opening kickoff', () => {
    expect(nflTimeRemainingFrac(1, '15:00')).toBeCloseTo(1, 5);
  });

  it('is about 64% left at Q2 8:21', () => {
    expect(nflTimeRemainingFrac(2, '8:21')).toBeCloseTo(0.6392, 3);
  });

  it('is 0 at the end of regulation', () => {
    expect(nflTimeRemainingFrac(4, '0:00')).toBe(0);
  });
});

describe('week-1-done actuals', () => {
  it('keeps the Sleeper score instead of copying the projection', () => {
    const label = { completed: true, simulated: true };
    expect(simulatedLockedPts(label, 21.2)).toBe(null);
    expect(displayActualPts({ pts: 6.4 }, label, 21.2)).toBe(6.4);
    expect(displayActualPts({ pts: 0 }, label, 17.4)).toBe(0);
  });
});

describe('ESPN live outlook', () => {
  it('adds current score plus remaining-time share of the pregame proj', () => {
    expect(espnLiveProjection(8, 16, 0.5)).toBe(16);
    expect(espnLiveProjection(10, 20, 0.25)).toBe(15);
  });

  it('scales a rolled pregame outcome the same way', () => {
    expect(scaledLiveOutcome(8, 30, 0.5)).toBe(23);
  });
});

describe('playerIsRuledOut', () => {
  it('treats an O or IR injury tag as done for remaining projection', () => {
    expect(playerIsRuledOut('x', { x: 'Out' }, {}, null)).toBe(true);
    expect(playerIsRuledOut('x', { x: 'IR' }, {}, null)).toBe(true);
    expect(playerIsRuledOut('x', { x: 'Injured Reserve' }, {}, null)).toBe(true);
    expect(playerIsRuledOut('x', { x: 'Questionable' }, {}, null)).toBe(false);
  });
});

describe('collectOutPlayerIds', () => {
  const playersData = { hurt: { injury_status: 'Out' }, pup: { injury_status: 'PUP' } };

  it('locks current-week Out players', () => {
    const ids = collectOutPlayerIds(['hurt', 'pup'], {}, playersData, null);
    expect(ids.has('hurt')).toBe(true);
    expect(ids.has('pup')).toBe(false);
  });

  it('skips a future week when that player has a projection', () => {
    const ids = collectOutPlayerIds(['hurt'], {}, playersData, null, {
      futureWeek: true,
      projectedPtsById: { hurt: 14.2 },
    });
    expect(ids.has('hurt')).toBe(false);
  });

  it('still locks a future-week Out player with no projection', () => {
    const ids = collectOutPlayerIds(['hurt'], { hurt: 'IR' }, {}, null, {
      futureWeek: true,
      projectedPtsById: { other: 8 },
    });
    expect(ids.has('hurt')).toBe(true);
  });
});
