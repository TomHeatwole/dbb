import { winProbHeat } from './matchupWinProbColor';

function channel(css, i) {
  const m = css.match(/rgb\((\d+), (\d+), (\d+)\)/);
  return Number(m[i + 1]);
}

describe('winProbHeat', () => {
  it('is gold at 50 and greener as the favorite grows', () => {
    const mid = winProbHeat(50);
    const high = winProbHeat(81);
    const higher = winProbHeat(95);
    expect(channel(mid.css, 0)).toBeGreaterThan(240);
    expect(channel(mid.css, 1)).toBeGreaterThan(200);
    expect(channel(high.css, 0)).toBeLessThan(channel(mid.css, 0));
    expect(channel(higher.css, 0)).toBeLessThan(channel(high.css, 0));
    expect(channel(higher.css, 1)).toBeGreaterThan(channel(higher.css, 0) + 80);
  });

  it('turns redder as the underdog shrinks', () => {
    const mid = winProbHeat(50);
    const low = winProbHeat(19);
    const lower = winProbHeat(5);
    expect(channel(low.css, 0)).toBeGreaterThan(channel(low.css, 1));
    expect(channel(lower.css, 1)).toBeLessThan(channel(low.css, 1));
    expect(channel(lower.css, 0)).toBeGreaterThan(200);
    expect(channel(mid.css, 1)).toBeGreaterThan(channel(low.css, 1));
  });
});
