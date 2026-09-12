jest.mock('../utils/database', () => ({
  updatePlayers: jest.fn(),
  readCurrentWeekPlayersSnapshot: jest.fn(),
  readPlayersSnapshot: jest.fn(),
}));

import {
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
  it('treats an O injury tag as out', () => {
    expect(playerIsRuledOut('x', { x: 'Out' }, {}, null)).toBe(true);
    expect(playerIsRuledOut('x', { x: 'Questionable' }, {}, null)).toBe(false);
  });
});
