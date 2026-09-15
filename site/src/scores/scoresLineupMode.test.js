import { resolveScoresLineupMode } from './scoresLineupMode';
import { CURRENT_YEAR } from '../utils/DateHelper';

jest.mock('../utils/DateHelper', () => ({
  CURRENT_YEAR: 2026,
  getCurrentNFLWeek: () => 5,
}));

describe('resolveScoresLineupMode', () => {
  it('forces projections for future weeks in the current season', () => {
    const result = resolveScoresLineupMode({
      season: CURRENT_YEAR,
      week: 6,
      isWeekCompleteByGames: false,
      lineupMode: 'scores',
    });
    expect(result.effectiveMode).toBe('projections');
    expect(result.showLineupModeToggle).toBe(false);
  });

  it('forces scores for past weeks in the current season', () => {
    const result = resolveScoresLineupMode({
      season: CURRENT_YEAR,
      week: 4,
      isWeekCompleteByGames: false,
      lineupMode: 'projections',
    });
    expect(result.effectiveMode).toBe('scores');
    expect(result.showLineupModeToggle).toBe(false);
  });

  it('forces scores when the active week is complete', () => {
    const result = resolveScoresLineupMode({
      season: CURRENT_YEAR,
      week: 5,
      isWeekCompleteByGames: true,
      lineupMode: 'projections',
    });
    expect(result.effectiveMode).toBe('scores');
    expect(result.showLineupModeToggle).toBe(false);
  });

  it('shows the toggle and respects user choice on the active week', () => {
    const scores = resolveScoresLineupMode({
      season: CURRENT_YEAR,
      week: 5,
      isWeekCompleteByGames: false,
      lineupMode: 'scores',
    });
    expect(scores.effectiveMode).toBe('scores');
    expect(scores.showLineupModeToggle).toBe(true);

    const proj = resolveScoresLineupMode({
      season: CURRENT_YEAR,
      week: 5,
      isWeekCompleteByGames: false,
      lineupMode: 'projections',
    });
    expect(proj.effectiveMode).toBe('projections');
    expect(proj.showLineupModeToggle).toBe(true);
  });

  it('forces scores for prior seasons', () => {
    const result = resolveScoresLineupMode({
      season: 2024,
      week: 10,
      isWeekCompleteByGames: false,
      lineupMode: 'projections',
    });
    expect(result.effectiveMode).toBe('scores');
    expect(result.showLineupModeToggle).toBe(false);
  });
});
