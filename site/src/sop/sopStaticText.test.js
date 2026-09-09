import { analyzeAgainstBreakeven, computeBreakevenOdds, computeKellyFraction } from './sopModel';
import {
  collectProfitableSopEdges,
  formatNoGoalProxy,
  formatSopStaticText,
} from './sopStaticText';

describe('SOP static text', () => {
  const liveGame = {
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
    goalTypes: {
      sop: { american: 120 },
      header: { american: 900 },
    },
  };

  it('uses the longest no-goal proxy and lists only profitable edges', () => {
    const row = collectProfitableSopEdges(liveGame);
    const sopBe = computeBreakevenOdds(500).sop;
    const headerBe = computeBreakevenOdds(500).header;
    const sopEdge = analyzeAgainstBreakeven(120, sopBe.american).edgePoints;
    const headerEdge = analyzeAgainstBreakeven(900, headerBe.american).edgePoints;

    expect(row.noGoal.label).toBe('DK Total Goals Under U 2.5 +500');
    expect(row.edges.map((e) => e.market).sort()).toEqual(['HEADER', 'SOP']);
    expect(row.edges[0].edgePoints).toBeGreaterThanOrEqual(row.edges[1].edgePoints);

    const sopRow = row.edges.find((e) => e.market === 'SOP');
    const headerRow = row.edges.find((e) => e.market === 'HEADER');
    expect(sopRow.edgePoints).toBeCloseTo(sopEdge, 5);
    expect(headerRow.edgePoints).toBeCloseTo(headerEdge, 5);
    expect(sopRow.kellyFraction).toBeCloseTo(
      computeKellyFraction(sopBe.implied / 100, 120),
      5,
    );
  });

  it('omits games with no +EV', () => {
    const row = collectProfitableSopEdges({
      ...liveGame,
      noGoalMarkets: { totalGoalsUnder: { american: 110, line: 2.5 } },
      dk: { noGoalMarkets: { totalGoalsUnder: { american: 100, line: 2.5 } } },
      goalTypes: { sop: { american: -200 }, header: { american: 400 } },
    });
    expect(row).toBeNull();
  });

  it('formats a scrapeable dump and skips empty games', () => {
    const text = formatSopStaticText({
      fetchedAt: '2026-09-08T15:00:00.000Z',
      games: [
        liveGame,
        {
          eventId: 'e2',
          name: 'Liverpool v Everton',
          inPlay: false,
          noGoalMarkets: { totalGoalsUnder: { american: 200, line: 2.5 } },
          goalTypes: { sop: { american: -150 } },
        },
      ],
    });

    expect(text).toContain('fetched 2026-09-08T15:00:00.000Z');
    expect(text).toContain('Arsenal v Chelsea  1-0  LIVE  34\'');
    expect(text).toContain('no-goal: DK Total Goals Under U 2.5 +500');
    expect(text).toContain('edge +');
    expect(text).toContain('kelly ');
    expect(text).not.toContain('Liverpool');
  });

  it('says when nothing is +EV', () => {
    const text = formatSopStaticText({ games: [], fetchedAt: '2026-09-08T15:00:00.000Z' });
    expect(text).toContain('No profitable edges.');
  });

  it('labels a correct-score proxy', () => {
    expect(formatNoGoalProxy('correctScore', 'fd', { scoreUsed: '1-0' }, 400)).toBe(
      'FD Correct Score 1-0 +400',
    );
  });
});
