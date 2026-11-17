/**
 * Shared cache + loader for HProj playoff field (playoff predictions page + standings).
 * During a live NFL game: always recompute; never read Neon or memory cache.
 * Otherwise: saved field first, then sim once and bank.
 * A miss runs the sim once and banks it, including when a caller unmounts.
 */

import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { fetchInjuriesForWeek } from '../lookups/InjuryLookup';
import { fetchPlayerIdMap, fetchPlayersData } from '../lookups/PlayerLookup';
import { getSleeperWeeklyProjections } from '../lookups/ProjectionsLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchLeagueScoringSettings } from '../lookups/ScoringSettingsLookup';
import { buildRosterIdToTeamInfoMap, fetchTeamData } from '../lookups/TeamLookup';
import { isScoreboardWeekHasLiveGame } from '../scores/GamesParser';
import { REG_SEASON_WEEKS } from '../scenarios/simulatorLineup';
import { CURRENT_YEAR, getCompletedWeeksCount, getCurrentNFLWeek } from '../utils/DateHelper';
import { PLAYOFF_LAST_WEEK } from './playoffHprojOdds';
import { runPlayoffHproj } from './runPlayoffHproj';

export const FIELD_CACHE_MS = 10 * 60 * 1000;
export const FIELD_CACHE_VERSION = 9;

let fieldCache = null;
let loadPromise = null;
/** Set during load; peek skips memory cache while a game is live. */
let nflWeekHasLiveGame = false;
const progressListeners = new Set();

function reportProgress(label) {
  for (const fn of progressListeners) {
    try { fn(label); } catch (_) { /* listener */ }
  }
}

function usableCachedView(raw, seasonNum) {
  if (!raw || typeof raw !== 'object') return null;
  const field = raw.field && typeof raw.field === 'object' ? raw.field : null;
  if (!field || field._placeholder) return null;
  if (!Array.isArray(field.rows) || field.rows.length === 0) return null;
  if (!Array.isArray(field.weeks)) return null;
  return {
    season: Number(raw.season) || seasonNum,
    teamMap: raw.teamMap || {},
    field,
  };
}

function cacheKeyForSeason(season) {
  const currentWeek = getCurrentNFLWeek(season);
  const bankedThrough = Math.min(REG_SEASON_WEEKS, getCompletedWeeksCount(season));
  return `${FIELD_CACHE_VERSION}:${season}:${bankedThrough}:${currentWeek}`;
}

async function fetchNeonPlayoffHprojCache(season, cacheKey) {
  try {
    const params = new URLSearchParams({
      playoffHproj: '1',
      season: String(season),
      cacheKey,
    });
    const res = await fetch(`/api/playoff-hproj?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.cacheValid || !data.view) return null;
    if (data.cacheKey && data.cacheKey !== cacheKey) return null;
    return data.view;
  } catch (_) {
    return null;
  }
}

function fieldHasSelectFourSim(field) {
  return Boolean(
    field
    && Array.isArray(field.simTeams)
    && field.simTeams.length > 0
    && field.replaySeed,
  );
}

function fieldHasBreakdownWeeks(field) {
  if (!field || !Array.isArray(field.rows) || !field.rows.length) return false;
  return field.rows.some((row) => Array.isArray(row.weeks) && row.weeks.length > 0);
}

function fieldReadyForPlayoffPage(field) {
  return fieldHasSelectFourSim(field) && fieldHasBreakdownWeeks(field);
}

/** Bank full field (including row week cells and simTeams for select-four reruns). */
function viewForNeonBank(view) {
  if (!view || !view.field) return view;
  return view;
}

async function saveNeonPlayoffHprojCache(season, cacheKey, bankedThrough, currentWeek, view) {
  try {
    const res = await fetch('/api/playoff-hproj?playoffHproj=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        season,
        cacheKey,
        bankedThrough,
        currentWeek,
        view: viewForNeonBank(view),
      }),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

export function peekPlayoffHprojField(season) {
  if (Number(season) !== Number(CURRENT_YEAR)) return null;
  if (nflWeekHasLiveGame) return null;
  const key = cacheKeyForSeason(season);
  if (fieldCache && fieldCache.key === key && Date.now() - fieldCache.at < FIELD_CACHE_MS) {
    return fieldCache.view;
  }
  return null;
}

/** @returns {Record<number, { playoffPct: number, winPctIfMade: number, playoffMadeCount?: number, winCount?: number, iterations?: number }>} */
export function oddsByRosterFromField(field) {
  const byRoster = {};
  if (!field || !Array.isArray(field.rows)) return byRoster;
  const iterations = Number(field.iterations) || 0;
  for (const row of field.rows) {
    const rid = Number(row.rosterId ?? row.id);
    if (!Number.isFinite(rid)) continue;
    byRoster[rid] = {
      playoffPct: Number(row.playoffPct) || 0,
      winPct: Number(row.winPct) || 0,
      winPctIfMade: Number(row.winPctIfMade) || 0,
      playoffMadeCount: row.playoffMadeCount,
      winCount: row.winCount,
      iterations,
    };
  }
  return byRoster;
}

async function invalidateNeonPlayoffHprojCache(season) {
  try {
    await fetch('/api/playoff-hproj?playoffHproj=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invalidate', season }),
    });
  } catch (_) {
    /* best-effort */
  }
}

async function computePlayoffField(seasonNum, opts = {}) {
  const currentWeek = getCurrentNFLWeek(seasonNum);
  const bankedThrough = Math.min(REG_SEASON_WEEKS, getCompletedWeeksCount(seasonNum));
  const cacheKey = cacheKeyForSeason(seasonNum);

  reportProgress('Checking for live NFL games…');
  const currentScoreboard = await fetchNflScoreboard(seasonNum, currentWeek, {
    forceUpdate: true,
    maxAgeMs: 15_000,
  }).catch(() => null);
  const hasLiveGame = isScoreboardWeekHasLiveGame(currentScoreboard);
  nflWeekHasLiveGame = hasLiveGame;
  if (hasLiveGame) {
    fieldCache = null;
    invalidateNeonPlayoffHprojCache(seasonNum);
  }

  if (!hasLiveGame) {
    reportProgress('Loading saved odds…');
    const cachedNow = peekPlayoffHprojField(seasonNum);
    if (cachedNow && (!opts.requireSimTeams || fieldReadyForPlayoffPage(cachedNow.field))) {
      return cachedNow;
    }

    const neonView = usableCachedView(
      await fetchNeonPlayoffHprojCache(seasonNum, cacheKey),
      seasonNum,
    );
    if (neonView && (!opts.requireSimTeams || fieldReadyForPlayoffPage(neonView.field))) {
      fieldCache = { key: cacheKey, view: neonView, at: Date.now() };
      return neonView;
    }
  }

  reportProgress('Loading scores and projections…');

  const weekNums = [];
  for (let week = bankedThrough + 1; week <= PLAYOFF_LAST_WEEK; week += 1) {
    weekNums.push(week);
  }

  const [teamData, weeksData, scoring, playerIdMap] = await Promise.all([
    fetchTeamData(seasonNum),
    fetchScoresData(seasonNum),
    fetchLeagueScoringSettings(seasonNum),
    fetchPlayerIdMap(),
  ]);
  const playersData = await fetchPlayersData(teamData.rosters, { week: currentWeek });

  const regRemaining = weekNums.filter((week) => week <= REG_SEASON_WEEKS);
  const injuriesMap = regRemaining.includes(currentWeek)
    ? await fetchInjuriesForWeek(seasonNum, currentWeek).catch(() => ({}))
    : {};

  const weekBundles = await Promise.all(weekNums.map(async (week) => {
    const [proj, scoreboard] = await Promise.all([
      getSleeperWeeklyProjections(seasonNum, week),
      week === currentWeek && currentScoreboard
        ? Promise.resolve(currentScoreboard)
        : fetchNflScoreboard(seasonNum, week).catch(() => null),
    ]);
    return {
      week,
      byPlayerId: proj && proj.byPlayerId ? proj.byPlayerId : {},
      scoreboard,
    };
  }));
  const teamMap = buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users);
  reportProgress('Running the season…');
  const field = await runPlayoffHproj({
    season: seasonNum,
    rosters: teamData.rosters,
    weeksData,
    playersData,
    playerIdMap,
    scoring,
    injuriesMap: injuriesMap || {},
    weekBundles,
    bankedThrough,
    currentWeek,
    onProgress: reportProgress,
    labelForRoster: (roster) => {
      const info = teamMap[roster.roster_id] || teamMap[Number(roster.roster_id)];
      return (info && info.teamName) || `Team ${roster.roster_id}`;
    },
  });
  if (!field) return null;

  const view = { season: seasonNum, teamMap, field };

  if (!hasLiveGame) {
    const banked = await saveNeonPlayoffHprojCache(
      seasonNum,
      cacheKey,
      bankedThrough,
      currentWeek,
      view,
    );
    if (banked) {
      fieldCache = { key: cacheKey, view, at: Date.now() };
    }
  }

  return view;
}

/**
 * @param {number|string} season
 * @param {{ cancelled?: () => boolean, onProgress?: (label: string) => void }} [opts]
 * @returns {Promise<{ season: number, teamMap: object, field: object } | null>}
 */
export async function loadPlayoffHprojField(season, opts = {}) {
  const seasonNum = Number(season);
  if (seasonNum !== Number(CURRENT_YEAR)) return null;

  if (opts.onProgress) progressListeners.add(opts.onProgress);
  try {
    if (!loadPromise) {
      loadPromise = computePlayoffField(seasonNum, opts).finally(() => {
        loadPromise = null;
      });
    }
    const view = await loadPromise;
    if (opts.cancelled?.()) return null;
    return view;
  } finally {
    if (opts.onProgress) progressListeners.delete(opts.onProgress);
  }
}