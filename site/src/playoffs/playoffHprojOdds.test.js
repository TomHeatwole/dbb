import {
  maskByes,
  resolveWeekProjection,
  sampleQuantile,
  simulatePlayoffField,
  sumBankedPoints,
} from './playoffHprojOdds';

describe('sumBankedPoints', () => {
  const weeks = [
    [{ roster_id: 1, points: 100.2 }, { roster_id: 2, points: 90 }],
    [{ roster_id: 1, points: 10 }],
    null,
  ];

  it('sums completed weeks and ignores a missing week', () => {
    expect(sumBankedPoints(weeks, 1, 2)).toBe(110.2);
    expect(sumBankedPoints(weeks, 2, 2)).toBe(90);
    expect(sumBankedPoints(weeks, 1, 0)).toBe(0);
  });
});

describe('resolveWeekProjection', () => {
  const rosterIds = ['a', 'b', 'c'];

  it('keeps a bye player on the baseline for a later week', () => {
    const week1 = resolveWeekProjection({
      rawMap: { a: 10, b: 12, c: 8 },
      baseline: { b: 15 },
      labels: { b: { text: 'BYE' } },
      rosterIds,
      minUsable: 2,
    });
    expect(week1.source).toBe('projection');
    expect(week1.map).toEqual({ a: 10, c: 8 });
    expect(week1.baseline.b).toBe(15);
    expect(week1.baseline.a).toBe(10);

    const week2 = resolveWeekProjection({
      rawMap: { a: 1 },
      baseline: week1.baseline,
      labels: { a: { text: 'BYE' } },
      opponents: { c: 'BYE' },
      rosterIds,
      minUsable: 2,
    });
    expect(week2.source).toBe('carried');
    expect(week2.baseline).toBe(week1.baseline);
    expect(week2.map.a).toBeUndefined();
    expect(week2.map.c).toBeUndefined();
    expect(week2.map.b).toBe(15);

    const week3 = resolveWeekProjection({
      rawMap: {},
      baseline: week2.baseline,
      rosterIds,
      minUsable: 2,
    });
    expect(week3.map).toEqual({ a: 10, b: 15, c: 8 });
  });

  it('drops an opponent listed as BYE', () => {
    expect(maskByes({ a: 9, b: 4 }, { opponents: { a: 'bye' } })).toEqual({ b: 4 });
  });
});

describe('simulatePlayoffField', () => {
  it('reads a nearest-rank quantile', () => {
    expect(sampleQuantile([0, 10, 20, 30], 0.5)).toBe(20);
    expect(sampleQuantile([0, 10, 20, 30], 0)).toBe(0);
  });

  it('gives a banked lead the playoff spot', () => {
    const field = simulatePlayoffField([
      { id: 'a', pointsSoFar: 100, weeks: [{ samples: [0, 0, 0] }] },
      { id: 'b', pointsSoFar: 90, weeks: [{ samples: [5, 5, 5] }] },
    ], { iterations: 200, spots: 1, seed: 'lead' });
    const a = field.rows.find((row) => row.id === 'a');
    const b = field.rows.find((row) => row.id === 'b');
    expect(a.playoffPct).toBe(100);
    expect(b.playoffPct).toBe(0);
    expect(a.medianPath).toBe(100);
    expect(b.medianPath).toBe(95);
  });

  it('lets a hotter remaining week leapfrog points so far', () => {
    const field = simulatePlayoffField([
      { id: 'a', pointsSoFar: 100, weeks: [{ samples: [0] }] },
      { id: 'b', pointsSoFar: 90, weeks: [{ samples: [20] }] },
    ], { iterations: 50, spots: 1, seed: 'leap' });
    expect(field.rows[0].id).toBe('b');
    expect(field.rows[0].playoffPct).toBe(100);
    expect(field.rows[0].p50).toBe(110);
  });

  it('splits an exact tie at the cut', () => {
    const field = simulatePlayoffField([
      { id: 'a', pointsSoFar: 0, weeks: [{ samples: [100] }] },
      { id: 'b', pointsSoFar: 0, weeks: [{ samples: [100] }] },
    ], { iterations: 4000, spots: 1, seed: 'tie' });
    for (const row of field.rows) {
      expect(row.playoffPct).toBeGreaterThan(45);
      expect(row.playoffPct).toBeLessThan(55);
    }
    expect(field.rows[0].playoffPct + field.rows[1].playoffPct).toBeCloseTo(100, 5);
  });

  it('keeps the bottom team out when two others are always ahead', () => {
    const field = simulatePlayoffField([
      { id: 'a', pointsSoFar: 0, weeks: [{ samples: [10] }] },
      { id: 'b', pointsSoFar: 0, weeks: [{ samples: [10] }] },
      { id: 'c', pointsSoFar: 0, weeks: [{ samples: [0] }] },
    ], { iterations: 100, spots: 2, seed: 'cut' });
    const byId = Object.fromEntries(field.rows.map((row) => [row.id, row.playoffPct]));
    expect(byId.a).toBe(100);
    expect(byId.b).toBe(100);
    expect(byId.c).toBe(0);
    expect(field.cutP50).toBe(10);
  });

  it('awards title by cumulative playoff weeks', () => {
    const three = (value) => [{ samples: [value] }, { samples: [value] }, { samples: [value] }];
    const field = simulatePlayoffField([
      { id: 1, pointsSoFar: 100, weeks: [], playoffWeeks: three(10) },
      { id: 2, pointsSoFar: 90, weeks: [], playoffWeeks: three(50) },
      { id: 3, pointsSoFar: 80, weeks: [], playoffWeeks: three(5) },
      { id: 4, pointsSoFar: 70, weeks: [], playoffWeeks: three(5) },
    ], { iterations: 200, spots: 4, format: 'cumulative', seed: 'title' });
    const b = field.rows.find((row) => row.id === 2);
    const a = field.rows.find((row) => row.id === 1);
    expect(b.winPct).toBeGreaterThan(95);
    expect(a.winPct).toBeLessThan(5);
  });

  it('computes win odds conditional on making the playoffs', () => {
    const three = (value) => [{ samples: [value] }, { samples: [value] }, { samples: [value] }];
    const field = simulatePlayoffField([
      { id: 1, pointsSoFar: 100, weeks: [], playoffWeeks: three(10) },
      { id: 2, pointsSoFar: 90, weeks: [], playoffWeeks: three(50) },
      { id: 3, pointsSoFar: 80, weeks: [], playoffWeeks: three(5) },
      { id: 4, pointsSoFar: 70, weeks: [], playoffWeeks: three(5) },
      { id: 5, pointsSoFar: 0, weeks: [{ samples: [200] }], playoffWeeks: three(99) },
    ], { iterations: 400, spots: 4, format: 'cumulative', seed: 'if-made' });
    const five = field.rows.find((row) => row.id === 5);
    expect(five.playoffPct).toBeGreaterThan(0);
    expect(five.winPct).toBeGreaterThan(0);
    expect(five.winPctIfMade).toBeGreaterThanOrEqual(five.winPct);
    expect(five.winPctIfMade).toBeLessThanOrEqual(100);
    const lock = simulatePlayoffField([
      { id: 1, pointsSoFar: 100, weeks: [], playoffWeeks: three(10) },
      { id: 2, pointsSoFar: 90, weeks: [], playoffWeeks: three(50) },
      { id: 3, pointsSoFar: 80, weeks: [], playoffWeeks: three(5) },
      { id: 4, pointsSoFar: 70, weeks: [], playoffWeeks: three(5) },
    ], {
      iterations: 400,
      spots: 4,
      format: 'cumulative',
      seed: 'if-made',
      lockedPlayoffIds: [1, 2, 3, 4],
    });
    expect(lock.fieldMatches).toBe(400);
    expect(lock.fieldMatchPct).toBe(100);
    const winner = lock.rows.find((row) => row.id === 2);
    expect(winner.winPctGivenField).toBeGreaterThan(90);
  });

  it('gives title odds among a chosen four even when they rarely finish top four', () => {
    const three = (value) => [{ samples: [value] }, { samples: [value] }, { samples: [value] }];
    const field = simulatePlayoffField([
      { id: 1, pointsSoFar: 100, weeks: [], playoffWeeks: three(10) },
      { id: 2, pointsSoFar: 90, weeks: [], playoffWeeks: three(50) },
      { id: 3, pointsSoFar: 80, weeks: [], playoffWeeks: three(5) },
      { id: 4, pointsSoFar: 70, weeks: [], playoffWeeks: three(5) },
      { id: 5, pointsSoFar: 200, weeks: [{ samples: [0] }], playoffWeeks: three(99) },
    ], {
      iterations: 400,
      spots: 4,
      format: 'cumulative',
      seed: 'chosen-four',
      lockedPlayoffIds: [1, 2, 3, 4],
    });
    expect(field.fieldMatchPct).toBe(0);
    const among = field.rows.filter((row) => [1, 2, 3, 4].includes(row.id));
    const titleSum = among.reduce((sum, row) => sum + row.winPctGivenField, 0);
    expect(titleSum).toBeGreaterThan(99);
    expect(titleSum).toBeLessThanOrEqual(100.5);
    const winner = among.find((row) => row.id === 2);
    expect(winner.winPctGivenField).toBeGreaterThan(50);
  });
});
