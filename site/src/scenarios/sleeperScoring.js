/**
 * sleeperScoring.js
 *
 * Translates raw Sleeper weekly stats (from /v1/stats/nfl/regular/{season}/{week})
 * into fantasy points using the league's score_format.json config.
 *
 * This fills the gap in computeScenarioEval where free agents — players not on any
 * roster during the actual season — have no entry in the Sleeper matchup data
 * (players_points).  By pre-fetching the Sleeper per-week stats for all 17 weeks
 * we can compute accurate points for any player regardless of roster status.
 *
 * Field mapping mirrors validate_scores_data.js (the validated source of truth).
 */

import { calculateFantasyPoints } from '../data_parse/fantasyCalculator';

// ── Sleeper stat field → score_format.json field ──────────────────────────────

export const SLEEPER_FIELD_MAP = {
  // Passing
  pass_yd:   'passing_yards',
  pass_td:   'passing_tds',
  pass_int:  'passing_interceptions',
  pass_2pt:  'passing_2pt_conversions',

  // Rushing
  rush_yd:   'rushing_yards',
  rush_td:   'rushing_tds',
  rush_2pt:  'rushing_2pt_conversions',
  rush_fum_lost: 'rushing_fumbles_lost',

  // Receiving
  rec:       'receptions',
  rec_yd:    'receiving_yards',
  rec_td:    'receiving_tds',
  rec_2pt:   'receiving_2pt_conversions',
  rec_fum_lost: 'receiving_fumbles_lost',

  // Fumble recovery TDs
  fum_rec_td: 'receiving_tds',

  // Sack fumble
  sack_fum_lost: 'sack_fumbles_lost',

  // Kicking
  fgm:         'fg_made',
  fgmiss:      'fg_missed',
  fgm_50_59:   'fg_made_50_59',
  fgm_60_:     'fg_made_60_',
  xpm:         'pat_made',
  xpmiss:      'pat_missed',

  // Defense / special teams
  def_sack:   'def_sacks',
  def_int:    'def_interceptions',
  def_fr:     'def_fumbles',
  def_td:     'def_tds',
  def_safe:   'def_safeties',
  def_st_td:  'special_teams_tds',
  st_td:      'special_teams_tds',
};

/**
 * Convert a single player's raw Sleeper weekly stats object into a mapped stats
 * object that `calculateFantasyPoints` (from fantasyCalculator.js) can consume.
 *
 * @param {Object} sleeperStats  Raw stats object for one player/week from Sleeper.
 * @param {string} position      Player position string (e.g. "QB", "WR", "TE").
 * @returns {Object}             Mapped stats keyed by score_format.json field names.
 */
export function mapSleeperStats(sleeperStats, position) {
  if (!sleeperStats) return { position: position || '' };

  const mapped = { position: position || '' };

  for (const [sleeperKey, scoreKey] of Object.entries(SLEEPER_FIELD_MAP)) {
    const val = sleeperStats[sleeperKey];
    if (val != null && val !== 0) {
      // Multiple Sleeper keys can map to the same score key (e.g. special_teams_tds).
      // Accumulate rather than overwrite so we don't lose partial values.
      mapped[scoreKey] = (mapped[scoreKey] || 0) + val;
    }
  }

  // Fallback: if Sleeper only reports a combined fum_lost and we have no
  // position-specific fumble field, apply it to the appropriate column.
  if (sleeperStats.fum_lost != null && sleeperStats.fum_lost !== 0) {
    if (!mapped.rushing_fumbles_lost && !mapped.receiving_fumbles_lost) {
      // Use rushing_fumbles_lost as the bucket; the -2 penalty fires once.
      mapped.rushing_fumbles_lost = sleeperStats.fum_lost;
    }
  }

  return mapped;
}

/**
 * Compute league fantasy points for a player in a single week from raw Sleeper stats.
 *
 * @param {Object} sleeperStats   Raw Sleeper stats for the player/week.
 * @param {string} position       Player position.
 * @param {Object} scoringConfig  The league scoring config (from score_format.json).
 * @returns {number}              Fantasy points, rounded to 2 decimal places.
 */
export function computePointsFromSleeperStats(sleeperStats, position, scoringConfig) {
  if (!sleeperStats || !scoringConfig) return 0;
  const mapped = mapSleeperStats(sleeperStats, position);
  return calculateFantasyPoints(mapped, scoringConfig);
}

/**
 * Given 17 weeks of raw Sleeper stats (indexed 0-16) and the league scoring config,
 * build a playerWeeklyPoints-compatible structure:
 *
 *   result[weekIndex][playerId] = points
 *
 * This covers ALL players Sleeper tracked that week (including free agents).
 * The caller should layer the matchup-sourced points on top of this (matchup
 * data is authoritative for rostered players since Sleeper already applied the
 * exact league scoring rules there).
 *
 * @param {Array<Object|null>} sleeperWeeklyStats  17-element array; each element is
 *   { [playerId]: rawStatsObj } or null/undefined for weeks with no data.
 * @param {Object} scoringConfig  League scoring config.
 * @param {Object} playersData    Sleeper players metadata keyed by player ID,
 *   used to look up each player's position.
 * @returns {Array<Object>}  17-element array of { [playerId]: points } maps.
 */
export function buildSleeperBasePoints(sleeperWeeklyStats, scoringConfig, playersData) {
  return Array.from({ length: 17 }, (_, weekIdx) => {
    const weekStats = sleeperWeeklyStats && sleeperWeeklyStats[weekIdx];
    if (!weekStats || typeof weekStats !== 'object') return {};

    const weekPts = {};
    for (const [pid, stats] of Object.entries(weekStats)) {
      if (!stats || typeof stats !== 'object') continue;
      const player   = playersData && playersData[pid];
      const position = player?.position || '';
      weekPts[pid]   = computePointsFromSleeperStats(stats, position, scoringConfig);
    }
    return weekPts;
  });
}
