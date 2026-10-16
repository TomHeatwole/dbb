import { evaluateMultiWayArb, scoreThreeMlMultiWay } from './multiWayArb';

describe('evaluateMultiWayArb', () => {
  it('sums best implied per outcome', () => {
    const hit = evaluateMultiWayArb(['away', 'draw', 'home'], [
      {
        id: 'fd',
        quote: {
          away: { american: 200 },
          draw: { american: 250 },
          home: { american: 180 },
        },
      },
      {
        id: 'dk',
        quote: {
          away: { american: 220 },
          draw: { american: 230 },
          home: { american: 170 },
        },
      },
    ]);
    expect(hit).toBeTruthy();
    expect(hit.outcomes).toBe(3);
    expect(hit.legs).toHaveLength(3);
    expect(hit.pSum).toBeGreaterThan(0);
    expect(hit.legs.find((l) => l.outcomeKey === 'draw')?.book).toBe('fd');
  });
});

describe('scoreThreeMlMultiWay', () => {
  it('requires draw on at least one book', () => {
    expect(scoreThreeMlMultiWay({
      fd: { away: { american: -110 }, home: { american: -110 } },
      dk: { away: { american: -105 }, home: { american: -115 } },
    }, ['fd', 'dk'])).toBeNull();
  });
});
