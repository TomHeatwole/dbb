const serializedSettings = process.env.REACT_APP_SITE_SETTINGS;

let parsedSettings = {};
try {
  parsedSettings = serializedSettings ? JSON.parse(serializedSettings) : {};
} catch (e) {
  throw new Error('SITE_SETTINGS is not valid JSON');
}

export const LEAGUE_ID = parsedSettings.LEAGUE_ID;
export const STARTER_POSITION_NAMES = parsedSettings.STARTER_POSITION_NAMES;
if (!LEAGUE_ID || !STARTER_POSITION_NAMES) {
  throw new Error('LEAGUE_ID and STARTER_POSITION_NAMES are required in SITE_SETTINGS. See the README.md file for more information on setting up the site.');
}
export const PREVIOUS_YEARS = parsedSettings.PREVIOUS_YEARS || {};
export const PREVIOUS_ROSTER_OVERRIDES = parsedSettings.PREVIOUS_ROSTER_OVERRIDES || {};
export const LOGO_LETTER_OVERLAY = parsedSettings.LOGO_LETTER_OVERLAY || {};
export const PLAYER_ESPN_MAP_OVERRIDES = parsedSettings.PLAYER_ESPN_MAP_OVERRIDES || {};
export const SEASON_START_DAY = parsedSettings.SEASON_START_DAY || "09/12";

/* LOCAL DEBUG OVERRIDES — leave null before committing.
 * These are the knobs that DateHelper (and therefore home, teams-2, scores,
 * standings, etc.) all read when deciding preseason / current week / offseason.
 *
 * CURRENT_WEEK_OVERRIDE:
 *   Force the active season's NFL week (1–17). When set, getCurrentNFLWeek and
 *   getCompletedWeeksCount for CURRENT_YEAR use this instead of SEASON_START_DAY math.
 *   Example: 8 → pretend we're in week 8 (in-season UI everywhere).
 *
 * PREVIOUS_CURRENT_WEEK_OVERRIDE:
 *   Same idea, but only when browsing a previous season year.
 *
 * HOME_OFFSEASON_OVERRIDE:
 *   null = derive (preseason OR week > 17). true/false = force home off-/in-season layout.
 *
 * SIMULATE_MIDWEEK:
 *   Local only. When true, the current season's scoreboard is rewritten so
 *   a couple of games are Final, a couple are live, and the rest are still
 *   upcoming (~3 finished and ~3 in-play on a typical roster). Locked players
 *   use a stand-in actual (full proj if final, ~half if live) so Scores can
 *   show mixed pts / PROJ. Flip to false when done.
 */
export const CURRENT_WEEK_OVERRIDE = null;
export const PREVIOUS_CURRENT_WEEK_OVERRIDE = null;
export const HOME_OFFSEASON_OVERRIDE = null;
export const SIMULATE_MIDWEEK = true;


// Firebase configuration values (non-secret parts)
export const FIREBASE_AUTH_DOMAIN = parsedSettings.FIREBASE_AUTH_DOMAIN || 'N/A';
export const FIREBASE_PROJECT_ID = parsedSettings.FIREBASE_PROJECT_ID || 'N/A';
export const FIREBASE_STORAGE_BUCKET = parsedSettings.FIREBASE_STORAGE_BUCKET || 'N/A';
export const FIREBASE_DATABASE_URL = parsedSettings.FIREBASE_DATABASE_URL || 'N/A';
export const FIREBASE_API_KEY = parsedSettings.FIREBASE_API_KEY || process.env.REACT_APP_FIREBASE_API_KEY || 'N/A';
export const FIREBASE_LOGIN_EMAIL = parsedSettings.FIREBASE_LOGIN_EMAIL || 'N/A';
export const FIREBASE_LOGIN_PASSWORD = parsedSettings.FIREBASE_LOGIN_PASSWORD || 'N/A';

/* MANUAL SETTINGS */
// Admin toggle: when true, never hit external APIs; read DB only
export const PAUSE_SCRAPES = false; 
// Testing-only: use local example data for NFL scoreboard lookup when true
export const USE_FAKE_EXAMPLE_DATA = false;
// Path should be placed under site/public so it can be fetched by the browser
export const FAKE_SCOREBOARD_PATH = parsedSettings.FAKE_SCOREBOARD_PATH || '/fake_data/espn_scores_api.txt';
// Optional debug logging for scores polling/deltas
export const DEBUG_SCORES_LOG = false;
// Usage logging toggle (default off)
export const ENABLE_USAGE_LOGS = !!parsedSettings.ENABLE_USAGE_LOGS;