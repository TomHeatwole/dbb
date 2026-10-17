import { extractDkContracts, extractFdContracts, isPlainThreeWayTitle, mergeContracts, shouldSkipMarketName } from './extractMarkets';
import {
  attachDeepMarkets,
  applyDeepAttachments,
  bookSidesSane,
  extraRowsForDisplay,
  fillMainsFromExtras,
  filterCardFaceRows,
  scoreContracts,
  sortCardMarkets,
} from './mergeDeep';
import { formatMarketLabel, parsePeriod, parseStat, peopleMatch, resolvePeriod, teamSubject } from './marketNormalize';
import { buildGameMarkets } from './rawArbModel';
import { isBareTeamName } from './teamMatch';
import { formatSidesForRow, pairContract, pairMoneyline, pairPlayerTotals, pairSpreads, pairTotals, pairYesNo } from './twoWayPairs';

describe('market normalize', () => {
  it('reads quarter / half periods including qtr shorthand', () => {
    expect(parsePeriod('1st Quarter Total Points')).toBe('1q');
    expect(parsePeriod('Daniel Jones - 2nd Qtr Passing Yds')).toBe('2q');
    expect(parsePeriod('1st Half Spread')).toBe('1h');
    expect(parsePeriod('4th-quarter')).toBe('4q');
    expect(parsePeriod('Moneyline')).toBe('fg');
    expect(parsePeriod('Total Goals (60 Min)')).toBe('reg');
    expect(parsePeriod('3-way result: Regular time')).toBe('reg');
    expect(parsePeriod('Alternate Total Goals (Excl OT)')).toBe('reg');
    expect(parsePeriod('Total Goals (Inc. OT/SO)')).toBe('fg');
    expect(parsePeriod('2nd Period Goals')).toBe('2p');
    expect(parsePeriod('CLE Guardians: Team Total Runs - 1st 3 Innings')).toBe('f3');
    expect(parsePeriod('Total Runs - 1st 7 Innings')).toBe('f7');
    expect(parsePeriod('CLE Guardians: Team Total Runs - 1st 5 Innings')).toBe('f5');
    expect(parsePeriod('Runs - 1st Inning')).toBe('1i');
    expect(parsePeriod('Runs - 9th Inning')).toBe('9i');
    expect(parsePeriod('CLE Guardians: Team Total Runs')).toBe('fg');
  });

  it('maps player and game stats', () => {
    expect(parseStat('Marcus Mariota - Passing Yds')).toBe('pass_yds');
    expect(parseStat('Pass Yards O/U')).toBe('pass_yds');
    expect(parseStat('Both Teams to Score 10+ Points')).toBe('btts_10');
    expect(parseStat('Race To 15')).toBe('race_15');
    expect(parseStat('Will There Be Overtime?')).toBe('overtime');
    expect(parseStat('Nick Suzuki - Goals')).toBe('goals');
    expect(parseStat('Sidney Crosby Points')).toBe('player_pts');
    expect(parseStat('Total Goals')).toBe('points');
    expect(parseStat('Total corners')).toBe('corners');
    expect(parseStat('1st half total corners')).toBe('corners');
    expect(parseStat('1st half totals')).toBe('points');
    expect(parseStat('1st half TDs')).toBe('tds');
    expect(parseStat('Passing TDs')).toBe('pass_td');
    expect(parseStat('Anytime TD')).toBe('anytime_td');
    expect(parseStat('Point Spread')).not.toBe('player_pts');
    expect(parseStat('Anytime Goal Scorer')).toBe('goals');
    expect(parseStat('Sidney Crosby - Shots on Goal')).toBe('shots');
    expect(parseStat('Shots on Goal')).toBe('shots');
    expect(parseStat('Player Shots on Goal')).toBe('shots');
  });

  it('matches people on last name + first initial', () => {
    expect(peopleMatch('Marcus Mariota', 'M. Mariota')).toBe(true);
    expect(peopleMatch('Daniel Jones', 'Daniel Jones Jr')).toBe(false);
    expect(peopleMatch('Tyler Warren', 'Tyler Boyd')).toBe(false);
  });

  it('labels period extras', () => {
    expect(formatMarketLabel('1q|total|points|game')).toBe('1Q O/U');
    expect(formatMarketLabel('reg|total|points|game')).toBe('60m O/U');
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
    expect(shouldSkipMarketName('Moneyline (3-way)')).toBe(true);
    expect(shouldSkipMarketName('Half-Time/Full-Time')).toBe(true);
    expect(shouldSkipMarketName('To Win Either Half')).toBe(true);
    expect(shouldSkipMarketName('Both Teams To Score & O/U 2.5 Goals')).toBe(true);
    expect(shouldSkipMarketName('Both Teams To Score')).toBe(false);
    expect(shouldSkipMarketName('Both Teams to Score - Both Halves')).toBe(true);
    expect(shouldSkipMarketName('Both Win Set/Moneyline')).toBe(true);
    expect(shouldSkipMarketName('Anytime Goal Scorer')).toBe(true);
    expect(shouldSkipMarketName('Moneyline - Listed Set')).toBe(true);
    expect(shouldSkipMarketName('1st Quarter Total')).toBe(false);
    expect(shouldSkipMarketName('Borussia Dortmund: Total goals, 15:01 - 30:00')).toBe(true);
    expect(shouldSkipMarketName('Total corners: 00:00 - 15:00')).toBe(true);
    expect(shouldSkipMarketName('Total Up to 30th Minute')).toBe(true);
    expect(shouldSkipMarketName('Goal Scored - Up to 30th Minute')).toBe(true);
    expect(shouldSkipMarketName('Asian Handicap Up to 70th Minute')).toBe(true);
    expect(isPlainThreeWayTitle('Result after 30:00 min')).toBe(false);
    expect(shouldSkipMarketName('Total goals')).toBe(false);
    expect(isBareTeamName('Los Angeles Rams Defense', 'Los Angeles Rams')).toBe(false);
    expect(isBareTeamName('LA Rams', 'Los Angeles Rams')).toBe(true);
  });

  it('does not file DK listed-time totals as the full-game O/U', () => {
    const teams = { home: 'New York Red Bulls', away: 'San Diego FC' };
    expect(extractDkContracts(
      [{ id: 1, name: 'Total Up to 30th Minute', hint: 'Asian Total - Listed Time' }],
      [
        { marketId: 1, label: 'Over', outcomeType: 'Over', points: 1, displayOdds: { american: '+105' } },
        { marketId: 1, label: 'Under', outcomeType: 'Under', points: 1, displayOdds: { american: '-150' } },
      ],
      teams,
    )).toEqual([]);
  });

  it('keeps team run odd/even off the game total', () => {
    const teams = { away: 'Los Angeles Dodgers', home: 'Milwaukee Brewers' };
    const fd = extractFdContracts({
      game: {
        marketName: 'Total Runs Odd/Even',
        runners: [
          { runnerName: 'Odd', winRunnerOdds: { americanDisplayOdds: { americanOdds: -188 } } },
          { runnerName: 'Even', winRunnerOdds: { americanDisplayOdds: { americanOdds: 152 } } },
        ],
      },
      brewers: {
        marketName: 'Milwaukee Brewers Total Runs Odd/Even',
        runners: [
          { runnerName: 'Odd', winRunnerOdds: { americanDisplayOdds: { americanOdds: -105 } } },
          { runnerName: 'Even', winRunnerOdds: { americanDisplayOdds: { americanOdds: -115 } } },
        ],
      },
      dodgers: {
        marketName: 'Dodgers Total Runs Odd/Even',
        runners: [
          { runnerName: 'Odd', winRunnerOdds: { americanDisplayOdds: { americanOdds: 100 } } },
          { runnerName: 'Even', winRunnerOdds: { americanDisplayOdds: { americanOdds: -122 } } },
        ],
      },
    }, teams);
    const dk = extractDkContracts(
      [
        { id: 1, name: 'Team Total Runs Odd/Even' },
        { id: 2, name: 'Total Runs Odd/Even - 1st Inning' },
      ],
      [
        { marketId: 1, label: 'Odd', outcomeType: 'Odd', displayOdds: { american: '-105' }, participants: [{ name: 'MIL Brewers' }] },
        { marketId: 1, label: 'Odd', outcomeType: 'Odd', displayOdds: { american: '-105' }, participants: [{ name: 'LA Dodgers' }] },
        { marketId: 1, label: 'Even', outcomeType: 'Even', displayOdds: { american: '-130' }, participants: [{ name: 'LA Dodgers' }] },
        { marketId: 1, label: 'Even', outcomeType: 'Even', displayOdds: { american: '-130' }, participants: [{ name: 'MIL Brewers' }] },
        { marketId: 2, label: 'Odd', outcomeType: 'Odd', displayOdds: { american: '+265' } },
        { marketId: 2, label: 'Even', outcomeType: 'Even', displayOdds: { american: '-400' } },
      ],
      teams,
    );
    expect(fd.find((row) => row.key === 'fg|yesno|odd_even|game').fd.even.american).toBe(152);
    expect(fd.find((row) => row.key === 'fg|yesno|odd_even|Milwaukee Brewers').fd.odd.american).toBe(-105);
    expect(fd.find((row) => row.key === 'fg|yesno|odd_even|Los Angeles Dodgers').fd.even.american).toBe(-122);
    expect(dk.find((row) => row.key === 'fg|yesno|odd_even|game')).toBeUndefined();
    expect(dk.find((row) => row.key === 'fg|yesno|odd_even|Milwaukee Brewers').dk).toMatchObject({
      odd: { american: -105 },
      even: { american: -130 },
    });
    expect(dk.find((row) => row.key === '1i|yesno|odd_even|game').dk.odd.american).toBe(265);
    const game = mergeContracts(fd, dk).find((row) => row.key === 'fg|yesno|odd_even|game');
    expect(game.dk).toBeFalsy();
    expect(formatMarketLabel('fg|yesno|odd_even|Milwaukee Brewers')).toBe('Milwaukee Brewers Odd/Even');
    expect(formatMarketLabel('1i|yesno|odd_even|game')).toBe('1I Odd/Even');
  });

  it('assigns tennis moneyline by player name, not DK Home/Away tags', () => {
    const teams = { home: 'Polina Kudermetova', away: 'Mirra Andreeva' };
    const rows = extractDkContracts(
      [{ id: 1, name: 'Moneyline' }],
      [
        { marketId: 1, label: 'Polina Kudermetova', outcomeType: 'Away', displayOdds: { american: '+860' } },
        { marketId: 1, label: 'Mirra Andreeva', outcomeType: 'Home', displayOdds: { american: '-1660' } },
      ],
      teams,
    );
    const ml = rows.find((row) => row.key === 'fg|moneyline|winner|game' || row.kind === 'moneyline');
    expect(ml.dk.home.american).toBe(860);
    expect(ml.dk.away.american).toBe(-1660);
    expect(extractDkContracts(
      [{ id: 2, name: 'Moneyline', hint: 'Both Win Set/Moneyline' }],
      [
        { marketId: 2, label: 'Polina Kudermetova', outcomeType: 'Home', displayOdds: { american: '+860' } },
        { marketId: 2, label: 'Mirra Andreeva', outcomeType: 'Away', displayOdds: { american: '+860' } },
      ],
      teams,
    )).toEqual([]);
  });

  it('does not two-way the same tennis player', () => {
    expect(pairMoneyline(
      { home: { american: 540, team: 'Polina Kudermetova', label: 'Polina Kudermetova' } },
      { away: { american: 450, team: 'Polina Kudermetova', label: 'Polina Kudermetova' } },
    )).toBe(null);
  });

  it('does not pair a longshot player over with a main under', () => {
    expect(pairPlayerTotals(
      { unders: [{ american: 146, line: 1.5, label: 'Under' }], overs: [{ american: -192, line: 1.5, label: 'Over' }] },
      { overs: [{ american: 1600, line: 1.5, label: 'Over' }] },
    ).best).toBe(null);
    const locked = pairPlayerTotals(
      {
        overs: [{ american: -192, line: 1.5, label: 'Over' }],
        unders: [{ american: 146, line: 1.5, label: 'Under' }],
      },
      {
        overs: [{ american: -185, line: 1.5, label: 'Over' }],
        unders: [{ american: 135, line: 1.5, label: 'Under' }],
      },
    );
    expect(locked.best).toBeTruthy();
    expect(locked.best.hasArb).toBe(false);
    expect(locked.best.pSum).toBeGreaterThan(1);
  });

  it('does not pair yes/no when the two books are not the same contract', () => {
    expect(pairYesNo(
      { yes: { american: -2000 }, no: { american: 830 } },
      { yes: { american: -225 }, no: { american: 165 } },
    )).toBe(null);
    expect(pairYesNo(
      { yes: { american: 114 }, no: { american: -144 } },
      { yes: { american: 105 }, no: { american: -140 } },
    )).toBeTruthy();
  });

  it('keeps early-inning team runs off the full-game team total', () => {
    const teams = { away: 'Cleveland Guardians', home: 'Chicago White Sox' };
    const rows = extractDkContracts(
      [
        { id: 1, name: 'CLE Guardians: Team Total Runs', hint: 'Team Totals Total Runs' },
        { id: 2, name: 'CLE Guardians: Team Total Runs - 1st 3 Innings', hint: '1st X Innings 1st 3 Innings' },
        { id: 3, name: 'CLE Guardians: Team Total Runs - 1st 7 Innings', hint: '1st X Innings 1st 7 Innings' },
        { id: 4, name: 'Total Runs - 1st 3 Innings', hint: '1st X Innings 1st 3 Innings' },
      ],
      [
        { marketId: 1, label: 'Over', outcomeType: 'Over', points: 3.5, displayOdds: { american: '-115' } },
        { marketId: 1, label: 'Under', outcomeType: 'Under', points: 3.5, displayOdds: { american: '-115' } },
        { marketId: 2, label: 'Over', outcomeType: 'Over', points: 0.5, displayOdds: { american: '-115' } },
        { marketId: 2, label: 'Under', outcomeType: 'Under', points: 0.5, displayOdds: { american: '-115' } },
        { marketId: 3, label: 'Over', outcomeType: 'Over', points: 2.5, displayOdds: { american: '-110' } },
        { marketId: 3, label: 'Under', outcomeType: 'Under', points: 2.5, displayOdds: { american: '-120' } },
        { marketId: 4, label: 'Over', outcomeType: 'Over', points: 2.5, displayOdds: { american: '+135' } },
        { marketId: 4, label: 'Under', outcomeType: 'Under', points: 2.5, displayOdds: { american: '-175' } },
      ],
      teams,
    );
    const full = rows.find((row) => row.key === 'fg|team_total|points|Cleveland Guardians');
    expect(full.dk.overs.map((row) => row.line)).toEqual([3.5]);
    expect(rows.some((row) => row.key === 'f3|team_total|points|Cleveland Guardians')).toBe(true);
    expect(rows.some((row) => row.key === 'f7|team_total|points|Cleveland Guardians')).toBe(true);
    expect(rows.some((row) => row.key === 'f3|total|points|game')).toBe(true);
    expect(rows.some((row) => row.key === 'fg|total|points|game')).toBe(false);

    const stray = extractDkContracts(
      [
        { id: 5, name: 'Hagen Smith Walks Allowed O/U', hint: 'Pitcher Props Walks Allowed O/U' },
        { id: 6, name: 'Total Doubles', hint: 'Game Totals Doubles' },
        { id: 7, name: 'Total', hint: 'Game Lines Game' },
        { id: 8, name: 'Jose Ramirez Runs O/U', hint: 'Batter Props Runs O/U' },
      ],
      [
        { marketId: 5, label: 'Over', outcomeType: 'Over', points: 0.5, displayOdds: { american: '-166' }, participants: [{ name: 'Hagen Smith' }] },
        { marketId: 5, label: 'Under', outcomeType: 'Under', points: 0.5, displayOdds: { american: '+125' }, participants: [{ name: 'Hagen Smith' }] },
        { marketId: 6, label: 'Over', outcomeType: 'Over', points: 2.5, displayOdds: { american: '-110' } },
        { marketId: 6, label: 'Under', outcomeType: 'Under', points: 2.5, displayOdds: { american: '-130' } },
        { marketId: 7, label: 'Over', outcomeType: 'Over', points: 7, displayOdds: { american: '-112' } },
        { marketId: 7, label: 'Under', outcomeType: 'Under', points: 7, displayOdds: { american: '-107' } },
        { marketId: 8, label: 'Over', outcomeType: 'Over', points: 0.5, displayOdds: { american: '+112' }, participants: [{ name: 'Jose Ramirez' }] },
        { marketId: 8, label: 'Under', outcomeType: 'Under', points: 0.5, displayOdds: { american: '-154' }, participants: [{ name: 'Jose Ramirez' }] },
      ],
      teams,
    );
    const runs = stray.find((row) => row.key === 'fg|total|points|game');
    expect(runs.dk.overs.map((row) => row.line)).toEqual([7]);
    expect(stray.some((row) => row.key.includes('walks') && row.key.includes('Hagen Smith'))).toBe(true);
    expect(stray.some((row) => row.key === 'fg|total|doubles|game')).toBe(true);
    expect(stray.some((row) => row.key === 'fg|player_ou|runs|Jose Ramirez')).toBe(true);
    expect(parseStat('Brenton Doyle Hits + Runs + RBIs O/U')).toBe('hrr');
    expect(parseStat('Jose Ramirez Runs O/U')).toBe('runs');
    expect(parseStat('CHI White Sox Home Run - 1st Inning?')).toBe('home_runs');
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
        marketName: 'WAS Commanders Total Points',
        runners: [
          { runnerName: 'Over', handicap: 22.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -115 } } },
          { runnerName: 'Under', handicap: 22.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -105 } } },
        ],
      },
      bAlt: {
        marketName: 'WAS Commanders Alternate Total',
        runners: [
          { runnerName: 'Over (30.5)', handicap: 0, winRunnerOdds: { americanDisplayOdds: { americanOdds: 400 } } },
          { runnerName: 'Under (30.5)', handicap: 0, winRunnerOdds: { americanDisplayOdds: { americanOdds: -600 } } },
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
    expect(keys).toContain('fg|team_total|points|Washington Commanders');
    expect(keys.filter((key) => key.startsWith('fg|team_total|points|'))).toHaveLength(1);
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

  it('files a 2nd-half corners handicap off the goal spread', () => {
    const teams = { home: 'New England Revolution', away: 'Seattle Sounders' };
    const rows = extractDkContracts(
      [
        { id: 1, name: 'Moneyline 2nd Half' },
        { id: 2, name: 'Asian Handicap Corners - 2nd Half', hint: 'Corners Asian Corners - 2nd Half' },
      ],
      [
        { marketId: 1, label: 'NE Revolution', outcomeType: 'Home', displayOdds: { american: '+120' } },
        { marketId: 1, label: 'Draw', outcomeType: 'Tie', displayOdds: { american: '+170' } },
        { marketId: 1, label: 'Seattle Sounders', outcomeType: 'Away', displayOdds: { american: '+245' } },
        { marketId: 2, label: 'NE Revolution', outcomeType: 'Home', points: -0.5, displayOdds: { american: '-125' } },
        { marketId: 2, label: 'Seattle Sounders', outcomeType: 'Away', points: 0.5, displayOdds: { american: '-110' } },
      ],
      teams,
    );
    expect(rows.some((row) => row.key === '2h|spread|points|game')).toBe(false);
    expect(rows.find((row) => row.kind === 'spread')?.key).toBe('2h|spread|corners|game');
    const scored = attachDeepMarkets(buildGameMarkets({
      sport: 'soccer',
      home: teams.home,
      away: teams.away,
    }), [], rows);
    expect(scored.extras.some((row) => row.kind === 'three_spread')).toBe(false);
  });

  it('keeps soccer BTTS yes/no and drops 3-way ML plus combo BTTS', () => {
    const teams = { home: 'Inter', away: 'Parma' };
    const rows = extractFdContracts({
      ml: {
        marketName: 'Moneyline (3-way)',
        runners: [
          { runnerName: 'Inter', winRunnerOdds: { americanDisplayOdds: { americanOdds: -900 } } },
          { runnerName: 'Draw', winRunnerOdds: { americanDisplayOdds: { americanOdds: 700 } } },
          { runnerName: 'Parma', winRunnerOdds: { americanDisplayOdds: { americanOdds: 1800 } } },
        ],
      },
      half: {
        marketName: 'To Win Either Half',
        runners: [
          { runnerName: 'Inter', winRunnerOdds: { americanDisplayOdds: { americanOdds: -1600 } } },
          { runnerName: 'Parma', winRunnerOdds: { americanDisplayOdds: { americanOdds: 530 } } },
        ],
      },
      combo: {
        marketName: 'Both Teams To Score & O/U 2.5 Goals',
        runners: [
          { runnerName: 'Yes & Over 2.5', winRunnerOdds: { americanDisplayOdds: { americanOdds: 115 } } },
          { runnerName: 'No & Over 2.5', winRunnerOdds: { americanDisplayOdds: { americanOdds: 200 } } },
        ],
      },
      btts: {
        marketName: 'Both Teams To Score',
        runners: [
          { runnerName: 'Yes', winRunnerOdds: { americanDisplayOdds: { americanOdds: 114 } } },
          { runnerName: 'No', winRunnerOdds: { americanDisplayOdds: { americanOdds: -144 } } },
        ],
      },
    }, teams);
    expect(rows.some((row) => row.kind === 'moneyline')).toBe(false);
    const three = rows.find((row) => row.kind === 'three_ml');
    const btts = rows.find((row) => row.kind === 'yesno');
    expect(three?.key).toBe('fg|three_ml|winner|game');
    expect(three.fd.away.american).toBe(1800);
    expect(three.fd.home.american).toBe(-900);
    expect(three.fd.draw.american).toBe(700);
    expect(btts?.key).toBe('fg|yesno|btts|game');
    expect(btts.fd.yes.american).toBe(114);
    expect(btts.fd.no.american).toBe(-144);
    expect(rows).toHaveLength(2);
  });

  it('keeps plain 3-way results and drops handicaps, early payout, and unnamed inning windows', () => {
    const teams = { home: 'Inter', away: 'Parma' };
    const rows = extractFdContracts({
      early: {
        marketName: 'Moneyline (3-way) - 2 Up Early Payout',
        runners: [
          { runnerName: 'Inter', winRunnerOdds: { americanDisplayOdds: { americanOdds: -200 } } },
          { runnerName: 'Draw', winRunnerOdds: { americanDisplayOdds: { americanOdds: 300 } } },
          { runnerName: 'Parma', winRunnerOdds: { americanDisplayOdds: { americanOdds: 500 } } },
        ],
      },
      spread: {
        marketName: '3-way spread (-1): 1st half',
        runners: [
          { runnerName: 'Inter (-1)', winRunnerOdds: { americanDisplayOdds: { americanOdds: 400 } } },
          { runnerName: 'Draw', winRunnerOdds: { americanDisplayOdds: { americanOdds: 250 } } },
          { runnerName: 'Parma (1)', winRunnerOdds: { americanDisplayOdds: { americanOdds: -150 } } },
        ],
      },
      innings: {
        marketName: 'First 2 Innings Result',
        runners: [
          { runnerName: 'Inter', winRunnerOdds: { americanDisplayOdds: { americanOdds: 120 } } },
          { runnerName: 'Tie', winRunnerOdds: { americanDisplayOdds: { americanOdds: 180 } } },
          { runnerName: 'Parma', winRunnerOdds: { americanDisplayOdds: { americanOdds: 140 } } },
        ],
      },
      half: {
        marketName: '1st Half Result',
        runners: [
          { runnerName: 'Inter', winRunnerOdds: { americanDisplayOdds: { americanOdds: 110 } } },
          { runnerName: 'Draw', winRunnerOdds: { americanDisplayOdds: { americanOdds: 210 } } },
          { runnerName: 'Parma', winRunnerOdds: { americanDisplayOdds: { americanOdds: 240 } } },
        ],
      },
    }, teams);
    expect(rows.map((row) => row.key)).toEqual(['1h|three_ml|winner|game']);
    expect(rows[0].fd.home.american).toBe(110);
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

  it('does not cross player goals with player points', () => {
    const fd = extractFdContracts({
      a: {
        marketName: 'Nick Suzuki - Goals',
        runners: [
          { runnerName: 'Over', handicap: 0.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: 195 } } },
          { runnerName: 'Under', handicap: 0.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -270 } } },
        ],
      },
    });
    const dk = extractDkContracts(
      [{ id: 1, name: 'Points O/U', eventId: 9 }],
      [
        { marketId: 1, label: 'Over', outcomeType: 'Over', points: 0.5, displayOdds: { american: '-250' }, participants: [{ name: 'Nick Suzuki' }] },
        { marketId: 1, label: 'Under', outcomeType: 'Under', points: 0.5, displayOdds: { american: '+180' }, participants: [{ name: 'Nick Suzuki' }] },
      ],
    );
    expect(fd[0].key).toBe('fg|player_ou|goals|Nick Suzuki');
    expect(dk[0].key).toBe('fg|player_ou|player_pts|Nick Suzuki');
    expect(mergeContracts(fd, dk).some((row) => row.fd && row.dk)).toBe(false);
  });

  it('does not pair a 60-minute hockey total with a full-game total', () => {
    const fd = extractFdContracts({
      a: {
        marketName: 'Total Goals (60 Min)',
        runners: [
          { runnerName: 'Over', handicap: 4.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -111 } } },
          { runnerName: 'Under', handicap: 4.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -115 } } },
        ],
      },
    });
    const dkGame = extractDkContracts(
      [{ id: 1, name: 'Total' }],
      [
        { marketId: 1, label: 'Over', outcomeType: 'Over', points: 4.5, displayOdds: { american: '-166' } },
        { marketId: 1, label: 'Under', outcomeType: 'Under', points: 4.5, displayOdds: { american: '+140' } },
      ],
    );
    const dkReg = extractDkContracts(
      [{ id: 2, name: 'Alternate Total Goals (Excl OT)', hint: 'Game Props (60 Min)' }],
      [
        { marketId: 2, label: 'Over', outcomeType: 'Over', points: 4.5, displayOdds: { american: '-105' } },
        { marketId: 2, label: 'Under', outcomeType: 'Under', points: 4.5, displayOdds: { american: '-125' } },
      ],
    );
    expect(fd[0].key).toBe('reg|total|points|game');
    expect(dkGame[0].key).toBe('fg|total|points|game');
    expect(dkReg[0].key).toBe('reg|total|points|game');
    expect(mergeContracts(fd, dkGame).some((row) => row.fd && row.dk)).toBe(false);
    const scored = attachDeepMarkets(buildGameMarkets({
      sport: 'hockey',
      home: 'Eisbaren Berlin',
      away: 'Nuremberg Ice Tigers',
      total: { fd: null, dk: dkGame[0].dk },
    }), fd, [...dkGame, ...dkReg]);
    expect(scored.total?.twoWay?.hasArb).toBeFalsy();
    const reg = scored.extras.find((row) => row.key === 'reg|total|points|game');
    expect(reg?.twoWay?.hasArb).toBe(false);
    expect(reg?.fd?.over?.american).toBe(-111);
    expect(reg?.dk?.under?.american).toBe(-125);
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
    const quarter = pairTotals(
      { overs: [{ american: -110, line: 2.25, label: 'Over' }] },
      { unders: [{ american: 145, line: 2.5, label: 'Under' }] },
    );
    expect(quarter.best).toBe(null);
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

  it('orders card rows by best two-way across mains and non-arb props', () => {
    const mains = [
      { key: 'moneyline', label: 'ML', kind: 'moneyline' },
      { key: 'spread', label: 'Spread', kind: 'spread' },
      { key: 'total', label: 'O/U', kind: 'total' },
    ];
    const game = buildGameMarkets({
      sport: 'cfb',
      home: 'Bears',
      away: 'Lions',
      moneyline: {
        fd: { away: { american: -110 }, home: { american: -110 } },
        dk: { away: { american: -115 }, home: { american: -105 } },
      },
      spread: {
        fd: { away: { american: -110, line: -3.5 }, home: { american: -110, line: 3.5 } },
        dk: { away: { american: -110, line: -3.5 }, home: { american: -110, line: 3.5 } },
      },
      total: {
        fd: { over: { american: -110, line: 47.5 }, under: { american: -110, line: 47.5 } },
        dk: { over: { american: -110, line: 47.5 }, under: { american: -110, line: 47.5 } },
      },
    });
    game.extras = [{
      key: '1q|total|points|game',
      label: '1Q O/U',
      kind: 'total',
      main: false,
      fd: { over: { american: -105, line: 9.5 }, under: { american: -115, line: 9.5 } },
      dk: { over: { american: -108, line: 9.5 }, under: { american: -112, line: 9.5 } },
      twoWay: { pSum: 0.97, hasArb: false, legs: [] },
    }];
    const rows = sortCardMarkets(game, mains);
    expect(rows[0].key).toBe('1q|total|points|game');
    expect(rows[0].market.twoWay.pSum).toBe(0.97);
  });

  it('arbs a 3-way win against the other team at +0.5 in the same period', () => {
    const scored = attachDeepMarkets(game, [
      {
        key: 'fg|three_ml|winner|game',
        kind: 'three_ml',
        fd: {
          away: { american: 200, line: null, team: 'Indianapolis Colts', label: 'Indianapolis Colts' },
          home: { american: -150, line: null, team: 'Washington Commanders', label: 'Washington Commanders' },
        },
      },
      {
        key: '2q|three_ml|winner|game',
        kind: 'three_ml',
        fd: {
          away: { american: 180, line: null, team: 'Indianapolis Colts', label: 'Indianapolis Colts' },
          home: { american: 160, line: null, team: 'Washington Commanders', label: 'Washington Commanders' },
        },
      },
    ], [
      {
        key: 'fg|spread|points|game',
        kind: 'spread',
        dk: {
          away: { american: -110, line: -0.5, label: 'Indianapolis Colts' },
          aways: [{ american: -110, line: -0.5, label: 'Indianapolis Colts' }],
          home: { american: -120, line: 0.5, label: 'Washington Commanders' },
          homes: [{ american: -120, line: 0.5, label: 'Washington Commanders' }],
        },
      },
      {
        key: '2q|spread|points|game',
        kind: 'spread',
        dk: {
          away: { american: -105, line: 0.5, label: 'Indianapolis Colts' },
          aways: [{ american: -105, line: 0.5, label: 'Indianapolis Colts' }],
          home: { american: -115, line: -0.5, label: 'Washington Commanders' },
          homes: [{ american: -115, line: -0.5, label: 'Washington Commanders' }],
        },
      },
    ]);
    const rows = scored.extras.filter((row) => row.kind === 'three_spread');
    expect(rows.map((row) => row.key).sort()).toEqual([
      '2q|three_spread|winner|fd-home-dk',
      'fg|three_spread|winner|fd-away-dk',
    ]);
    const fg = rows.find((row) => row.key.startsWith('fg|'));
    expect(fg.label).toBe('3-way vs +0.5 (ML)');
    expect(fg.twoWay.hasArb).toBe(true);
    expect(rows.find((row) => row.key.startsWith('2q|')).label).toBe('2Q 3-way vs +0.5 (2Q ML)');
    expect(scored.extras.find((row) => row.kind === 'three_ml').twoWay).toBeNull();
    const { promoted } = extraRowsForDisplay(scored);
    expect(promoted.filter((row) => row.kind === 'three_spread')).toHaveLength(2);
    expect(formatSidesForRow(fg.fd, 'three_spread', fg.twoWay, 'fd').left).toMatch(/\+200/);
    expect(formatSidesForRow(fg.dk, 'three_spread', fg.twoWay, 'dk').right).toMatch(/\+0\.5/);
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

  it('promotes extras that meet a book min-odds filter', () => {
    const { promoted, rest } = extraRowsForDisplay({
      ...game,
      extras: [
        {
          key: 'fg|yesno|anytime|player:foo',
          label: 'Foo anytime',
          kind: 'yesno',
          main: false,
          fd: { yes: { american: 1600 }, no: { american: -4000 } },
          dk: { yes: { american: 900 }, no: { american: -1600 } },
          twoWay: { pSum: 1.08, hasArb: false, legs: [] },
        },
        {
          key: 'fg|yesno|overtime|game',
          label: 'OT',
          kind: 'yesno',
          main: false,
          fd: { yes: { american: 260 }, no: { american: -320 } },
          dk: { yes: { american: 240 }, no: { american: -300 } },
          twoWay: { pSum: 1.05, hasArb: false, legs: [] },
        },
      ],
    }, { oddsFilter: { book: 'fd', minAmerican: 1500 } });
    expect(promoted.map((row) => row.key)).toEqual(['fg|yesno|anytime|player:foo']);
    expect(rest).toHaveLength(0);
  });

  it('pins the closest qualifying longshot two-way first', () => {
    const { promoted } = extraRowsForDisplay({
      ...game,
      extras: [
        {
          key: 'fg|yesno|anytime|player:wide',
          label: 'Wide',
          kind: 'yesno',
          fd: { yes: { american: 2000 }, no: { american: -5000 } },
          twoWay: {
            pSum: 1.18,
            hasArb: false,
            legs: [{ book: 'fd', american: 2000 }, { book: 'dk', american: -280 }],
          },
        },
        {
          key: 'fg|yesno|anytime|player:close',
          label: 'Close',
          kind: 'yesno',
          fd: { yes: { american: 1600 }, no: { american: -4000 } },
          twoWay: {
            pSum: 1.04,
            hasArb: false,
            legs: [{ book: 'fd', american: 1600 }, { book: 'dk', american: -115 }],
          },
        },
      ],
    }, { oddsFilter: { book: 'fd', minAmerican: 1500 } });
    expect(promoted.map((row) => row.label)).toEqual(['Close', 'Wide']);
  });

  it('extracts CFB drive result as a multi-outcome contract', () => {
    const teams = { home: 'Texas', away: 'Texas State' };
    const rows = extractFdContracts({
      dr: {
        marketName: '1st Texas State Drive Result',
        runners: [
          { runnerName: 'Offensive Touchdown', winRunnerOdds: { americanDisplayOdds: { americanOdds: 350 } } },
          { runnerName: 'Field Goal Attempt', winRunnerOdds: { americanDisplayOdds: { americanOdds: 400 } } },
          { runnerName: 'Punt', winRunnerOdds: { americanDisplayOdds: { americanOdds: 180 } } },
          { runnerName: 'Other', winRunnerOdds: { americanDisplayOdds: { americanOdds: 900 } } },
        ],
      },
    }, teams);
    const row = rows.find((r) => r.kind === 'multiway');
    expect(row?.key).toMatch(/drive_result/);
    expect(row.fd.td.american).toBe(350);
    expect(row.fd.punt.american).toBe(180);
  });

  it('keeps FanDuel main team totals separate from alternate ladders', () => {
    const teams = { home: 'Central Michigan', away: 'Western Michigan' };
    const rows = extractFdContracts({
      main: {
        marketName: 'W Michigan Total Points',
        runners: [
          { runnerName: 'Over', handicap: 26.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -128 } } },
          { runnerName: 'Under', handicap: 26.5, winRunnerOdds: { americanDisplayOdds: { americanOdds: -104 } } },
        ],
      },
      alt: {
        marketName: 'W Michigan Alternate Total',
        runners: [
          { runnerName: 'Over (38.5)', handicap: 0, winRunnerOdds: { americanDisplayOdds: { americanOdds: 1200 } } },
          { runnerName: 'Under (38.5)', handicap: 0, winRunnerOdds: { americanDisplayOdds: { americanOdds: -5000 } } },
        ],
      },
    }, teams);
    const row = rows.find((r) => r.key === 'fg|team_total|points|Western Michigan');
    expect(row?.fd?.over?.line).toBe(26.5);
    expect(row?.fd?.under?.line).toBe(26.5);
    expect(row?.fd?.over?.american).toBe(-128);
  });

  it('does not pair team totals across different alt lines', () => {
    const row = scoreContracts([{
      key: 'fg|team_total|points|Western Michigan',
      kind: 'team_total',
      label: 'W Michigan Total Points',
      fd: {
        overs: [{ american: 1200, line: 38.5, label: 'over' }, { american: -102, line: 27.5, label: 'over' }],
        unders: [{ american: -5000, line: 38.5, label: 'under' }, { american: -130, line: 27.5, label: 'under' }],
        over: { american: -102, line: 27.5, label: 'over' },
        under: { american: -130, line: 27.5, label: 'under' },
      },
      dk: {
        overs: [{ american: -115, line: 27.5, label: 'over' }],
        unders: [{ american: -105, line: 27.5, label: 'under' }],
        over: { american: -115, line: 27.5, label: 'over' },
        under: { american: -105, line: 27.5, label: 'under' },
      },
    }])[0];
    expect(row.twoWay?.pSum).toBeGreaterThan(0.99);
    expect(row.twoWay?.pSum).toBeLessThan(1.08);
    expect(row.twoWay?.legs?.some((leg) => leg.american > 500)).toBe(false);
  });

  it('keeps sane mains when deep extras duplicate one team', () => {
    const game = {
      sport: 'cfb',
      away: 'Western Michigan',
      home: 'Central Michigan',
      moneyline: {
        fd: {
          away: { american: -1600, team: 'Western Michigan' },
          home: { american: 750, team: 'Central Michigan' },
        },
        dk: {
          away: { american: -1640, team: 'Western Michigan' },
          home: { american: 770, team: 'Central Michigan' },
        },
      },
    };
    const filled = fillMainsFromExtras(game, [{
      key: 'fg|moneyline|winner|game',
      kind: 'moneyline',
      twoWay: { pSum: 0.99, hasArb: false, legs: [] },
      fd: {
        away: { american: -2200, team: 'Western Michigan' },
        home: { american: -2200, team: 'Western Michigan' },
      },
    }]);
    expect(filled.moneyline.fd.home.team).toBe('Central Michigan');
    expect(filled.moneyline.fd.home.american).toBe(750);
    expect(bookSidesSane(filled.moneyline.fd, 'moneyline')).toBe(true);
  });

  it('hides player props and heavy juice on the card face by default', () => {
    const rows = [
      { key: 'ml', label: 'ML', kind: 'moneyline', wide: false, market: { twoWay: { pSum: 1.05 } } },
      { key: 'p1', label: 'Player Pass', kind: 'player_ou', wide: true, market: { twoWay: { pSum: 0.98 } } },
      { key: 'p2', label: 'Alt total', kind: 'total', wide: true, market: { twoWay: { pSum: 1.08 } } },
      { key: 'p3', label: 'Close alt', kind: 'total', wide: true, market: { twoWay: { pSum: 1.01 } } },
    ];
    const def = filterCardFaceRows(rows);
    expect(def.rows.map((r) => r.key)).toEqual(['ml', 'p3']);
    expect(def.hiddenPlayerProps).toBe(1);
    expect(def.hiddenHeavyJuice).toBe(1);
    const all = filterCardFaceRows(rows, { showPlayerProps: true, showHeavyJuice: true });
    expect(all.rows).toHaveLength(4);
  });

  it('scores a 3-way lock when draw is quoted on multiple books', () => {
    const scored = scoreContracts([{
      key: 'fg|three_ml|winner|game',
      kind: 'three_ml',
      label: 'Match result',
      fd: {
        away: { american: 1800, label: 'Parma' },
        draw: { american: 700, label: 'Draw' },
        home: { american: -900, label: 'Inter' },
      },
      dk: {
        away: { american: 1600, label: 'Parma' },
        draw: { american: 650, label: 'Draw' },
        home: { american: -850, label: 'Inter' },
      },
    }]);
    expect(scored[0].multiWay?.outcomes).toBe(3);
    expect(scored[0].multiWay?.legs).toHaveLength(3);
    expect(scored[0].multiWay?.pSum).toBeGreaterThan(0);
  });
});
