import {
  buildCornersGameSnapshot,
  findLongestCornerBaseline,
  pickHeadlineCornerPlay,
} from './gameSnapshot';
import { evaluateGameCorners } from './cornerModel';

describe('corners game snapshot', () => {
  const game = {
    eventId: 'c1',
    name: 'Arsenal v Chelsea',
    teams: { home: 'Arsenal', away: 'Chelsea' },
    inPlay: false,
    scoreDisplay: '0-0',
    cornersSoFar: 0,
    total: {
      line: 10.5,
      over: { american: -110 },
      under: { american: -110 },
    },
    dk: {
      total: {
        line: 11.5,
        over: { american: -105 },
        under: { american: -115 },
      },
    },
    next5: {
      minutes: 5,
      plus: [{ n: 1, american: 240 }],
      overUnder: [],
    },
  };

  it('picks the longest posted total as the baseline', () => {
    const longest = findLongestCornerBaseline(game);
    expect(longest.book).toBe('dk');
    expect(longest.line).toBe(11.5);
  });

  it('snapshots the highest-edge window play vs that line', () => {
    const snap = buildCornersGameSnapshot(game, { bucketed: true });
    const model = evaluateGameCorners(game, { bucketed: true, baselineBook: 'dk' });
    const play = pickHeadlineCornerPlay(model);

    expect(snap.market).toBe('5′ 1+');
    expect(snap.oddsAmerican).toBe(240);
    expect(snap.lineLabel).toMatch(/^DK 11\.5/);
    expect(snap.score).toBe('0-0');
    expect(snap.edgePoints).toBeCloseTo(play.analysis.edgePoints, 5);
  });
});
