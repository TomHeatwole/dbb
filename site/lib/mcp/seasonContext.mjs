import { CURRENT_YEAR, SEASON_START_DAY } from './config.mjs';
import { getCurrentNFLWeek, getCompletedWeeksCount } from './helpers.mjs';

const REG_SEASON_WEEKS = 14;

/**
 * Which Monte Carlo engine get_season_odds should run.
 * Before kickoff: full-season preseason sim (Hwang ADP, every week rolled).
 * After kickoff: rest-of-season sim (finished weeks locked, FantasyPros ROS ranks).
 */
export function simModeFromClock({ seasonStarted, completedWeeks }) {
  if (!seasonStarted) return { mode: 'preseason', lockedWeekCount: 0 };
  return {
    mode: 'ros',
    lockedWeekCount: Math.max(0, Math.min(REG_SEASON_WEEKS, Number(completedWeeks) || 0)),
  };
}

export function readSeasonClock(now = new Date()) {
  const yr = CURRENT_YEAR;
  const currentWeek = getCurrentNFLWeek(yr);
  const completedWeeks = getCompletedWeeksCount(yr);
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(Number(yr), month - 1, day);
  const seasonStarted = now >= seasonStart;
  const inSeason = seasonStarted && completedWeeks > 0 && currentWeek <= 17;
  const rostersLocked = seasonStarted && completedWeeks > 0;
  const { mode, lockedWeekCount } = simModeFromClock({ seasonStarted, completedWeeks });
  return {
    yr, currentWeek, completedWeeks, seasonStarted, inSeason, rostersLocked, mode, lockedWeekCount,
  };
}

/**
 * Live season snapshot appended to HwangAI's system prompt each request.
 * Overrides any stale static dates in hwangai_system_prompt.txt.
 */
export function formatSeasonContext(now = new Date()) {
  const {
    yr, currentWeek, completedWeeks, seasonStarted, inSeason, rostersLocked, mode, lockedWeekCount,
  } = readSeasonClock(now);

  const lines = [
    '════════════════════════════════════════',
    'CURRENT SEASON STATE (live — trust this over static prompt dates)',
    '════════════════════════════════════════',
    `- League season year: ${yr}`,
    `- Current NFL week: ${currentWeek} (Weeks 1–14 count toward regular-season standings; playoffs are Weeks 15–17)`,
    `- Completed weeks with scores: ${completedWeeks}`,
  ];

  if (!seasonStarted) {
    lines.push('- Season status: PRESEASON — rosters not locked yet; trades and adds are still possible until kickoff.');
  } else if (inSeason) {
    lines.push('- Season status: IN SEASON — rosters are LOCKED. No trades, adds, or drops until next offseason.');
    lines.push('- Do NOT suggest waiver pickups, streaming replacements, or mid-season roster moves — they are impossible in this league.');
    lines.push('- For "how many points", "how is he doing this season", or "what did he score": call get_player_league_points first (actual league-scored fantasy points through completed weeks). Use get_player_stats for NFL box-score detail. Do NOT default to KTC dynasty values or <!--search--> for in-season production questions.');
  } else if (completedWeeks >= 17) {
    lines.push('- Season status: COMPLETE — use get_historical_results or get_player_stats for final totals.');
  } else {
    lines.push('- Season status: Season has kicked off but no completed scoring weeks yet.');
  }

  if (rostersLocked) {
    lines.push('- Transaction window: CLOSED for the current season.');
  }

  if (mode === 'ros') {
    const nextWeek = lockedWeekCount + 1;
    const locked = lockedWeekCount > 0
      ? `Weeks 1–${lockedWeekCount} stay the actual scores already played.`
      : 'No regular-season week has finished yet, so nothing is locked.';
    const rest = lockedWeekCount >= REG_SEASON_WEEKS
      ? 'Playoff weeks 15–17 still roll.'
      : `Weeks ${nextWeek}–14 and the playoffs roll from FantasyPros rest-of-season positional ranks, not preseason ADP.`;
    lines.push(`- Season simulator: REST OF SEASON. get_season_odds and simulate_roster_change_odds must be described as the ROS simulator. ${locked} ${rest} Do NOT call these results a preseason simulation or an ADP simulation.`);
  } else {
    lines.push('- Season simulator: PRESEASON. get_season_odds and simulate_roster_change_odds roll the full season from Hwang ADP. No weeks are locked. Do NOT describe these results as a rest-of-season simulation.');
  }

  return lines.join('\n');
}
