import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let settings = {};
const raw = process.env.REACT_APP_SITE_SETTINGS || process.env.SITE_SETTINGS;
if (raw) {
  try {
    settings = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid SITE_SETTINGS JSON: ${e.message}`);
  }
}

export const LEAGUE_ID = settings.LEAGUE_ID || process.env.LEAGUE_ID;
if (!LEAGUE_ID) {
  throw new Error('LEAGUE_ID is required. Set REACT_APP_SITE_SETTINGS or LEAGUE_ID env var.');
}

export const PREVIOUS_YEARS = settings.PREVIOUS_YEARS || {};
export const STARTER_POSITION_NAMES = settings.STARTER_POSITION_NAMES || [];
export const SEASON_START_DAY = settings.SEASON_START_DAY || settings.SEASON_START_DATE || '09/04';

export const SITE_BASE_URL = (process.env.SITE_BASE_URL || 'https://www.hwangdynasty.com').replace(/\/$/, '');

// From api/mcp/, go up two levels to reach site/, then into public/data/
export const DATA_DIR =
  process.env.DATA_DIR || join(__dirname, '..', '..', 'public', 'data');

function deriveCurrentYear() {
  const prevYears = Object.keys(PREVIOUS_YEARS)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 1900);
  if (prevYears.length === 0) return String(new Date().getFullYear());
  return String(Math.max(...prevYears) + 1);
}
export const CURRENT_YEAR = deriveCurrentYear();

export function getLeagueIdForSeason(season) {
  const s = String(season);
  return PREVIOUS_YEARS[s] ?? (s === CURRENT_YEAR ? LEAGUE_ID : null);
}
