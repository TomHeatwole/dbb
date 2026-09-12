import { compareLongestLine, compareShortestLine, impliedProbability } from './oddsMath';

describe('line length', () => {
  it('treats higher plus as longer and bigger minus as shorter', () => {
    expect(compareLongestLine(800, 150)).toBeLessThan(0);
    expect(compareLongestLine(150, -110)).toBeLessThan(0);
    expect(compareLongestLine(-110, -400)).toBeLessThan(0);
    expect(compareShortestLine(-400, -110)).toBeLessThan(0);
    expect(compareShortestLine(-110, 150)).toBeLessThan(0);
    expect(impliedProbability(800)).toBeLessThan(impliedProbability(150));
  });
});
