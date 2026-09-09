/**
 * Playoff placement for scenario eval and the season simulator.
 *
 * cumulative (2024): top 4 by regular-season total, then ranked by weeks 15–17.
 * bracket (2025): 1v4 and 2v3 over weeks 15–16; championship is week 17 plus
 * half the semis scoring gap. #1 is the final winner, #2 the other finalist.
 * 3rd/4th use cumulative playoff score among the two semifinal losers.
 */

export const PLAYOFF_FORMAT_CUMULATIVE = 'cumulative';
export const PLAYOFF_FORMAT_BRACKET = 'bracket';
export const DEFAULT_PLAYOFF_FORMAT = PLAYOFF_FORMAT_CUMULATIVE;

export const PLAYOFF_FORMATS = {
  [PLAYOFF_FORMAT_CUMULATIVE]: {
    label: 'Cumulative',
    description: '2024 rules: playoff teams ranked by total points in weeks 15–17.',
  },
  [PLAYOFF_FORMAT_BRACKET]: {
    label: '2025 Bracket',
    description:
      '2025 /yoffs rules: 1v4 and 2v3 over weeks 15–16. The final is week 17 plus half the semis gap. #1 is the final winner, #2 the other finalist. 3rd/4th by cumulative playoff score.',
  },
};

export function normalizePlayoffFormat(value) {
  if (value === PLAYOFF_FORMAT_BRACKET || value === '2025') {
    return PLAYOFF_FORMAT_BRACKET;
  }
  return PLAYOFF_FORMAT_CUMULATIVE;
}

function roundTenth(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function lookupTotal(map, rid) {
  if (!map) return 0;
  const direct = map[rid];
  if (direct != null) return Number(direct) || 0;
  return Number(map[String(rid)]) || 0;
}

function playoffWeekScore(playoffWeekTotals, rid, weekOffset) {
  if (!playoffWeekTotals) return 0;
  const weeks = playoffWeekTotals[rid] || playoffWeekTotals[String(rid)];
  return Number(weeks?.[weekOffset]) || 0;
}

function semiScore(playoffWeekTotals, rid) {
  return playoffWeekScore(playoffWeekTotals, rid, 0)
    + playoffWeekScore(playoffWeekTotals, rid, 1);
}

function finalsWeekScore(playoffWeekTotals, rid) {
  return playoffWeekScore(playoffWeekTotals, rid, 2);
}

function winnerByScore(a, b, scoreA, scoreB) {
  if (scoreA > scoreB) return a;
  if (scoreB > scoreA) return b;
  return (a.seed || 999) < (b.seed || 999) ? a : b;
}

function buildRows(regSeasonTotals, playoffTotals) {
  return Object.keys(regSeasonTotals || {}).map((rid) => ({
    rosterId: Number(rid),
    regSeasonTotal: Number(regSeasonTotals[rid]) || 0,
    playoffTotal: lookupTotal(playoffTotals, rid),
  }));
}

function rankBottomSix(byRegSeason) {
  return byRegSeason.slice(4).map((row, i) => ({
    ...row,
    place: 5 + i,
    isPlayoff: false,
  }));
}

function buildCumulativeStandings(regSeasonTotals, playoffTotals) {
  const byRegSeason = buildRows(regSeasonTotals, playoffTotals)
    .slice()
    .sort((a, b) => b.regSeasonTotal - a.regSeasonTotal);

  const top4 = byRegSeason.slice(0, 4)
    .sort((a, b) => b.playoffTotal - a.playoffTotal)
    .map((row, i) => ({ ...row, place: i + 1, isPlayoff: true }));

  return [...top4, ...rankBottomSix(byRegSeason)];
}

function buildBracketStandings(regSeasonTotals, playoffTotals, playoffWeekTotals) {
  if (!playoffWeekTotals) {
    return buildCumulativeStandings(regSeasonTotals, playoffTotals);
  }

  const byRegSeason = buildRows(regSeasonTotals, playoffTotals)
    .slice()
    .sort((a, b) => b.regSeasonTotal - a.regSeasonTotal);

  const seeded = byRegSeason.slice(0, 4).map((row, i) => ({ ...row, seed: i + 1 }));
  const bottom6 = rankBottomSix(byRegSeason);

  if (seeded.length === 0) return bottom6;

  const seed1 = seeded[0];
  const seed2 = seeded[1] || null;
  const seed3 = seeded[2] || null;
  const seed4 = seeded[3] || null;

  const topWinner = seed4
    ? winnerByScore(
      seed1,
      seed4,
      semiScore(playoffWeekTotals, seed1.rosterId),
      semiScore(playoffWeekTotals, seed4.rosterId),
    )
    : seed1;
  const topLoser = seed4 && topWinner.rosterId === seed1.rosterId ? seed4 : (seed4 ? seed1 : null);

  const bottomWinner = seed3
    ? winnerByScore(
      seed2,
      seed3,
      semiScore(playoffWeekTotals, seed2.rosterId),
      semiScore(playoffWeekTotals, seed3.rosterId),
    )
    : seed2;
  const bottomLoser = seed3 && bottomWinner.rosterId === seed2.rosterId
    ? seed3
    : (seed3 ? seed2 : null);

  const finalists = [topWinner, bottomWinner].filter(Boolean);
  let champion = finalists[0];
  let runnerUp = finalists[1] || null;

  if (finalists.length === 2) {
    const topSemi = semiScore(playoffWeekTotals, topWinner.rosterId);
    const bottomSemi = semiScore(playoffWeekTotals, bottomWinner.rosterId);
    const buffer = topSemi > bottomSemi
      ? (topSemi - bottomSemi) / 2
      : bottomSemi > topSemi
        ? (bottomSemi - topSemi) / 2
        : 0;

    let topFinal = finalsWeekScore(playoffWeekTotals, topWinner.rosterId);
    let bottomFinal = finalsWeekScore(playoffWeekTotals, bottomWinner.rosterId);
    if (topSemi > bottomSemi) topFinal += buffer;
    else if (bottomSemi > topSemi) bottomFinal += buffer;

    champion = winnerByScore(
      topWinner,
      bottomWinner,
      roundTenth(topFinal),
      roundTenth(bottomFinal),
    );
    runnerUp = champion.rosterId === topWinner.rosterId ? bottomWinner : topWinner;
  }

  const consolation = [topLoser, bottomLoser].filter(Boolean).sort((a, b) => {
    if (b.playoffTotal !== a.playoffTotal) return b.playoffTotal - a.playoffTotal;
    return (a.seed || 999) - (b.seed || 999);
  });

  const rankedTop = [champion, runnerUp, ...consolation]
    .filter(Boolean)
    .map((row, i) => ({
      rosterId: row.rosterId,
      regSeasonTotal: row.regSeasonTotal,
      playoffTotal: row.playoffTotal,
      place: i + 1,
      isPlayoff: true,
    }));

  return [...rankedTop, ...bottom6];
}

/**
 * Build final standings matching the standings /yoffs rules.
 *   - Seed top 4 by 14-week total
 *   - Rank top 4 by the selected playoff format
 *   - Rank bottom 6 by 14-week total
 *
 * @param {Object} regSeasonTotals
 * @param {Object} playoffTotals
 * @param {{ format?: string, playoffWeekTotals?: Object }} [options]
 * @returns {Array<{ rosterId, place, isPlayoff, regSeasonTotal, playoffTotal }>}
 */
export function buildFinalStandings(regSeasonTotals, playoffTotals, options = {}) {
  const format = normalizePlayoffFormat(options?.format);
  if (format === PLAYOFF_FORMAT_BRACKET) {
    return buildBracketStandings(
      regSeasonTotals,
      playoffTotals,
      options.playoffWeekTotals,
    );
  }
  return buildCumulativeStandings(regSeasonTotals, playoffTotals);
}
