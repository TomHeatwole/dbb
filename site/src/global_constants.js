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
export const PLAYER_ESPN_MAP_OVERRIDES = parsedSettings.PLAYER_ESPN_MAP_OVERRIDES || {};
export const SEASON_START_DAY = parsedSettings.SEASON_START_DAY || "09/04";

// Only for lcoal override while developing
export const PREVIOUS_CURRENT_WEEK_OVERRIDE = null;

// Testing-only: use local example data for NFL scoreboard lookup when true
export const USE_FAKE_EXAMPLE_DATA = false;
// Path should be placed under site/public so it can be fetched by the browser
export const FAKE_SCOREBOARD_PATH = parsedSettings.FAKE_SCOREBOARD_PATH || '/fake_data/espn_scores_api.txt';