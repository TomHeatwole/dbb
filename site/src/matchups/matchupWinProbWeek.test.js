import { resolveMatchupWinProbWeek, sumRange } from './matchupWinProbWeek';

describe('resolveMatchupWinProbWeek', () => {
  it('uses the current NFL week when it is in the matchup', () => {
    expect(resolveMatchupWinProbWeek([15, 16, 17], 16)).toBe(16);
  });

  it('uses the first remaining playoff week before the window starts', () => {
    expect(resolveMatchupWinProbWeek([15, 16, 17], 11)).toBe(15);
  });

  it('returns null once every matchup week is in the past', () => {
    expect(resolveMatchupWinProbWeek([15, 16], 17)).toBe(null);
  });
});

describe('sumRange', () => {
  it('sums inclusive weeks that have totals', () => {
    expect(sumRange({ 15: 10, 16: 20, 17: 30 }, 15, 16)).toBe(30);
  });
});
