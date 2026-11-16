/**
 * Shared cache + loader for HProj playoff field (playoff predictions page + standings).
 */

import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { fetchInjuriesForWeek } from '../lookups/InjuryLookup';
import { fetchPlayerIdMap, fetchPlayersData } from '../lookups/PlayerLookup';
import { getSleeperWeeklyProjections } from '../lookups/ProjectionsLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchLeagueScoringSettings } from '../lookups/ScoringSettingsLookup';
import { buildRosterIdToTeamInfoMap, fetchTeamData } from '../lookups/TeamLookup';
import { REG_SEASON_WEEKS } from '../scenarios/simulatorLineup';
import { CURRENT_YEAR, getCompletedWeeksCount, getCurrentNFLWeek } from '../utils/DateHelper';
import { PLAYOFF_LAST_WEEK } from './playoffHprojOdds';
import { runPlayoffHproj } from './runPlayoffHproj';

export const FIELD_CACHE_MS = 10 * 60 * 1000;
export const FIELD_CACHE_VERSION = 5;

let fieldCache = null;
let loadPromise = null;

function cacheKeyForSeason(season) {
  const currentWeek = getCurrentNFLWeek(season);
  const bankedThrough = Math.min(REG_SEASON_WEEKS, getCompletedWeeksCount(season));
  return `${FIELD_CACHE_VERSION}:${season}:${bankedThrough}:${currentWeek}`;
}

export function peekPlayoffHprojField(season) {
  if (Number(season) !== Number(CURRENT_YEAR)) return null;
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

  const cached = peekPlayoffHprojField(seasonNum);
  if (cached) return cached;

  if (loadPromise) {
    return loadPromise;
  }

  const cancelled = opts.cancelled || (() => false);

  loadPromise = (async () => {
    const currentWeek = getCurrentNFLWeek(seasonNum);
    const bankedThrough = Math.min(REG_SEASON_WEEKS, getCompletedWeeksCount(seasonNum));
    const cacheKey = cacheKeyForSeason(seasonNum);

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
        fetchNflScoreboard(seasonNum, week).catch(() => null),
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
    fieldCache = { key: cacheKey, view, at: Date.now() };
    return view;
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}