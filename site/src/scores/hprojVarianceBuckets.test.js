import { hprojQuantile } from './hprojVarianceBuckets';

describe('hprojQuantile', () => {
  it('treats integer 1 as P1, not the P99 ceiling', () => {
    const proj = 19.5;
    const p1 = hprojQuantile('QB', proj, 1);
    const p50 = hprojQuantile('QB', proj, 50);
    const p99 = hprojQuantile('QB', proj, 99);
    expect(p1).toBe(0);
    expect(p1).toBeLessThan(p50);
    expect(p50).toBeLessThan(p99);
    expect(p99).toBeGreaterThan(proj);
    expect(hprojQuantile('QB', proj, 0.01)).toBe(p1);
  });
});
