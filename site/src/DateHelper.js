// DateHelper.js
// Utility to get the current year as a string

export function getCurrentYear() {
  return String(new Date().getFullYear());
}

export const CURRENT_YEAR = getCurrentYear(); 