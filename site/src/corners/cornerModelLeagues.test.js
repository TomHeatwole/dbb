import { buildCornerLeagueModel, CORNER_LEAGUE_SPECS } from './cornerModelLeagues.mjs';

describe('cornerModelLeagues', () => {
  it('builds MLS shares that sum to 1', () => {
    const model = buildCornerLeagueModel(CORNER_LEAGUE_SPECS.mls);
    const sum = model.bins.reduce((s, b) => s + b.share, 0);
    expect(sum).toBeCloseTo(1, 8);
    expect(model.meanCornersPerMatch).toBeCloseTo(9.774, 2);
  });
});
