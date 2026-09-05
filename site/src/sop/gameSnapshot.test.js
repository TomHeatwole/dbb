import { analyzeAgainstBreakeven, computeBreakevenOdds } from './sopModel';
import { buildSopGameSnapshot, buildSopMonitorRows, isActiveMonitorGame, shortGameName } from './gameSnapshot';

describe('SOP game snapshot', () => {
  it('shortens Premier League names', () => {
    expect(shortGameName({
      name: 'Manchester United v Brighton & Hove Albion',
      teams: { home: 'Manchester United', away: 'Brighton & Hove Albion' },
    })).toBe('Man Utd v Brighton');
  });

  it('uses the longest no-goal line for SOP edge', () => {
    const game = {
      eventId: 'e1',
      name: 'Arsenal v Chelsea',
      teams: { home: 'Arsenal', away: 'Chelsea' },
      inPlay: true,
      scoreDisplay: '1-0',
      espn: { status: 'in', clock: "34'" },
      noGoalMarkets: {
        totalGoalsUnder: { american: 250, line: 2.5, selection: 'Under 2.5' },
        correctScore: { american: 400, scoreUsed: '1-0' },
      },
      dk: {
        noGoalMarkets: {
          totalGoalsUnder: { american: 500, line: 2.5 },
        },
      },
      goalTypes: { sop: { american: 120 } },
    };

    const snap = buildSopGameSnapshot(game);
    const expectedBe = computeBreakevenOdds(500).sop.american;
    const expectedEdge = analyzeAgainstBreakeven(120, expectedBe).edgePoints;

    expect(snap.market).toBe('SOP');
    expect(snap.oddsBook).toBe('fd');
    expect(snap.oddsAmerican).toBe(120);
    expect(snap.lineLabel).toBe('DK U2.5 +500');
    expect(snap.edgePoints).toBeCloseTo(expectedEdge, 5);
    expect(snap.clock).toBe("34'");
    expect(snap.profitable).toBe(expectedEdge > 0);
  });

  it('keeps live and soon kickoffs in the monitor', () => {
    const now = Date.parse('2026-09-05T14:30:00.000Z');
    expect(isActiveMonitorGame({ inPlay: true }, now)).toBe(true);
    expect(isActiveMonitorGame({ openDate: '2026-09-05T16:30:00.000Z' }, now)).toBe(true);
    expect(isActiveMonitorGame({ openDate: '2026-09-12T14:00:00.000Z' }, now)).toBe(false);
    expect(buildSopMonitorRows([
      { eventId: 'live', inPlay: true, name: 'A v B', teams: { home: 'A', away: 'B' } },
      { eventId: 'later', openDate: '2026-09-12T14:00:00.000Z', name: 'C v D', teams: { home: 'C', away: 'D' } },
    ], now).map((row) => row.eventId)).toEqual(['live']);
  });
});
