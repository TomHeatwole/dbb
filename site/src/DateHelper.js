// DateHelper.js
// Utility to get the current year as a string

import { SEASON_START_DAY, PREVIOUS_CURRENT_WEEK_OVERRIDE } from './global_constants';
import { PREVIOUS_YEARS } from './global_constants';

export function getCurrentYear() {
  return String(new Date().getFullYear());
}

export const CURRENT_YEAR = getCurrentYear();

export function getCurrentNFLWeek(season = null) {
  // SEASON_START_DAY is MM/DD
  const now = new Date();
  const currentYear = now.getFullYear();
  const targetYear = season ? Number(season) : currentYear;
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(targetYear, month - 1, day);

  // If we're looking at a previous season and an override is set, use it
  const isPreviousSeason = season && String(season) !== String(currentYear);
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
  const currentYear = now.getFullYear();
  const targetYear = season ? Number(season) : currentYear;
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(targetYear, month - 1, day);

  const isPreviousSeason = season && String(season) !== String(currentYear);
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
export function isCurrentWeekCompleted(season = null) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const targetYear = season ? Number(season) : currentYear;
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(targetYear, month - 1, day);

  const isPreviousSeason = season && String(season) !== String(currentYear);
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

export const getDefaultDisplayWeek = function(season) {
  const isCurrentSeason = season === CURRENT_YEAR || season === null;
  return isCurrentSeason ? getCurrentNFLWeek() : 17;
};