import { join } from 'path';
import { existsSync } from 'fs';

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

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const candidates = [
    join(process.cwd(), 'public', 'data'),
    join(process.cwd(), 'site', 'public', 'data'),
  ];
  return candidates.find(existsSync) ?? candidates[0];
}
export const DATA_DIR = resolveDataDir();

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
