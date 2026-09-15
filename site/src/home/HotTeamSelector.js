import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { StartSitSort } from '../players/StartSitDecider';
import { getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';

export const HOT_TEAM_OVERRIDE_ROSTER_ID = null;

function computeHwangWeekScores(
  weeksData,
  weekNum,
  playersData,
  playerIdMap,
  playerSeasonTotalsMap,
  rosters,
) {
  const breakdown = getWeekScoreBreakdown(weeksData, weekNum, rosters) || {};
  const weekEntries = Array.isArray(weeksData[weekNum - 1]) ? weeksData[weekNum - 1] : [];
  const scores = new Map();

  weekEntries.forEach((entry) => {
    if (!entry || entry.roster_id == null) return;
    const rid = Number(entry.roster_id);
    if (!Number.isFinite(rid)) return;

    const raw = breakdown[rid];
    let pts = 0;
    if (raw) {
      const computed = StartSitSort(raw, playersData, playerIdMap, null, null, playerSeasonTotalsMap);
      if (computed && typeof computed.starterTotal === 'number') {
        pts = Math.round(computed.starterTotal * 10) / 10;
      }
    } else if (typeof entry.points === 'number' && Number.isFinite(entry.points)) {
      pts = Math.round(entry.points * 10) / 10;
    }

    scores.set(rid, pts);
  });

  return scores;
}

export async function selectHotTeam(options = {}) {
  const season = CURRENT_YEAR;
  const rawOverrideWeek =
    options && Object.prototype.hasOwnProperty.call(options, 'currentWeekOverride')
      ? options.currentWeekOverride
      : null;

  let currentWeek = getCurrentNFLWeek(season);

  if (rawOverrideWeek != null) {
    const parsed = Number(rawOverrideWeek);
    if (Number.isFinite(parsed) && parsed > 0) {
      currentWeek = parsed;
    }
  }

  if (currentWeek <= 1) {
    return { hotTeam: null, week: null };
  }

  const targetWeek = currentWeek - 1;

  const [weeksData, teamData, playerIdMap] = await Promise.all([
    fetchScoresData(season),
    fetchTeamData(season),
    fetchPlayerIdMap(),
  ]);

  if (!weeksData || !Array.isArray(weeksData)) {
    throw new Error('No scores data');
  }
  if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
    throw new Error('No team data');
  }

  const playersData = await fetchPlayersData(teamData.rosters);
  const playerSeasonTotalsMap = getPlayerSeasonTotalsMap(weeksData);
  const rosters = teamData.rosters;

  const targetWeekScores = computeHwangWeekScores(
    weeksData,
    targetWeek,
    playersData,
    playerIdMap,
    playerSeasonTotalsMap,
    rosters,
  );

  if (!targetWeekScores.size) {
    return {
      hotTeam: null,
      week: targetWeek,
    };
  }

  let rosterIdForHotTeam = null;
  let pointsForWeek = null;

  if (HOT_TEAM_OVERRIDE_ROSTER_ID != null) {
    const overrideIdNum = Number(HOT_TEAM_OVERRIDE_ROSTER_ID);
    const overridePoints = targetWeekScores.get(overrideIdNum);

    if (typeof overridePoints !== 'number' || !Number.isFinite(overridePoints)) {
      return {
        hotTeam: null,
        week: targetWeek,
      };
    }

    rosterIdForHotTeam = overrideIdNum;
    pointsForWeek = overridePoints;
  } else {
    let best = null;

    targetWeekScores.forEach((points, rosterId) => {
      if (!best || points > best.points) {
        best = { rosterId, points };
      }
    });

    if (!best) {
      return {
        hotTeam: null,
        week: targetWeek,
      };
    }

    rosterIdForHotTeam = best.rosterId;
    pointsForWeek = best.points;
  }

  const roster = teamData.rosters.find(
    (r) => String(r.roster_id) === String(rosterIdForHotTeam),
  );
  const user =
    roster && teamData.users
      ? teamData.users.find(
          (u) => String(u.user_id) === String(roster.owner_id),
        )
      : null;

  let teamName = `Team ${rosterIdForHotTeam}`;
  if (user && user.metadata && user.metadata.team_name) {
    teamName = user.metadata.team_name;
  } else if (user && user.display_name) {
    teamName = `Team ${user.display_name}`;
  }

  const avatarUrl =
    (user &&
      (user.team_avatar_url ||
        user.user_avatar_url ||
        user.avatar_url)) ||
    null;

  let recent = null;
  if (targetWeek >= 2) {
    const startWeek = Math.max(1, targetWeek - 2);
    const temp = [];
    for (let wk = startWeek; wk <= targetWeek; wk += 1) {
      const weekScores = computeHwangWeekScores(
        weeksData,
        wk,
        playersData,
        playerIdMap,
        playerSeasonTotalsMap,
        rosters,
      );
      const pts = weekScores.get(Number(rosterIdForHotTeam));
      if (typeof pts === 'number' && Number.isFinite(pts)) {
        temp.push({ week: wk, points: pts });
      }
    }
    if (temp.length >= 2) {
      recent = temp;
    }
  }

  return {
    hotTeam: {
      rosterId: rosterIdForHotTeam,
      teamName,
      avatarUrl,
      week: targetWeek,
      points: pointsForWeek,
      recent,
    },
    week: targetWeek,
  };
}
