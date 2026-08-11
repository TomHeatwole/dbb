import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import { CURRENT_YEAR, getCompletedWeeksCount } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { StartSitSort } from '../players/StartSitDecider';
import { getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { useMyCurrentRosterId, isMyRoster } from '../hooks/useAuthUser';

const PLAYOFF_START_WEEK = 15;

function getTeamName(rosters, users, rosterId) {
  if (!Array.isArray(rosters) || !Array.isArray(users)) {
    return `Team ${rosterId}`;
  }

  const roster = rosters.find((r) => String(r.roster_id) === String(rosterId));
  if (!roster) {
    return `Team ${rosterId}`;
  }

  const user = users.find((u) => String(u.user_id) === String(roster.owner_id));
  if (user && user.metadata && user.metadata.team_name) {
    return user.metadata.team_name;
  }
  if (user && user.display_name) {
    return `Team ${user.display_name}`;
  }

  return `Team ${rosterId}`;
}

function getAvatar(rosters, users, rosterId) {
  if (!Array.isArray(rosters) || !Array.isArray(users)) {
    return null;
  }

  const roster = rosters.find((r) => String(r.roster_id) === String(rosterId));
  if (!roster) {
    return null;
  }

  const user = users.find((u) => String(u.user_id) === String(roster.owner_id));
  if (!user) {
    return null;
  }

  return user.team_avatar_url || user.user_avatar_url || user.avatar_url || null;
}

function CurrentPlayoffPictureCard({ currentWeekOverride = null }) {
  const myRosterId = useMyCurrentRosterId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [picture, setPicture] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const season = CURRENT_YEAR;

        const baseCompleted = getCompletedWeeksCount(season);
        let completedWeeks = baseCompleted;

        if (currentWeekOverride != null) {
          const parsed = Number(currentWeekOverride);
          if (Number.isFinite(parsed) && parsed > 0) {
            completedWeeks = Math.min(parsed, baseCompleted);
          }
        }

        if (!Number.isFinite(completedWeeks) || completedWeeks < 1) {
          completedWeeks = 0;
        }

        const effectiveCompletedWeeks = Math.max(
          0,
          Math.min(PLAYOFF_START_WEEK - 1, completedWeeks),
        );

        const [weeksData, teamData, idMap] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season),
          fetchPlayerIdMap(),
        ]);

        if (cancelled) {
          return;
        }

        if (!weeksData || !Array.isArray(weeksData)) {
          throw new Error('No scores data');
        }
        if (
          !teamData ||
          !Array.isArray(teamData.rosters) ||
          !Array.isArray(teamData.users)
        ) {
          throw new Error('No team data');
        }

        let players = null;
        try {
          const useRosters =
            String(season) === String(CURRENT_YEAR) &&
            Array.isArray(teamData.rosters)
              ? teamData.rosters
              : String(season);
          players = await fetchPlayersData(useRosters);
        } catch (e) {
          players = null;
        }

        const playerSeasonTotalsMap = getPlayerSeasonTotalsMap(weeksData);

        if (effectiveCompletedWeeks === 0) {
          setPicture({
            weeksCount: 0,
            seed1: null,
            seed4: null,
            seed2: null,
            seed3: null,
          });
          setLoading(false);
          return;
        }

        const allRosterIds = Array.from(
          new Set(
            (weeksData
              .slice(0, effectiveCompletedWeeks)
              .flatMap((w) =>
                (w || []).map((e) => Number(e && e.roster_id)),
              ) || []
            ).filter((rid) => Number.isFinite(rid)),
          ),
        );

        if (!allRosterIds.length) {
          setPicture({
            weeksCount: effectiveCompletedWeeks,
            seed1: null,
            seed4: null,
            seed2: null,
            seed3: null,
          });
          setLoading(false);
          return;
        }

        const cumulative = {};
        allRosterIds.forEach((rid) => {
          cumulative[rid] = 0;
        });

        for (let week = 1; week <= effectiveCompletedWeeks; week += 1) {
          const weekEntries = weeksData[week - 1] || [];
          const breakdown = getWeekScoreBreakdown(weeksData, week) || {};

          weekEntries.forEach((entry) => {
            if (!entry || entry.roster_id == null) {
              return;
            }
            const rid = Number(entry.roster_id);
            if (!Number.isFinite(rid) || cumulative[rid] == null) {
              return;
            }

            const raw = breakdown[rid];
            let pts = 0;

            if (raw && players && idMap) {
              try {
                const computed = StartSitSort(
                  raw,
                  players,
                  idMap,
                  null,
                  null,
                  playerSeasonTotalsMap,
                );
                if (computed && typeof computed.starterTotal === 'number') {
                  pts = computed.starterTotal;
                }
              } catch (e) {
                // fall back to base API points
              }
            } else if (typeof entry.points === 'number') {
              pts = entry.points;
            }

            if (typeof pts === 'number' && Number.isFinite(pts)) {
              cumulative[rid] += pts;
            }
          });
        }

        const totalsArray = allRosterIds.map((rid) => ({
          rid,
          total: Math.round((cumulative[rid] || 0) * 10) / 10,
        }));

        const sortedByPointsDesc = totalsArray
          .slice()
          .sort((a, b) => b.total - a.total || a.rid - b.rid);

        if (!sortedByPointsDesc.length) {
          setPicture({
            weeksCount: effectiveCompletedWeeks,
            seed1: null,
            seed4: null,
            seed2: null,
            seed3: null,
          });
          setLoading(false);
          return;
        }

        const placeByRosterId = {};
        sortedByPointsDesc.forEach((entry, index) => {
          placeByRosterId[entry.rid] = index + 1;
        });

        const top4Raw = sortedByPointsDesc.slice(0, 4);

        if (top4Raw.length < 4) {
          setPicture({
            weeksCount: effectiveCompletedWeeks,
            seed1: null,
            seed4: null,
            seed2: null,
            seed3: null,
          });
          setLoading(false);
          return;
        }

        const mappedTop = top4Raw.map((entry) => {
          const rosterId = entry.rid;
          return {
            rosterId,
            seed: placeByRosterId[rosterId] || null,
            teamName: getTeamName(
              teamData.rosters,
              teamData.users,
              rosterId,
            ),
            avatarUrl: getAvatar(
              teamData.rosters,
              teamData.users,
              rosterId,
            ),
            totalPoints: entry.total,
          };
        });

        const orderedBySeed = mappedTop
          .slice()
          .sort((a, b) => (a.seed || 0) - (b.seed || 0));

        const seed1 = orderedBySeed.find((t) => t.seed === 1) || orderedBySeed[0];
        const seed2 = orderedBySeed.find((t) => t.seed === 2) || orderedBySeed[1];
        const seed3 =
          orderedBySeed.find((t) => t.seed === 3) ||
          orderedBySeed[Math.min(2, orderedBySeed.length - 1)];
        const seed4 =
          orderedBySeed.find((t) => t.seed === 4) ||
          orderedBySeed[orderedBySeed.length - 1];

        setPicture({
          weeksCount: effectiveCompletedWeeks,
          seed1,
          seed4,
          seed2,
          seed3,
        });
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Unable to load current playoff picture right now.');
          setPicture(null);
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [currentWeekOverride]);

  const formatScore = (val) => {
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val.toFixed(1);
    }
    return '—';
  };

  const renderRow = (left, right, label) => {
    if (!left || !right) {
      return (
        <div className="active-playoffs-row">
          <div className="active-playoffs-side active-playoffs-side--left">
            <div className="active-playoffs-team-content">
              <div className="active-playoffs-team-header">
                <span className="active-playoffs-team-seed active-playoffs-team-seed--pending">#1</span>
              </div>
              <span className="active-playoffs-team-name">TBD</span>
            </div>
          </div>
          <div className="active-playoffs-score active-playoffs-score--left">—</div>
          <div className="active-playoffs-vs">
            <span className="active-playoffs-vs-dot">vs.</span>
          </div>
          <div className="active-playoffs-score active-playoffs-score--right">—</div>
          <div className="active-playoffs-side active-playoffs-side--right">
            <div className="active-playoffs-team-content">
              <div className="active-playoffs-team-header active-playoffs-team-header--right">
                <span className="active-playoffs-team-seed active-playoffs-team-seed--pending">#4</span>
              </div>
              <span className="active-playoffs-team-name">TBD</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="active-playoffs-row">
        <div className={`active-playoffs-side active-playoffs-side--left${isMyRoster(left.rosterId, myRosterId) ? ' active-playoffs-side--me' : ''}`}>
          <div className="active-playoffs-team-content">
            <div className="active-playoffs-team-header">
              <span className="active-playoffs-team-seed active-playoffs-team-seed--pending">#{left.seed}</span>
              {left.avatarUrl && (
                <img
                  className="active-playoffs-avatar"
                  src={left.avatarUrl}
                  alt={`${left.teamName} avatar`}
                />
              )}
            </div>
            <span className="active-playoffs-team-name">
              {left.teamName}
              {isMyRoster(left.rosterId, myRosterId) ? <span className="me-chip">YOU</span> : null}
            </span>
          </div>
        </div>
        <div className="active-playoffs-score active-playoffs-score--left">
          {formatScore(left.totalPoints)}
        </div>
        <div className="active-playoffs-vs">
          <span className="active-playoffs-vs-dot">vs.</span>
        </div>
        <div className="active-playoffs-score active-playoffs-score--right">
          {formatScore(right.totalPoints)}
        </div>
        <div className={`active-playoffs-side active-playoffs-side--right${isMyRoster(right.rosterId, myRosterId) ? ' active-playoffs-side--me' : ''}`}>
          <div className="active-playoffs-team-content">
            <div className="active-playoffs-team-header active-playoffs-team-header--right">
              {right.avatarUrl && (
                <img
                  className="active-playoffs-avatar"
                  src={right.avatarUrl}
                  alt={`${right.teamName} avatar`}
                />
              )}
              <span className="active-playoffs-team-seed active-playoffs-team-seed--pending">#{right.seed}</span>
            </div>
            <span className="active-playoffs-team-name">
              {right.teamName}
              {isMyRoster(right.rosterId, myRosterId) ? <span className="me-chip">YOU</span> : null}
            </span>
          </div>
        </div>
      </div>
    );
  };

  let body = null;

  if (loading) {
    body = (
      <LoadingState
        className="active-playoffs-loading"
        label="Loading current playoff picture…"
        ariaLabel="Loading current playoff picture"
      />
    );
  } else if (error) {
    body = (
      <div className="active-playoffs-status active-playoffs-status--error">
        {error}
      </div>
    );
  } else if (!picture || !picture.seed1 || !picture.seed4 || !picture.seed2 || !picture.seed3) {
    body = (
      <div className="active-playoffs-status">
        Not enough data yet to show the playoff picture.
      </div>
    );
  } else {
    body = (
      <div className="active-playoffs-body">
        {renderRow(picture.seed1, picture.seed4, '')}
        {renderRow(picture.seed2, picture.seed3, '')}
      </div>
    );
  }

  return (
    <HomeCard>
      <div className="home-card-inner">
        <h2 className="home-card-title">🖼️ Current Playoff Picture</h2>
        {body}
        <div className="active-playoffs-link-row">
          <Link
            className="active-playoffs-link"
            to="/Standings"
          >
            View Standings →
          </Link>
        </div>
      </div>
    </HomeCard>
  );
}

export default CurrentPlayoffPictureCard;



