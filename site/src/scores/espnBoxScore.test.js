import {
  buildEspnLiveBySleeper,
  collectAthletesFromBoxscore,
  dstStatsFromSummary,
  eventIdsForBoxScores,
  formatPlayerStatLine,
  kickerDistanceBonuses,
  mapEspnBagsToScoringStats,
  parseNum,
  parseSlash,
  shouldPreferEspn,
  sleeperDefIdFromEspnAbbr,
  teamStatesFromScoreboard,
} from './espnBoxScore';
import { overlayEspnOnWeek } from './overlayEspnLiveScores';

const SCORING = {
  scoring: {
    passing_yards: 0.04,
    passing_tds: 4,
    passing_interceptions: -2,
    passing_2pt_conversions: 2,
    rushing_yards: 0.1,
    rushing_tds: 6,
    rushing_fumbles_lost: -2,
    rushing_2pt_conversions: 2,
    receiving_yards: 0.1,
    receiving_tds: 6,
    receptions: 0,
    receiving_fumbles_lost: -2,
    receiving_2pt_conversions: 2,
    sack_fumbles_lost: -2,
    fg_made: 3,
    fg_missed: -1,
    fg_made_50_59: 2,
    fg_made_60_: 3,
    pat_made: 1,
    pat_missed: -1,
    def_sacks: 1,
    def_interceptions: 2,
    def_fumbles: 2,
    def_tds: 6,
    def_safeties: 2,
    special_teams_tds: 6,
  },
  position_specific_scoring: {
    receptions: { TE: 0.5, WR: 0, RB: 0, QB: 0 },
  },
  bonuses: {},
};

function athlete(id, name, last, stats) {
  return { athlete: { id, displayName: name, lastName: last }, stats };
}

function summaryFixture() {
  return {
    boxscore: {
      players: [
        {
          team: { abbreviation: 'DAL' },
          statistics: [
            {
              name: 'passing',
              keys: ['completions/passingAttempts', 'passingYards', 'passingTouchdowns', 'interceptions'],
              athletes: [athlete('2577417', 'Dak Prescott', 'Prescott', ['16/25', '116', '1', '1'])],
            },
            {
              name: 'rushing',
              keys: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns'],
              athletes: [athlete('4430737', 'Javonte Williams', 'Williams', ['18', '92', '1'])],
            },
            {
              name: 'receiving',
              keys: ['receptions', 'receivingYards', 'receivingTouchdowns'],
              athletes: [athlete('16800', 'Jake Ferguson', 'Ferguson', ['6', '84', '1'])],
            },
            {
              name: 'kicking',
              keys: ['fieldGoalsMade/fieldGoalAttempts', 'extraPointsMade/extraPointAttempts'],
              athletes: [athlete('3050215', 'Brandon Aubrey', 'Aubrey', ['2/3', '3/3'])],
            },
          ],
        },
        { team: { abbreviation: 'NYG' }, statistics: [] },
      ],
      teams: [
        {
          team: { abbreviation: 'DAL' },
          statistics: [
            { name: 'sacksYardsLost', displayValue: '1-7' },
            { name: 'interceptions', displayValue: '1' },
            { name: 'fumblesLost', displayValue: '0' },
            { name: 'defensiveTouchdowns', displayValue: '0' },
          ],
        },
        {
          team: { abbreviation: 'NYG' },
          statistics: [
            { name: 'sacksYardsLost', displayValue: '3-21' },
            { name: 'interceptions', displayValue: '1' },
            { name: 'fumblesLost', displayValue: '1' },
            { name: 'defensiveTouchdowns', displayValue: '1' },
          ],
        },
      ],
    },
    scoringPlays: [
      { type: { text: 'Field Goal' }, text: 'Brandon Aubrey 52 Yd Field Goal', team: { abbreviation: 'DAL' } },
      { type: { text: 'Field Goal' }, text: 'Brandon Aubrey 31 Yd Field Goal', team: { abbreviation: 'DAL' } },
      { type: { text: 'Safety' }, text: 'Safety', team: { abbreviation: 'DAL' } },
    ],
  };
}

describe('espn box score parsing', () => {
  it('parses slash and leading numbers', () => {
    expect(parseSlash('16/25')).toEqual({ made: 16, att: 25 });
    expect(parseNum('3-21')).toBe(3);
    expect(parseNum('1.5')).toBe(1.5);
  });

  it('maps Sleeper DEF ids from ESPN abbreviations', () => {
    expect(sleeperDefIdFromEspnAbbr('WSH')).toBe('WAS');
    expect(sleeperDefIdFromEspnAbbr('JAC')).toBe('JAX');
    expect(sleeperDefIdFromEspnAbbr('DAL')).toBe('DAL');
  });

  it('scores a passer from ESPN bags', () => {
    const athletes = collectAthletesFromBoxscore(summaryFixture());
    const dak = athletes['2577417'];
    const stats = mapEspnBagsToScoringStats(dak.bags);
    expect(stats.passing_yards).toBe(116);
    expect(stats.passing_tds).toBe(1);
    expect(stats.passing_interceptions).toBe(1);
    expect(formatPlayerStatLine(dak.bags)).toContain('16/25');
    expect(formatPlayerStatLine(dak.bags)).toContain('116 yd');
  });

  it('adds 50+ FG bonuses from scoring plays', () => {
    const extras = kickerDistanceBonuses(summaryFixture(), 'DAL', 'Aubrey');
    expect(extras.fg50).toBe(1);
    expect(extras.fg60).toBe(0);
  });

  it('builds DST from opponent team stats + safeties', () => {
    const dst = dstStatsFromSummary(summaryFixture());
    expect(dst.DAL.stats.def_sacks).toBe(3);
    expect(dst.DAL.stats.def_interceptions).toBe(1);
    expect(dst.DAL.stats.def_fumbles).toBe(1);
    expect(dst.DAL.stats.def_safeties).toBe(1);
    expect(dst.NYG.stats.def_sacks).toBe(1);
    expect(dst.DAL.sleeperId).toBe('DAL');
  });

  it('selects live and recently-final events', () => {
    const now = Date.parse('2026-09-14T01:00:00Z');
    const board = {
      events: [
        { id: 'live1', date: '2026-09-14T00:20:00Z', status: { type: { state: 'in' } } },
        { id: 'final1', date: '2026-09-13T17:00:00Z', status: { type: { state: 'post' } } },
        { id: 'old1', date: '2026-09-10T17:00:00Z', status: { type: { state: 'post' } } },
        { id: 'pre1', date: '2026-09-14T20:00:00Z', status: { type: { state: 'pre' } } },
      ],
    };
    expect(eventIdsForBoxScores(board, now)).toEqual(['live1', 'final1']);
    expect(eventIdsForBoxScores(board, now)).not.toContain('old1');
    expect(eventIdsForBoxScores(board, now)).not.toContain('pre1');
    const states = teamStatesFromScoreboard({
      events: [{
        id: 'live1',
        date: '2026-09-14T00:20:00Z',
        status: { type: { state: 'in' } },
        competitions: [{ competitors: [
          { homeAway: 'away', team: { abbreviation: 'DAL' } },
          { homeAway: 'home', team: { abbreviation: 'NYG' } },
        ] }],
      }],
    });
    expect(states.DAL.live).toBe(true);
  });
});

describe('ESPN overlay vs Sleeper', () => {
  const playerIdMap = {
    dak: '2577417',
    javonte: '4430737',
    ferguson: '16800',
    aubrey: '3050215',
  };
  const playersData = {
    dak: { position: 'QB', team: 'DAL', espn_id: '2577417' },
    javonte: { position: 'RB', team: 'DAL', espn_id: '4430737' },
    ferguson: { position: 'TE', team: 'DAL', espn_id: '16800' },
    aubrey: { position: 'K', team: 'DAL', espn_id: '3050215' },
    DAL: { position: 'DEF', team: 'DAL' },
  };

  it('scores TE premium and overlays live points', () => {
    const espnBySleeper = buildEspnLiveBySleeper({
      summaries: [summaryFixture()],
      playerIdMap,
      playersData,
      scoringConfig: SCORING,
      teamStates: { DAL: { live: true, completed: false }, NYG: { live: true, completed: false } },
    });
    expect(espnBySleeper.dak.pts).toBeCloseTo(6.64, 2);
    expect(espnBySleeper.javonte.pts).toBeCloseTo(15.2, 2);
    expect(espnBySleeper.ferguson.pts).toBeCloseTo(17.4, 2);
    expect(espnBySleeper.aubrey.pts).toBe(10);
    expect(espnBySleeper.DAL.pts).toBe(9);
    expect(espnBySleeper.dak.statLine).toMatch(/16\/25/);

    const week = overlayEspnOnWeek([{
      roster_id: 1,
      points: 2,
      starters: ['dak', 'javonte'],
      starters_points: [2, 0],
      players_points: { dak: 2, javonte: 0, ferguson: 0 },
      players: ['dak', 'javonte', 'ferguson'],
    }], espnBySleeper);
    expect(week[0].players_points.dak).toBeCloseTo(6.64, 2);
    expect(week[0].players_points.javonte).toBeCloseTo(15.2, 2);
    expect(week[0].points).toBeCloseTo(21.84, 2);
  });

  it('keeps official Sleeper once it has caught a final', () => {
    expect(shouldPreferEspn({ live: true, pts: 12 }, 3)).toBe(true);
    expect(shouldPreferEspn({ live: false, completed: true, pts: 12 }, 0)).toBe(true);
    expect(shouldPreferEspn({ live: false, completed: true, pts: 12 }, 11.8)).toBe(false);
    expect(shouldPreferEspn({ live: false, completed: true, pts: 12 }, 12)).toBe(false);
  });
});
