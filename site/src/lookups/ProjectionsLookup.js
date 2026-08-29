import { PAUSE_SCRAPES } from '../utils/global_constants';
import { writeApiCacheWithKey, readApiCacheLatestByKey, recordRateLimitHit } from '../utils/database';

const LOG_PREFIX = '[sleeper-projections]';
const DEFAULT_SEASON_TYPE = 'regular';
const PROJECTIONS_TTL_MS = 6 * 60 * 60 * 1000;

const memoryCache = new Map();

/**
 * @typedef {Object} SleeperPlayerProjection
 * @property {string} player_id
 * @property {Record<string, number|string|null>} stats  full Sleeper stats object
 * @property {string|null} [team]
 * @property {string|null} [opponent]
 * @property {string|null} [game_id]
 * @property {string|null} [company]
 * @property {string|number|null} [week]
 * @property {string|number|null} [season]
 * @property {string|null} [season_type]
 */

/**
 * @typedef {Object} SleeperWeeklyProjections
 * @property {string} season
 * @property {number} week
 * @property {string} seasonType
 * @property {number|null} fetchedAt
 * @property {Record<string, SleeperPlayerProjection>} byPlayerId
 */

function cacheKey(season, week, seasonType) {
  return `sleeper_projections_nfl_${season}_${week}_${seasonType}`;
}

function projectionsUrl(season, week, seasonType) {
  return `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=${encodeURIComponent(seasonType)}`;
}

function emptyResult(season, week, seasonType, fetchedAt = null) {
  return {
    season: String(season),
    week: Number(week),
    seasonType,
    fetchedAt,
    byPlayerId: {},
  };
}

function logShapeChange(message, extra) {
  if (extra !== undefined) {
    console.warn(LOG_PREFIX, message, extra);
  } else {
    console.warn(LOG_PREFIX, message);
  }
}

/**
 * Normalize one raw Sleeper projection row. Stores the full `stats` object
 * without assuming which counting-stat keys exist.
 * @param {unknown} row
 * @returns {SleeperPlayerProjection|null}
 */
export function normalizeSleeperProjectionRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const playerId = row.player_id != null ? String(row.player_id) : '';
  if (!playerId) {
    return null;
  }
  const stats = row.stats && typeof row.stats === 'object' && !Array.isArray(row.stats)
    ? row.stats
    : {};
  return {
    player_id: playerId,
    stats,
    team: row.team != null ? String(row.team) : null,
    opponent: row.opponent != null ? String(row.opponent) : null,
    game_id: row.game_id != null ? String(row.game_id) : null,
    company: row.company != null ? String(row.company) : null,
    week: row.week != null ? row.week : null,
    season: row.season != null ? row.season : null,
    season_type: row.season_type != null ? String(row.season_type) : null,
  };
}

/**
 * @param {unknown} payload
 * @param {string|number} season
 * @param {string|number} week
 * @param {string} seasonType
 * @param {number|null} [fetchedAt]
 * @returns {SleeperWeeklyProjections}
 */
export function parseSleeperWeeklyProjections(payload, season, week, seasonType, fetchedAt = null) {
  const result = emptyResult(season, week, seasonType, fetchedAt);
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.byPlayerId && typeof payload.byPlayerId === 'object') {
    result.byPlayerId = payload.byPlayerId;
    return result;
  }
  if (!Array.isArray(payload)) {
    logShapeChange('expected an array of player projections', {
      season: String(season),
      week: Number(week),
      type: payload == null ? 'null' : typeof payload,
    });
    return result;
  }

  let skipped = 0;
  for (const row of payload) {
    const normalized = normalizeSleeperProjectionRow(row);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    result.byPlayerId[normalized.player_id] = normalized;
  }
  if (payload.length > 0 && skipped === payload.length) {
    logShapeChange('no rows had player_id; response shape may have changed', {
      season: String(season),
      week: Number(week),
      length: payload.length,
    });
  } else if (payload.length > 0) {
    const sample = payload.find((row) => row && typeof row === 'object');
    if (sample && !sample.stats) {
      logShapeChange('sample row is missing stats', {
        season: String(season),
        week: Number(week),
        keys: Object.keys(sample),
      });
    }
  }
  return result;
}

function remember(key, data, ts) {
  memoryCache.set(key, { ts: ts || Date.now(), data });
  return data;
}

/**
 * Fetch Sleeper NFL weekly player projections.
 * Unofficial endpoint — failures return an empty map and never throw.
 *
 * @param {string|number} season
 * @param {string|number} week
 * @param {{ seasonType?: string, forceUpdate?: boolean }} [options]
 * @returns {Promise<SleeperWeeklyProjections>}
 */
export async function getSleeperWeeklyProjections(season, week, options = {}) {
  const seasonType = options.seasonType || DEFAULT_SEASON_TYPE;
  const weekNum = Number(week);
  if (!season || !Number.isFinite(weekNum) || weekNum < 1) {
    return emptyResult(season || '', weekNum || 0, seasonType);
  }

  const key = cacheKey(season, weekNum, seasonType);
  const url = projectionsUrl(season, weekNum, seasonType);
  const now = Date.now();

  if (!options.forceUpdate) {
    const mem = memoryCache.get(key);
    if (mem && mem.data && now - mem.ts < PROJECTIONS_TTL_MS) {
      return mem.data;
    }

    try {
      const cached = await readApiCacheLatestByKey(key);
      if (cached && cached.data) {
        const parsed = parseSleeperWeeklyProjections(cached.data, season, weekNum, seasonType, cached.ts || null);
        const age = now - (cached.ts || 0);
        if (age < PROJECTIONS_TTL_MS || PAUSE_SCRAPES) {
          return remember(key, parsed, cached.ts || now);
        }
        remember(key, parsed, cached.ts || now);
      }
    } catch (_) {
      /* fall through to network */
    }
  }

  if (PAUSE_SCRAPES) {
    const mem = memoryCache.get(key);
    return mem && mem.data ? mem.data : emptyResult(season, weekNum, seasonType);
  }

  try {
    const resp = await fetch(url);
    if (resp.status === 429) {
      try { await recordRateLimitHit('sleeper'); } catch (_) {}
    }
    if (!resp.ok) {
      console.warn(LOG_PREFIX, 'non-200 response', { status: resp.status, url });
      const mem = memoryCache.get(key);
      return mem && mem.data ? mem.data : emptyResult(season, weekNum, seasonType);
    }
    const json = await resp.json();
    const parsed = parseSleeperWeeklyProjections(json, season, weekNum, seasonType, now);
    remember(key, parsed, now);
    try {
      await writeApiCacheWithKey(key, url, parsed);
    } catch (_) {
      /* cache write is best-effort */
    }
    return parsed;
  } catch (err) {
    console.warn(LOG_PREFIX, 'fetch failed', { url, error: err && err.message ? err.message : String(err) });
    const mem = memoryCache.get(key);
    return mem && mem.data ? mem.data : emptyResult(season, weekNum, seasonType);
  }
}

export default getSleeperWeeklyProjections;
