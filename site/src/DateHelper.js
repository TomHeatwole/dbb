// DateHelper.js
// Utility to get the current year as a string

import { SEASON_START_DAY } from './global_constants';

export function getCurrentYear() {
  return String(new Date().getFullYear());
}

export const CURRENT_YEAR = getCurrentYear();

export function getCurrentNFLWeek() {
  // SEASON_START_DAY is MM/DD
  const now = new Date();
  const year = now.getFullYear();
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(year, month - 1, day);

  // If before season start, return 1
  if (now < seasonStart) return 1;

  // Compute days since season start
  const daysSinceStart = Math.floor((now - seasonStart) / (1000 * 60 * 60 * 24));
  // Week 1 is days 0-6, week 2 is 7-13, etc.
  const week = Math.floor(daysSinceStart / 7) + 1;
  return Math.min(week, 17);
}

// Number of weeks for which Tuesday has passed relative to each week start (Thu)
export function getCompletedWeeksCount() {
  const now = new Date();
  const year = now.getFullYear();
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(year, month - 1, day);

  if (now < seasonStart) {
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
export function isCurrentWeekCompleted() {
  const now = new Date();
  const year = now.getFullYear();
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(year, month - 1, day);

  if (now < seasonStart) {
    return false;
  }

  const currentWeek = getCurrentNFLWeek();
  const currentWeekStart = new Date(seasonStart.getTime() + (currentWeek - 1) * 7 * 24 * 60 * 60 * 1000);
  const tuesdayThreshold = new Date(currentWeekStart.getTime() + 5 * 24 * 60 * 60 * 1000);
  return now >= tuesdayThreshold;
}

export const getDefaultDisplayWeek = function(season) {
  const isCurrentSeason = season === CURRENT_YEAR || season === null;
  return isCurrentSeason ? getCurrentNFLWeek() : 17;
};