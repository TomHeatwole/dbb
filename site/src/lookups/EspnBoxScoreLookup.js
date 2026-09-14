import { PAUSE_SCRAPES } from '../utils/global_constants';
import { writeApiCacheWithKey, readApiCacheLatestByKey } from '../utils/database';
import { getDefaultScoringConfig } from '../data_parse/loadScoringConfig';
import {
  buildEspnLiveBySleeper,
  eventIdsToFetchForBoxScores,
  summaryIsFinal,
  teamStatesFromScoreboard,
} from '../scores/espnBoxScore';
import {
  emptyWeekBox,
  espnBySleeperFromPersisted,
  mergePersistedWeekBox,
  persistChanged,
  slimSummaryForCache,
  summaryCacheKey,
  weekBoxCacheKey,
} from '../scores/espnBoxPersist';
import { overlayEspnOnWeeks, statLinesFromEspn } from '../scores/overlayEspnLiveScores';

const LIVE_TTL_MS = 12_000;
const FINAL_TTL_MS = 30 * 60 * 1000;

const summaryCache = new Map(); // eventId -> { ts, data, final }
let scoringConfigPromise = null;

function summaryUrl(eventId) {
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(eventId)}`;
}

function attachEventId(data, eventId) {
  if (!data || typeof data !== 'object') return data;
  if (data._eventId) return data;
  data._eventId = String(eventId);
  return data;
}

async function readStoredSummary(eventId) {
  try {
    const cached = await readApiCacheLatestByKey(summaryCacheKey(eventId));
    return cached && cached.data ? cached.data : null;
  } catch (_) {
    return null;
  }
}

async function writeStoredSummary(eventId, data) {
  const slim = slimSummaryForCache(data, eventId);
  if (!slim) return;
  try {
    await writeApiCacheWithKey(summaryCacheKey(eventId), summaryUrl(eventId), slim);
  } catch (_) {
    // display store is best-effort
  }
}

export async function fetchEspnGameSummary(eventId) {
  const id = String(eventId || '');
  if (!id) return null;
  const cached = summaryCache.get(id);
  const now = Date.now();
  if (cached && cached.data) {
    const ttl = cached.final ? FINAL_TTL_MS : LIVE_TTL_MS;
    if (now - cached.ts <= ttl) return attachEventId(cached.data, id);
    if (cached.final) return attachEventId(cached.data, id);
  }

  const stored = await readStoredSummary(id);
  if (stored && (summaryIsFinal(stored) || (cached && cached.final))) {
    const data = attachEventId(stored, id);
    summaryCache.set(id, { ts: now, data, final: true });
    return data;
  }
  if (PAUSE_SCRAPES) {
    const fallback = (cached && cached.data) || stored;
    return fallback ? attachEventId(fallback, id) : null;
  }

  try {
    const resp = await fetch(summaryUrl(id));
    if (!resp.ok) {
      const fallback = (cached && cached.data) || stored;
      return fallback ? attachEventId(fallback, id) : null;
    }
    const data = attachEventId(await resp.json(), id);
    const final = summaryIsFinal(data);
    summaryCache.set(id, { ts: now, data, final });
    if (final) await writeStoredSummary(id, data);
    return data;
  } catch (_) {
    const fallback = (cached && cached.data) || stored;
    return fallback ? attachEventId(fallback, id) : null;
  }
}

export async function fetchEspnBoxScoresForEvents(eventIds) {
  const ids = Array.isArray(eventIds) ? eventIds.filter(Boolean).map(String) : [];
  if (!ids.length) return [];
  const rows = await Promise.all(ids.map((id) => fetchEspnGameSummary(id)));
  return rows.filter(Boolean);
}

async function loadScoringConfig() {
  if (!scoringConfigPromise) {
    scoringConfigPromise = getDefaultScoringConfig().catch(() => null);
  }
  return scoringConfigPromise;
}

export async function readPersistedWeekBox(season, week) {
  try {
    const cached = await readApiCacheLatestByKey(weekBoxCacheKey(season, week));
    return cached && cached.data ? cached.data : null;
  } catch (_) {
    return null;
  }
}

async function writePersistedWeekBox(season, week, payload) {
  try {
    await writeApiCacheWithKey(
      weekBoxCacheKey(season, week),
      `espn-box-week://${season}/${week}`,
      payload,
    );
  } catch (_) {
    // best-effort
  }
}

function mergeEspnMaps(persisted, fresh) {
  return {
    ...espnBySleeperFromPersisted(persisted),
    ...(fresh || {}),
  };
}

/**
 * Load stored week box scores, fetch any missing / live / recently-final
 * games, and persist completed rows for the rest of the season.
 */
export async function ensureEspnWeekBox({
  season,
  week,
  scoreboard,
  playerIdMap,
  playersData,
}) {
  const persisted = (await readPersistedWeekBox(season, week)) || emptyWeekBox(season, week);
  if (!scoreboard) {
    const espnBySleeper = espnBySleeperFromPersisted(persisted);
    return {
      espnBySleeper,
      statLines: statLinesFromEspn(espnBySleeper),
      persisted,
    };
  }

  const eventIds = eventIdsToFetchForBoxScores(scoreboard, persisted.eventIds);
  const [summaries, scoringConfig] = await Promise.all([
    eventIds.length ? fetchEspnBoxScoresForEvents(eventIds) : Promise.resolve([]),
    loadScoringConfig(),
  ]);
  const teamStates = teamStatesFromScoreboard(scoreboard);
  const fresh = (summaries.length && scoringConfig)
    ? buildEspnLiveBySleeper({
      summaries,
      playerIdMap,
      playersData,
      scoringConfig,
      teamStates,
    })
    : {};
  const nextPersist = mergePersistedWeekBox(persisted, fresh, season, week);
  if (persistChanged(persisted, nextPersist)) {
    await writePersistedWeekBox(season, week, nextPersist);
  }
  const espnBySleeper = mergeEspnMaps(nextPersist, fresh);
  return {
    espnBySleeper,
    statLines: statLinesFromEspn(espnBySleeper),
    persisted: nextPersist,
  };
}

/**
 * Fetch ESPN box scores for live / missing-final games, overlay league
 * points onto the in-memory Sleeper week, and persist completed rows.
 * Does not write the Sleeper cache.
 */
export async function applyLiveEspnOverlay({
  weeks,
  week,
  season,
  scoreboard,
  playerIdMap,
  playersData,
}) {
  if (!Array.isArray(weeks)) {
    return { weeks, statLines: {} };
  }
  const box = await ensureEspnWeekBox({
    season,
    week,
    scoreboard,
    playerIdMap,
    playersData,
  });
  if (!box || !box.espnBySleeper || !Object.keys(box.espnBySleeper).length) {
    return { weeks, statLines: (box && box.statLines) || {} };
  }
  return {
    weeks: overlayEspnOnWeeks(weeks, week, box.espnBySleeper),
    statLines: box.statLines,
  };
}

export function _resetEspnBoxScoreCacheForTests() {
  summaryCache.clear();
  scoringConfigPromise = null;
}
