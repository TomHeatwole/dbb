import { extractDkContracts, extractFdContracts, mergeContracts, shouldSkipMarketName } from './extractMarkets';
import { attachDeepMarkets, applyDeepAttachments, extraRowsForDisplay } from './mergeDeep';
import { formatMarketLabel, parsePeriod, parseStat, peopleMatch, resolvePeriod, teamSubject } from './marketNormalize';
import { buildGameMarkets } from './rawArbModel';
import { isBareTeamName } from './teamMatch';
import { formatSidesForRow, pairContract, pairSpreads, pairTotals, pairYesNo } from './twoWayPairs';

describe('market normalize', () => {
  it('reads quarter / half periods including qtr shorthand', () => {
    expect(parsePeriod('1st Quarter Total Points')).toBe('1q');
    expect(parsePeriod('Daniel Jones - 2nd Qtr Passing Yds')).toBe('2q');
    expect(parsePeriod('1st Half Spread')).toBe('1h');
    expect(parsePeriod('4th-quarter')).toBe('4q');
    expect(parsePeriod('Moneyline')).toBe('fg');
  });

  it('maps player and game stats', () => {
    expect(parseStat('Marcus Mariota - Passing Yds')).toBe('pass_yds');
    expect(parseStat('Pass Yards O/U')).toBe('pass_yds');
    expect(parseStat('Both Teams to Score 10+ Points')).toBe('btts_10');
    expect(parseStat('Race To 15')).toBe('race_15');
    expect(parseStat('Will There Be Overtime?')).toBe('overtime');
  });

  it('matches people on last name + first initial', () => {
    expect(peopleMatch('Marcus Mariota', 'M. Mariota')).toBe(true);
    expect(peopleMatch('Daniel Jones', 'Daniel Jones Jr')).toBe(false);
    expect(peopleMatch('Tyler Warren', 'Tyler Boyd')).toBe(false);
  });

  it('labels period extras', () => {
    expect(formatMarketLabel('1q|total|points|game')).toBe('1Q O/U');
    expect(formatMarketLabel('fg|player_ou|pass_yds|Marcus Mariota')).toBe('Marcus Mariota Pass yds');
    expect(resolvePeriod('Total', '1st Quarter')).toBe('1q');
    expect(resolvePeriod('1st Half Total', 'popular')).toBe('1h');
  });

  it('does not invent a team subject from leftover words', () => {
    const teams = { away: 'Indianapolis Colts', home: 'Washington Commanders' };
    expect(teamSubject('1st Half Total Touchdowns', teams)).toBe(null);
    expect(teamSubject('WAS Commanders', teams)).toBe('Washington Commanders');
  });
});

describe('extract + skip', () => {
  it('skips multi-way and yes-only scorer lists', () => {
    expect(shouldSkipMarketName('Winning Margin (4-Way)')).toBe(true);
    expect(shouldSkipMarketName('Anytime TD Scorer')).toBe(true);
    expect(shouldSkipMarketName('Special Teams to Score a TD')).toBe(true);
    expect(shouldSkipMarketName('Race To 30')).toBe(true);
    expect(shouldSkipMarketName('1st Quarter Total')).toBe(false);
    expect(isBareTeamName('Los Angeles Rams Defense', 'Los Angeles Rams')).toBe(false);
    expect(isBareTeamName('LA Rams', 'Los Angeles Rams')).toBe(true);
  });

  it('extracts FD quarter totals, team alts, and player O/U', () => {
    const teams = { away: 'Indianapolis Colts', home: 'Washington Commanders' };
    const rows = extractFdContracts({
      a: {
        marketName: '1st Quarter Total Points',
        runners: [
          { runnerName: 'Over', handicap: 10.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -110 } } },
          { runnerName: 'Under', handicap: 10.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -110 } } },
        ],
      },
      b: {
        marketName: 'WAS Commanders Alternate Total',
        runners: [
          { runnerName: 'Over 22.5', handicap: 22.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -115 } } },
          { runnerName: 'Under 22.5', handicap: 22.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -105 } } },
        ],
      },
      c: {
        marketName: 'Marcus Mariota - Passing Yds',
        runners: [
          { runnerName: 'Over', handicap: 214.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -112 } } },
          { runnerName: 'Under', handicap: 214.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -108 } } },
        ],
      },
    }, teams);
    const keys = rows.map((row) => row.key);
    expect(keys).toContain('1q|total|points|game');
    expect(keys.some((key) => key.startsWith('fg|team_total|points|'))).toBe(true);
    expect(keys).toContain('fg|player_ou|pass_yds|Marcus Mariota');
    const hinted = extractFdContracts({
      q: {
        marketName: 'Total Points',
        _tab: '1st-quarter',
        runners: [
          { runnerName: 'Over', handicap: 10.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -110 } } },
          { runnerName: 'Under', handicap: 10.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -110 } } },
        ],
      },
    }, teams);
    expect(hinted.map((row) => row.key)).toContain('1q|total|points|game');
    const defense = extractFdContracts({
      d: {
        marketName: '2nd Quarter Winner',
        _tab: '2nd-quarter',
        runners: [
          { runnerName: 'Los Angeles Rams Defense', winRunnerOdds: { americanDisplayOdds: { americanOdds: 2200 } } },
          { runnerName: 'Philadelphia Eagles', winRunnerOdds: { americanDisplayOdds: { americanOdds: 130 } } },
        ],
      },
    }, { away: 'Los Angeles Rams', home: 'Philadelphia Eagles' });
    expect(defense.some((row) => row.kind === 'moneyline')).toBe(false);
  });

  it('pairs FD and DK player props when names differ slightly', () => {
    const fd = extractFdContracts({
      a: {
        marketName: 'Marcus Mariota - Passing Yds',
        runners: [
          { runnerName: 'Over', handicap: 214.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: 100 } } },
          { runnerName: 'Under', handicap: 214.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -120 } } },
        ],
      },
    });
    const dk = extractDkContracts(
      [{ id: 1, name: 'Pass Yards O/U', eventId: 9 }],
      [
        { marketId: 1, label: 'Over', outcomeType: 'Over', points: 214.5, displayOdds: { american: '-115' }, participants: [{ name: 'M. Mariota' }] },
        { marketId: 1, label: 'Under', outcomeType: 'Under', points: 214.5, displayOdds: { american: '-105' }, participants: [{ name: 'M. Mariota' }] },
      ],
    );
    const merged = mergeContracts(fd, dk);
    expect(merged).toHaveLength(1);
    expect(merged[0].fd.over.american).toBe(100);
    expect(merged[0].dk.under.american).toBe(-105);
  });
});

describe('two-way pairing', () => {
  it('keeps complementary alt-spread middles and drops gaps', () => {
    const { best } = pairSpreads(
      {
        aways: [{ american: -110, line: -3.5, label: 'Away' }, { american: 100, line: -2.5, label: 'Away' }],
        homes: [{ american: -110, line: 3.5, label: 'Home' }],
      },
      {
        aways: [{ american: -118, line: -3, label: 'Away' }],
        homes: [{ american: -102, line: 3, label: 'Home' }, { american: -110, line: 2.5, label: 'Home' }],
      },
    );
    expect(best.lineFit).toBe('middle');
    expect(best.legs.some((leg) => leg.line === -2.5 || leg.line === 3.5)).toBe(true);
  });

  it('pairs yes/no and player totals', () => {
    const ot = pairYesNo(
      { yes: { american: 240, label: 'Yes' }, no: { american: -300, label: 'No' } },
      { yes: { american: 260, label: 'Yes' }, no: { american: -320, label: 'No' } },
    );
    expect(ot.legs.map((leg) => `${leg.book}:${leg.side}`).sort().join()).toMatch(/fd|dk/);
    const { best } = pairTotals(
      { overs: [{ american: 105, line: 214.5, label: 'Over' }] },
      { unders: [{ american: -110, line: 214.5, label: 'Under' }] },
    );
    expect(best.lineFit).toBe('lock');
    const paired = pairContract('yesno', { odd: { american: -110 }, even: { american: -110 } }, { odd: { american: -105 }, even: { american: -115 } });
    expect(paired.best).toBeTruthy();
    const wide = pairTotals(
      { overs: [{ american: 1200, line: 7.5, label: 'Over' }] },
      { unders: [{ american: -120, line: 9.5, label: 'Under' }] },
    );
    expect(wide.best).toBe(null);
  });

  it('prints the two-way price, not another quote at the same line', () => {
    const twoWay = {
      legs: [
        { book: 'fd', side: 'under', line: 1.5, american: 176 },
        { book: 'dk', side: 'over', line: 1.5, american: 143 },
      ],
    };
    const fd = formatSidesForRow(
      { under: { american: -230, line: 1.5 }, unders: [{ american: -230, line: 1.5 }, { american: 176, line: 1.5 }] },
      'player_ou',
      twoWay,
      'fd',
    );
    const dk = formatSidesForRow(
      { over: { american: 143, line: 1.5 } },
      'player_ou',
      twoWay,
      'dk',
    );
    expect(fd.right).toMatch(/\+176/);
    expect(fd.left).toBe('—');
    expect(dk.left).toMatch(/\+143/);
    expect(dk.right).toBe('—');
  });
});

describe('deep merge + display', () => {
  const game = buildGameMarkets({
    sport: 'nfl',
    home: 'Washington Commanders',
    away: 'Indianapolis Colts',
    fdEventId: 'fd-1',
    dkEventId: 'dk-1',
    moneyline: {
      fd: { away: { american: 110 }, home: { american: -130 } },
      dk: { away: { american: -120 }, home: { american: 115 } },
    },
    spread: {
      fd: { away: { american: -110, line: 3.5 }, home: { american: -110, line: -3.5 } },
      dk: { away: { american: -110, line: 3.5 }, home: { american: -110, line: -3.5 } },
    },
    total: {
      fd: { over: { american: -110, line: 48.5 }, under: { american: -110, line: 48.5 } },
      dk: { over: { american: -110, line: 48.5 }, under: { american: -110, line: 48.5 } },
    },
  });

  it('promotes extra arbs and leaves other two-ways in the dropdown', () => {
    const scored = attachDeepMarkets(game, [
      {
        key: '1q|total|points|game',
        label: '1st Quarter Total',
        kind: 'total',
        fd: { over: { american: 130, line: 9.5 }, under: { american: -160, line: 9.5 } },
      },
      {
        key: 'fg|yesno|overtime|game',
        label: 'Overtime',
        kind: 'yesno',
        fd: { yes: { american: 240 }, no: { american: -300 } },
      },
    ], [
      {
        key: '1q|total|points|game',
        label: 'Total 1st Quarter',
        kind: 'total',
        dk: { over: { american: -150, line: 9.5 }, under: { american: 140, line: 9.5 } },
      },
      {
        key: 'fg|yesno|overtime|game',
        label: 'Overtime',
        kind: 'yesno',
        dk: { yes: { american: 260 }, no: { american: -320 } },
      },
    ]);
    expect(scored.extraArbCount).toBeGreaterThan(0);
    expect(scored.bestPSum).toBeLessThan(game.bestPSum);
    const { promoted, rest } = extraRowsForDisplay(scored);
    expect(promoted.some((row) => row.key === '1q|total|points|game')).toBe(true);
    expect(rest.some((row) => row.key === 'fg|yesno|overtime|game') || promoted.some((row) => row.key.includes('overtime'))).toBe(true);
  });

  it('re-applies attachments onto a fresh mains payload', () => {
    const attached = applyDeepAttachments([game], [{
      fdEventId: 'fd-1',
      extras: [{
        key: '1q|total|points|game',
        label: '1Q O/U',
        kind: 'total',
        main: false,
        twoWay: { pSum: 0.97, hasArb: true, legs: [] },
      }],
      extraCount: 1,
      extraArbCount: 1,
      extraBestPSum: 0.97,
    }]);
    expect(attached[0].bestPSum).toBeCloseTo(Math.min(game.bestPSum, 0.97), 8);
    expect(attached[0].deepLoaded).toBe(true);
    expect(extraRowsForDisplay(attached[0]).promoted).toHaveLength(1);
  });

  it('does not pin a second full-game ML column', () => {
    const { promoted, rest } = extraRowsForDisplay({
      ...game,
      extras: [{
        key: 'fg|moneyline|points|game',
        label: 'ML',
        kind: 'moneyline',
        main: false,
        twoWay: { pSum: 0.88, hasArb: true, legs: [] },
      }],
    });
    expect(promoted).toHaveLength(0);
    expect(rest).toHaveLength(0);
  });
});
