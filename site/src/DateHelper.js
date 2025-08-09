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

export const getDefaultDisplayWeek = function(season) {
  const isCurrentSeason = season === CURRENT_YEAR || season === null;
  return isCurrentSeason ? getCurrentNFLWeek() : 17;
};