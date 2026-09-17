import { CURRENT_YEAR, SEASON_START_DAY } from './config.mjs';
import { getCurrentNFLWeek, getCompletedWeeksCount } from './helpers.mjs';

/**
 * Live season snapshot appended to HwangAI's system prompt each request.
 * Overrides any stale static dates in hwangai_system_prompt.txt.
 */
export function formatSeasonContext() {
  const now = new Date();
  const yr = CURRENT_YEAR;
  const currentWeek = getCurrentNFLWeek(yr);
  const completedWeeks = getCompletedWeeksCount(yr);
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(Number(yr), month - 1, day);
  const seasonStarted = now >= seasonStart;
  const inSeason = seasonStarted && completedWeeks > 0 && currentWeek <= 17;
  const rostersLocked = seasonStarted && completedWeeks > 0;

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

  return lines.join('\n');
}
