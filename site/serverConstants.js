// serverConstants.js
// Small server-only helper to expose CURRENT_YEAR, LEAGUE_ID, and PREVIOUS_YEARS
// for use in Vercel API routes and other Node code. This mirrors the shape of
// the client-side global_constants, but without any React-specific imports.

const serializedSettings =
  process.env.REACT_APP_SITE_SETTINGS || process.env.SITE_SETTINGS || '';

let parsedSettings = {};
try {
  parsedSettings = serializedSettings ? JSON.parse(serializedSettings) : {};
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('SERVER SITE_SETTINGS is not valid JSON. Falling back to empty config.');
  parsedSettings = {};
}

const LEAGUE_ID = parsedSettings.LEAGUE_ID || null;
const PREVIOUS_YEARS = parsedSettings.PREVIOUS_YEARS || {};

function getClockYear() {
  return String(new Date().getFullYear());
}

function getEffectiveCurrentSeasonYear() {
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

// "Current season year" is settings-driven, not calendar-driven.
const CURRENT_YEAR = getEffectiveCurrentSeasonYear();

module.exports = {
  CURRENT_YEAR,
  LEAGUE_ID,
  PREVIOUS_YEARS
};


