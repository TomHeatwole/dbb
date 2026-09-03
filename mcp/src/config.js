import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse REACT_APP_SITE_SETTINGS (same env var format as the React app)
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
  throw new Error(
    'LEAGUE_ID is required. Set REACT_APP_SITE_SETTINGS or LEAGUE_ID env var. See .env.example.'
  );
}

export const PREVIOUS_YEARS = settings.PREVIOUS_YEARS || {};
export const STARTER_POSITION_NAMES = settings.STARTER_POSITION_NAMES || [];
export const SEASON_START_DAY = '09/09';

// Public URL of the deployed site — used to generate deep links
export const SITE_BASE_URL = (process.env.SITE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

// Path to site/public/data/ where CSV files live
export const DATA_DIR =
  process.env.DATA_DIR || join(__dirname, '..', '..', 'site', 'public', 'data');

// Current season year: max(PREVIOUS_YEARS) + 1, settings-driven (matches the React app logic)
function deriveCurrentYear() {
  const prevYears = Object.keys(PREVIOUS_YEARS)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 1900);
  if (prevYears.length === 0) return String(new Date().getFullYear());
  return String(Math.max(...prevYears) + 1);
}
export const CURRENT_YEAR = deriveCurrentYear();

// Return the Sleeper league ID for a given season string
export function getLeagueIdForSeason(season) {
  const s = String(season);
  return PREVIOUS_YEARS[s] ?? (s === CURRENT_YEAR ? LEAGUE_ID : null);
}
