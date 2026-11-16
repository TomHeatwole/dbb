/**
 * Shared cache + loader for HProj playoff field (playoff predictions page + standings).
 * While an NFL game is live on the board: always recompute (no memory/Neon hits).
 * Between live windows: first load banks the full field to Neon; later loads reuse it.
 */

import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { fetchInjuriesForWeek } from '../lookups/InjuryLookup';
import { fetchPlayerIdMap, fetchPlayersData } from '../lookups/PlayerLookup';
import { getSleeperWeeklyProjections } from '../lookups/ProjectionsLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchLeagueScoringSettings } from '../lookups/ScoringSettingsLookup';
import { buildRosterIdToTeamInfoMap, fetchTeamData } from '../lookups/TeamLookup';
import { REG_SEASON_WEEKS } from '../scenarios/simulatorLineup';
import { isScoreboardWeekHasLiveGame } from '../scores/GamesParser';
import { CURRENT_YEAR, getCompletedWeeksCount, getCurrentNFLWeek } from '../utils/DateHelper';
import { PLAYOFF_LAST_WEEK } from './playoffHprojOdds';
import { runPlayoffHproj } from './runPlayoffHproj';

export const FIELD_CACHE_MS = 10 * 60 * 1000;
export const FIELD_CACHE_VERSION = 6;

let fieldCache = null;
let loadPromise = null;
/** Set during load; peek skips memory cache while a game is live. */
let nflWeekHasLiveGame = false;

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

/** Drop Monte Carlo replay blobs; rows + teamMap are enough for standings and the main table. */
function viewForNeonBank(view) {
  if (!view || !view.field) return view;
  const { simTeams: _simTeams, ...fieldRest } = view.field;
  return { ...view, field: { ...fieldRest, simTeams: undefined } };
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

export function peekPlayoffHprojField(season) {
  if (Number(season) !== Number(CURRENT_YEAR)) return null;
  if (nflWeekHasLiveGame) return null;
  const key = cacheKeyForSeason(season);
  if (fieldCache && fieldCache.key === key && Date.now() - fieldCache.at < FIELD_CACHE_MS) {
    return fieldCache.view;
  }
  return null;
}

/** @returns {Record<number, { playoffPct: number, winPctIfMade: number }>} */
export function oddsByRosterFromField(field) {
  const byRoster = {};
  if (!field || !Array.isArray(field.rows)) return byRoster;
  for (const row of field.rows) {
    const rid = Number(row.rosterId ?? row.id);
    if (!Number.isFinite(rid)) continue;
    byRoster[rid] = {
      playoffPct: Number(row.playoffPct) || 0,
      winPctIfMade: Number(row.winPctIfMade) || 0,
    };
  }
  return byRoster;
}

/**
 * @param {number|string} season
 * @param {{ cancelled?: () => boolean }} [opts]
 * @returns {Promise<{ season: number, teamMap: object, field: object } | null>}
 */
export async function loadPlayoffHprojField(season, opts = {}) {
  const seasonNum = Number(season);
  if (seasonNum !== Number(CURRENT_YEAR)) return null;

  if (loadPromise) {
    return loadPromise;
  }

  const cancelled = opts.cancelled || (() => false);

  loadPromise = (async () => {
    const currentWeek = getCurrentNFLWeek(seasonNum);
    const bankedThrough = Math.min(REG_SEASON_WEEKS, getCompletedWeeksCount(seasonNum));
    const cacheKey = cacheKeyForSeason(seasonNum);

    const currentScoreboard = await fetchNflScoreboard(seasonNum, currentWeek, { forceUpdate: true })
      .catch(() => null);
    if (cancelled()) return null;

    const hasLiveGame = isScoreboardWeekHasLiveGame(currentScoreboard);
    nflWeekHasLiveGame = hasLiveGame;
    if (hasLiveGame) {
      fieldCache = null;
    } else {
      const cached = peekPlayoffHprojField(seasonNum);
      if (cached) return cached;
    }

    if (!hasLiveGame) {
      const neonView = await fetchNeonPlayoffHprojCache(seasonNum, cacheKey);
      if (cancelled()) return null;
      if (neonView) {
        const view = {
          season: seasonNum,
          teamMap: neonView.teamMap || {},
          field: neonView.field || neonView,
        };
        fieldCache = { key: cacheKey, view, at: Date.now() };
        return view;
      }
    }

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
    if (cancelled()) return null;

    const playersData = await fetchPlayersData(teamData.rosters, { week: currentWeek });
    if (cancelled()) return null;

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
    if (cancelled()) return null;

    const teamMap = buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users);
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
      cancelled,
      labelForRoster: (roster) => {
        const info = teamMap[roster.roster_id] || teamMap[Number(roster.roster_id)];
        return (info && info.teamName) || `Team ${roster.roster_id}`;
      },
    });
    if (cancelled() || !field) return null;

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
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}