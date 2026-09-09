import {
  buildFinalStandings,
  normalizePlayoffFormat,
  PLAYOFF_FORMAT_BRACKET,
  PLAYOFF_FORMAT_CUMULATIVE,
} from './playoffStandings';

function places(standings) {
  return standings
    .slice()
    .sort((a, b) => a.place - b.place)
    .map((row) => row.rosterId);
}

describe('normalizePlayoffFormat', () => {
  it('treats 2025 as bracket and anything else as cumulative', () => {
    expect(normalizePlayoffFormat('bracket')).toBe(PLAYOFF_FORMAT_BRACKET);
    expect(normalizePlayoffFormat('2025')).toBe(PLAYOFF_FORMAT_BRACKET);
    expect(normalizePlayoffFormat('cumulative')).toBe(PLAYOFF_FORMAT_CUMULATIVE);
    expect(normalizePlayoffFormat(undefined)).toBe(PLAYOFF_FORMAT_CUMULATIVE);
  });
});

describe('buildFinalStandings cumulative', () => {
  it('seeds top 4 by regular season and ranks them by playoff total', () => {
    const standings = buildFinalStandings(
      { 1: 1400, 2: 1300, 3: 1200, 4: 1100, 5: 1000 },
      { 1: 200, 2: 350, 3: 300, 4: 100, 5: 400 },
    );
    expect(places(standings)).toEqual([2, 3, 1, 4, 5]);
    expect(standings.find((r) => r.rosterId === 2).isPlayoff).toBe(true);
    expect(standings.find((r) => r.rosterId === 5).isPlayoff).toBe(false);
    expect(standings.find((r) => r.rosterId === 5).place).toBe(5);
  });
});

describe('buildFinalStandings 2025 bracket', () => {
  const reg = { 1: 1600, 2: 1500, 3: 1400, 4: 1300, 5: 900, 6: 800 };

  it('makes the final winner #1 and the other finalist #2 even if they scored fewer playoff points', () => {
    // Semis: 1 (220) beats 4 (180); 3 (210) beats 2 (190).
    // Final: seed 1 scores 80, seed 3 scores 140. Buffer is (220-210)/2 = 5 to seed 1.
    // Championship: 85 vs 140 — seed 3 wins the title.
    // Seed 4 has the highest cumulative playoff total (400) but lost the semi, so 3rd/4th only.
    const standings = buildFinalStandings(
      reg,
      { 1: 300, 2: 250, 3: 350, 4: 400, 5: 10, 6: 10 },
      {
        format: PLAYOFF_FORMAT_BRACKET,
        playoffWeekTotals: {
          1: [110, 110, 80],
          2: [90, 100, 60],
          3: [100, 110, 140],
          4: [90, 90, 220],
        },
      },
    );

    expect(places(standings).slice(0, 4)).toEqual([3, 1, 4, 2]);
    expect(standings.find((r) => r.rosterId === 3).place).toBe(1);
    expect(standings.find((r) => r.rosterId === 1).place).toBe(2);
  });

  it('applies the semis buffer so a close final can flip #1', () => {
    // Semis: 1 (300) beats 4 (200); 2 (210) beats 3 (200).
    // Buffer = 45 to seed 1. Week 17: seed 1 scores 80, seed 2 scores 120.
    // Championship: 125 vs 120 — seed 1 wins despite a lower week-17 score.
    const standings = buildFinalStandings(
      reg,
      { 1: 380, 2: 330, 3: 250, 4: 260 },
      {
        format: PLAYOFF_FORMAT_BRACKET,
        playoffWeekTotals: {
          1: [150, 150, 80],
          2: [100, 110, 120],
          3: [100, 100, 50],
          4: [100, 100, 60],
        },
      },
    );

    expect(standings.find((r) => r.rosterId === 1).place).toBe(1);
    expect(standings.find((r) => r.rosterId === 2).place).toBe(2);
  });

  it('ranks 3rd and 4th by cumulative playoff score among semi losers', () => {
    // Semis: 1 beats 4, 2 beats 3. Seed 4 outscores seed 3 over 15–17.
    const standings = buildFinalStandings(
      reg,
      { 1: 300, 2: 290, 3: 200, 4: 260 },
      {
        format: PLAYOFF_FORMAT_BRACKET,
        playoffWeekTotals: {
          1: [110, 110, 80],
          2: [100, 100, 90],
          3: [90, 90, 20],
          4: [100, 80, 80],
        },
      },
    );

    expect(places(standings).slice(0, 4)).toEqual([1, 2, 4, 3]);
  });

  it('breaks tied semis with the better seed', () => {
    const standings = buildFinalStandings(
      reg,
      { 1: 300, 2: 300, 3: 200, 4: 200 },
      {
        format: PLAYOFF_FORMAT_BRACKET,
        playoffWeekTotals: {
          1: [100, 100, 100],
          2: [100, 100, 80],
          3: [100, 100, 0],
          4: [100, 100, 0],
        },
      },
    );

    expect(places(standings).slice(0, 2)).toEqual([1, 2]);
  });

  it('falls back to cumulative ranking when weekly playoff scores are missing', () => {
    const standings = buildFinalStandings(
      { 1: 1400, 2: 1300, 3: 1200, 4: 1100 },
      { 1: 200, 2: 350, 3: 300, 4: 100 },
      { format: PLAYOFF_FORMAT_BRACKET },
    );
    expect(places(standings)).toEqual([2, 3, 1, 4]);
  });
});
