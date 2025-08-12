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
export const SEASON_START_DAY = parsedSettings.SEASON_START_DAY || "08/04";

// Only for lcoal override while developing
export const PREVIOUS_CURRENT_WEEK_OVERRIDE = null;