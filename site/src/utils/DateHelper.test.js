jest.mock('./global_constants', () => ({
  SEASON_START_DAY: '09/09',
  CURRENT_WEEK_OVERRIDE: null,
  PREVIOUS_CURRENT_WEEK_OVERRIDE: null,
  PREVIOUS_YEARS: { 2025: true },
  SIMULATE_WEEK1_DONE: false,
}));

jest.mock('./database', () => ({
  readAdminBlob: jest.fn().mockResolvedValue(null),
}));

import {
  getCompletedWeeksCount,
  getCurrentNFLWeek,
  getHomeCardCompletedWeeks,
  isCurrentWeekCompletedByDate,
} from './DateHelper';

describe('DateHelper week completion', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  function atLocal(isoLocal) {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(isoLocal));
  }

  // 2026 season starts Wed Sep 9 (SEASON_START_DAY in global_constants).
  it('does not mark week 2 complete on Monday night while MNF is still playing', () => {
    atLocal('2026-09-21T20:30:00-04:00');
    expect(getCurrentNFLWeek(2026)).toBe(2);
    expect(getCompletedWeeksCount(2026)).toBe(1);
    expect(isCurrentWeekCompletedByDate(2026)).toBe(false);
  });

  it('marks week 2 complete once Tuesday begins after MNF', () => {
    atLocal('2026-09-22T00:30:00-04:00');
    expect(getCurrentNFLWeek(2026)).toBe(2);
    expect(getCompletedWeeksCount(2026)).toBe(2);
    expect(isCurrentWeekCompletedByDate(2026)).toBe(true);
  });

  it('does not mark week 1 complete on Monday night of opening week', () => {
    atLocal('2026-09-14T21:00:00-04:00');
    expect(getCurrentNFLWeek(2026)).toBe(1);
    expect(getCompletedWeeksCount(2026)).toBe(0);
    expect(isCurrentWeekCompletedByDate(2026)).toBe(false);
  });

  it('maps home display week 3 to two completed weeks for cumulative cards', () => {
    atLocal('2026-09-23T16:31:00-04:00');
    expect(getCurrentNFLWeek(2026)).toBe(3);
    expect(getCompletedWeeksCount(2026)).toBe(2);
    expect(getHomeCardCompletedWeeks(2026, 3)).toBe(2);
  });
});
