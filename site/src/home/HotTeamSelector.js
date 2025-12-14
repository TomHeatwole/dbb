import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData } from '../lookups/TeamLookup';

export const HOT_TEAM_OVERRIDE_ROSTER_ID = null;

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

  const targetWeek = Math.max(1, currentWeek - 1);

  const [weeksData, teamData] = await Promise.all([
    fetchScoresData(season),
    fetchTeamData(season),
  ]);

  if (!weeksData || !Array.isArray(weeksData)) {
    throw new Error('No scores data');
  }
  if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
    throw new Error('No team data');
  }

  const weekArrRaw =
    Array.isArray(weeksData[targetWeek - 1]) && weeksData[targetWeek - 1]
      ? weeksData[targetWeek - 1]
      : [];
  const weekArr = weekArrRaw.filter(
    (entry) => entry && entry.roster_id != null && typeof entry.points === 'number',
  );

  if (!weekArr.length) {
    return {
      hotTeam: null,
      week: targetWeek,
    };
  }

  let rosterIdForHotTeam = null;
  let pointsForWeek = null;

  if (HOT_TEAM_OVERRIDE_ROSTER_ID != null) {
    const overrideIdNum = Number(HOT_TEAM_OVERRIDE_ROSTER_ID);
    const overrideEntry = weekArr.find(
      (entry) => Number(entry.roster_id) === overrideIdNum,
    );

    if (
      !overrideEntry ||
      typeof overrideEntry.points !== 'number' ||
      !Number.isFinite(overrideEntry.points)
    ) {
      return {
        hotTeam: null,
        week: targetWeek,
      };
    }

    rosterIdForHotTeam = overrideIdNum;
    pointsForWeek = overrideEntry.points;
  } else {
    let best = null;

    weekArr.forEach((entry) => {
      const pts = Number.isFinite(entry.points) ? entry.points : 0;
      if (!best || pts > best.points) {
        best = { rosterId: Number(entry.roster_id), points: pts };
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
      const wkArrRawInner =
        Array.isArray(weeksData[wk - 1]) && weeksData[wk - 1]
          ? weeksData[wk - 1]
          : [];
      const wkArrInner = wkArrRawInner.filter(
        (entry) => entry && Number(entry.roster_id) === Number(rosterIdForHotTeam),
      );
      if (wkArrInner.length === 0) {
        continue;
      }
      const entry = wkArrInner[0];
      if (typeof entry.points === 'number' && Number.isFinite(entry.points)) {
        temp.push({ week: wk, points: entry.points });
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


