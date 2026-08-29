import { LEAGUE_ID, PREVIOUS_YEARS, PAUSE_SCRAPES } from '../utils/global_constants';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { writeApiCacheWithKey, readApiCacheLatestByKey, recordRateLimitHit } from '../utils/database';

const LOG_PREFIX = '[sleeper-scoring-settings]';
const SETTINGS_TTL_MS = 24 * 60 * 60 * 1000;

const memoryCache = new Map();

function leagueIdForSeason(season) {
  const currentYear = String(CURRENT_YEAR);
  const normalizedSeason = season === undefined || season === null || season === '' ? currentYear : String(season);
  return PREVIOUS_YEARS[normalizedSeason] ?? (normalizedSeason === currentYear ? LEAGUE_ID : null);
}

function cacheKey(leagueId) {
  return `sleeper_v1_league_${leagueId}_scoring_settings`;
}

/**
 * League scoring_settings from Sleeper (flat stat-key → points map).
 * Failures return null so callers can skip projected fantasy points.
 *
 * @param {string|number} [season]
 * @returns {Promise<Record<string, number>|null>}
 */
export async function fetchLeagueScoringSettings(season) {
  const leagueId = leagueIdForSeason(season);
  if (!leagueId) {
    return null;
  }

  const key = cacheKey(leagueId);
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem && mem.data && now - mem.ts < SETTINGS_TTL_MS) {
    return mem.data;
  }

  try {
    const cached = await readApiCacheLatestByKey(key);
    if (cached && cached.data && typeof cached.data === 'object') {
      const age = now - (cached.ts || 0);
      if (age < SETTINGS_TTL_MS || PAUSE_SCRAPES) {
        memoryCache.set(key, { ts: cached.ts || now, data: cached.data });
        return cached.data;
      }
      memoryCache.set(key, { ts: cached.ts || now, data: cached.data });
    }
  } catch (_) {
    /* fall through */
  }

  if (PAUSE_SCRAPES) {
    return (memoryCache.get(key) && memoryCache.get(key).data) || null;
  }

  const url = `https://api.sleeper.app/v1/league/${leagueId}`;
  try {
    const resp = await fetch(url);
    if (resp.status === 429) {
      try { await recordRateLimitHit('sleeper'); } catch (_) {}
    }
    if (!resp.ok) {
      console.warn(LOG_PREFIX, 'non-200 response', { status: resp.status, url });
      return (memoryCache.get(key) && memoryCache.get(key).data) || null;
    }
    const json = await resp.json();
    const settings = json && json.scoring_settings && typeof json.scoring_settings === 'object'
      ? json.scoring_settings
      : null;
    if (!settings) {
      console.warn(LOG_PREFIX, 'league payload missing scoring_settings', { leagueId });
      return (memoryCache.get(key) && memoryCache.get(key).data) || null;
    }
    memoryCache.set(key, { ts: now, data: settings });
    try {
      await writeApiCacheWithKey(key, url, settings);
    } catch (_) {
      /* ignore */
    }
    return settings;
  } catch (err) {
    console.warn(LOG_PREFIX, 'fetch failed', { url, error: err && err.message ? err.message : String(err) });
    return (memoryCache.get(key) && memoryCache.get(key).data) || null;
  }
}

export default fetchLeagueScoringSettings;
