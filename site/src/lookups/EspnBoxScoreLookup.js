import { PAUSE_SCRAPES } from '../utils/global_constants';
import { getDefaultScoringConfig } from '../data_parse/loadScoringConfig';
import {
  buildEspnLiveBySleeper,
  eventIdsForBoxScores,
  teamStatesFromScoreboard,
} from '../scores/espnBoxScore';
import { overlayEspnOnWeeks, statLinesFromEspn } from '../scores/overlayEspnLiveScores';

const LIVE_TTL_MS = 12_000;
const FINAL_TTL_MS = 30 * 60 * 1000;

const summaryCache = new Map(); // eventId -> { ts, data, final }
let scoringConfigPromise = null;

function summaryUrl(eventId) {
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(eventId)}`;
}

export async function fetchEspnGameSummary(eventId) {
  const id = String(eventId || '');
  if (!id) return null;
  const cached = summaryCache.get(id);
  const now = Date.now();
  if (cached && cached.data) {
    const ttl = cached.final ? FINAL_TTL_MS : LIVE_TTL_MS;
    if (now - cached.ts <= ttl) return cached.data;
  }
  if (PAUSE_SCRAPES) return cached && cached.data ? cached.data : null;
  try {
    const resp = await fetch(summaryUrl(id));
    if (!resp.ok) return cached && cached.data ? cached.data : null;
    const data = await resp.json();
    const header = data && data.header;
    const comps = header && Array.isArray(header.competitions) ? header.competitions : [];
    const type = (comps[0] && comps[0].status && comps[0].status.type)
      || (header && header.status && header.status.type)
      || {};
    const state = String(type.state || '').toLowerCase();
    const final = state === 'post' || type.completed === true;
    summaryCache.set(id, { ts: now, data, final });
    return data;
  } catch (_) {
    return cached && cached.data ? cached.data : null;
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

/**
 * Fetch ESPN box scores for live / recently-final games and overlay league
 * points onto the in-memory Sleeper week. Does not write the Sleeper cache.
 */
export async function applyLiveEspnOverlay({
  weeks,
  week,
  scoreboard,
  playerIdMap,
  playersData,
}) {
  if (!Array.isArray(weeks) || !scoreboard) {
    return { weeks, statLines: {} };
  }
  const eventIds = eventIdsForBoxScores(scoreboard);
  if (!eventIds.length) {
    return { weeks, statLines: {} };
  }
  const [summaries, scoringConfig] = await Promise.all([
    fetchEspnBoxScoresForEvents(eventIds),
    loadScoringConfig(),
  ]);
  if (!summaries.length || !scoringConfig) {
    return { weeks, statLines: {} };
  }
  const teamStates = teamStatesFromScoreboard(scoreboard);
  const espnBySleeper = buildEspnLiveBySleeper({
    summaries,
    playerIdMap,
    playersData,
    scoringConfig,
    teamStates,
  });
  return {
    weeks: overlayEspnOnWeeks(weeks, week, espnBySleeper),
    statLines: statLinesFromEspn(espnBySleeper),
  };
}

export function _resetEspnBoxScoreCacheForTests() {
  summaryCache.clear();
  scoringConfigPromise = null;
}
