// DateHelper.js
// Utility to get the current year as a string

import { SEASON_START_DAY, PREVIOUS_CURRENT_WEEK_OVERRIDE, PREVIOUS_YEARS } from './global_constants';
import { readAdminBlob } from './database';

function getClockYear() {
  return String(new Date().getFullYear());
}

export function getEffectiveCurrentSeasonYear() {
  try {
    const keys = Object.keys(PREVIOUS_YEARS || {});
    const years = keys
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n) && n > 1900 && n < 3000);
    if (!years.length) {
      return getClockYear();
    }
    const maxPrev = Math.max(...years);
    return String(maxPrev + 1);
  } catch (_) {
    return getClockYear();
  }
}

export function getCurrentYear() {
  // "Current season year" is settings-driven, not calendar-driven:
  // it is always max(PREVIOUS_YEARS) + 1.
  return getEffectiveCurrentSeasonYear();
}

export const CURRENT_YEAR = getCurrentYear();

export function getCurrentNFLWeek(season = null) {
  // SEASON_START_DAY is MM/DD
  const now = new Date();
  const effectiveCurrentSeasonYear = Number(getCurrentYear());
  const targetYear = season ? Number(season) : effectiveCurrentSeasonYear;
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(targetYear, month - 1, day);

  // If we're looking at a previous season and an override is set, use it
  const isPreviousSeason = season && String(season) !== String(getCurrentYear());
  if (isPreviousSeason && PREVIOUS_CURRENT_WEEK_OVERRIDE != null) {
    return Math.max(1, Math.min(17, Number(PREVIOUS_CURRENT_WEEK_OVERRIDE)));
  }

  // If before season start (and no override), return 1
  if (!isPreviousSeason && now < seasonStart) return 1;

  // Compute days since season start
  const daysSinceStart = Math.floor((now - seasonStart) / (1000 * 60 * 60 * 24));
  // Week 1 is days 0-6, week 2 is 7-13, etc.
  const week = Math.floor(daysSinceStart / 7) + 1;
  return Math.min(week, 17);
}

// Number of weeks for which Tuesday has passed relative to each week start (Thu)
export function getCompletedWeeksCount(season = null) {
  const now = new Date();
  const effectiveCurrentSeasonYear = Number(getCurrentYear());
  const targetYear = season ? Number(season) : effectiveCurrentSeasonYear;
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(targetYear, month - 1, day);

  const isPreviousSeason = season && String(season) !== String(getCurrentYear());
  if (isPreviousSeason && PREVIOUS_CURRENT_WEEK_OVERRIDE != null) {
    // completed weeks equals override (cap at 17)
    return Math.max(0, Math.min(17, Number(PREVIOUS_CURRENT_WEEK_OVERRIDE)));
  }

  if (!isPreviousSeason && now < seasonStart) {
    return 0;
  }

  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const daysSinceStart = Math.floor((now - seasonStart) / MS_PER_DAY);
  // A week is completed once "start + 5 days" (Tuesday) has occurred
  // Derivation: count weeks w such that now >= start + 7*w + 5
  // => w <= (daysSinceStart - 5) / 7; number of such weeks = floor((daysSinceStart - 5)/7) + 1
  const raw = Math.floor((daysSinceStart - 5) / 7) + 1;
  return Math.max(0, Math.min(17, raw));
}

// Whether the current week (per getCurrentNFLWeek) has completed (i.e., Tuesday has passed)
export function isCurrentWeekCompletedByDate(season = null) {
  const now = new Date();
  const effectiveCurrentSeasonYear = Number(getCurrentYear());
  const targetYear = season ? Number(season) : effectiveCurrentSeasonYear;
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(targetYear, month - 1, day);

  const isPreviousSeason = season && String(season) !== String(getCurrentYear());
  if (isPreviousSeason && PREVIOUS_CURRENT_WEEK_OVERRIDE != null) {
    // completed weeks equals override; current week considered completed if override advanced beyond start+5 of that week
    return true; // previous seasons are static with override, treat as completed snapshot
  }

  if (!isPreviousSeason && now < seasonStart) {
    return false;
  }

  const currentWeek = getCurrentNFLWeek(season);
  const currentWeekStart = new Date(seasonStart.getTime() + (currentWeek - 1) * 7 * 24 * 60 * 60 * 1000);
  const tuesdayThreshold = new Date(currentWeekStart.getTime() + 5 * 24 * 60 * 60 * 1000);
  return now >= tuesdayThreshold;
}

// Default DB-aware version: checks admin overrides first, then falls back to date-based logic
export async function isCurrentWeekCompleted(season = null) {
  try {
    const yearStr = String(season || getCurrentYear());
    const weekNum = getCurrentNFLWeek(season);
    const admin = await readAdminBlob();
    // New schema: admin holds arrays like "2025_completed_weeks": [1,2,...]
    const completedKey = `${yearStr}_completed_weeks`;
    if (admin && Array.isArray(admin[completedKey])) {
      return admin[completedKey].includes(Number(weekNum));
    }
  } catch (_) {}
  const byDate = isCurrentWeekCompletedByDate(season);
  return byDate;
}

// Back-compat alias
export async function isCurrentWeekCompletedDbAware(season = null) {
  return isCurrentWeekCompleted(season);
}

export const getDefaultDisplayWeek = function(season) {
  const isCurrentSeason = season === CURRENT_YEAR || season === null;
  return isCurrentSeason ? getCurrentNFLWeek() : 17;
};

// Check if we're in the post-season, pre-draft state for a given season.
// This is the window after Week 17 completes but before the NFL rookie draft happens.
// During this time, we can show exact draft pick numbers (e.g., "2026 1.03") instead of generic rounds.
export function isPostSeasonPreDraft(season = null) {
  const targetSeason = season || CURRENT_YEAR;
  const isCurrentSeason = String(targetSeason) === String(CURRENT_YEAR);
  
  if (!isCurrentSeason) {
    // For past seasons, never show specific pick numbers
    return false;
  }
  
  const completedWeeks = getCompletedWeeksCount(targetSeason);
  
  // Post-season state: Week 17 is complete
  // TODO: In the future, we may want to add an explicit flag to indicate when the NFL draft has occurred
  // For now, we assume if Week 17 is done in the current season, we're in this state
  return Number.isFinite(completedWeeks) && completedWeeks >= 17;
}

/**
 * Whether the current season's rookie draft has finished.
 * Uses Sleeper status when available; falls back to calendar (May+) in preseason.
 */
export function isCurrentYearRookieDraftDone(rookieDraftComplete = false) {
  if (rookieDraftComplete) return true;
  const completedWeeks = getCompletedWeeksCount(CURRENT_YEAR);
  if (completedWeeks > 0) return true;
  // NFL rookie draft finishes in late April; from May onward treat it as done.
  return new Date().getMonth() >= 4;
}

/**
 * Min/max draft seasons for future pick inventory (3 consecutive drafts).
 * e.g. after the 2026 draft: 2027–2029.
 */
export function getFuturePickSeasonRange(rookieDraftComplete = false) {
  const currentYearNum = Number(CURRENT_YEAR);
  const completedWeeks = getCompletedWeeksCount(CURRENT_YEAR);
  const isPreSeason = completedWeeks === 0;
  const currentYearDraftDone = isCurrentYearRookieDraftDone(rookieDraftComplete);
  const minSeason = currentYearNum + (currentYearDraftDone ? 1 : 0);
  return {
    minSeason,
    maxSeason: minSeason + 2,
    isPreSeason,
    currentYearDraftDone,
  };
}

export function getNextDraftYear(rookieDraftComplete = false) {
  const { isPreSeason, currentYearDraftDone } = getFuturePickSeasonRange(rookieDraftComplete);
  if (isPreSeason && !currentYearDraftDone) return String(CURRENT_YEAR);
  return String(Number(CURRENT_YEAR) + 1);
}

// Decide if we should poll current week's data based on ESPN scoreboard json
// Conditions:
// 1) Any game shows an in-progress status
// 2) Any game start time is <= now (kickoff reached)
export function shouldPollCurrentWeek(espnScoreboardJson) {
  try {
    if (!espnScoreboardJson || !Array.isArray(espnScoreboardJson.events)) { return false; }
    const now = Date.now();
    // removed debug log
    for (const ev of espnScoreboardJson.events) {
      const comps = ev && ev.competitions;
      const comp = Array.isArray(comps) && comps.length ? comps[0] : null;
      if (!comp) { continue; }
      // Status check
      const status = comp.status || (ev && ev.status) || null;
      const type = status && status.type ? status.type : (ev && ev.status && ev.status.type ? ev.status.type : null);
      const state = type && type.state ? String(type.state).toLowerCase() : '';
      const isLive = state === 'in' || state === 'inprogress' || state === 'in_progress' || state === 'live';
      const isFinal = state === 'final' || state === 'post' || state === 'postgame' || state === 'status_final' || state === 'complete' || state === 'end';
      if (isLive) {
        // removed debug log
        return true;
      }
      // Kickoff window checks
      const dateStr = comp.date || (ev && ev.date);
      if (dateStr) {
        const kick = Date.parse(dateStr);
        if (!isNaN(kick)) {
          const GAME_WINDOW_MS = 6 * 60 * 60 * 1000; // up to ~6h after kickoff counts as potentially live
          const PRE_WINDOW_MS = 2 * 60 * 60 * 1000;  // within 2h before kickoff
          // If kickoff already passed but not marked final, only treat as live within game window
          if (!isFinal && kick <= now && (now - kick) <= GAME_WINDOW_MS) {
            // removed debug log
            return true;
          }
          // If kickoff upcoming soon, start polling ahead of time
          if (!isFinal && kick > now && (kick - now) <= PRE_WINDOW_MS) {
            // removed debug log
            return true;
          }
        }
      }
    }
    // removed debug log
    return false;
  } catch (_) {
    return false;
  }
}