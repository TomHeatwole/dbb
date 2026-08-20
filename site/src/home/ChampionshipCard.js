import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import { CURRENT_YEAR, getCompletedWeeksCount } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { StartSitSort } from '../players/StartSitDecider';
import { getWeekScoreBreakdown, getPlayerSeasonTotalsMap, getStandings } from '../scores/ScoresParser';
import { useMyCurrentRosterId, isMyRoster } from '../hooks/useAuthUser';

const PLAYOFF_START_WEEK = 15;
const PLAYOFF_END_WEEK = 17;

function ChampionshipCard() {
  const myRosterId = useMyCurrentRosterId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [championship, setChampionship] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const season = CURRENT_YEAR;

        const [weeksData, teamData, players, idMap] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season),
          fetchPlayersData(),
          fetchPlayerIdMap(),
        ]);

        if (cancelled) {
          return;
        }

        if (!weeksData || !Array.isArray(weeksData)) {
          throw new Error('No scores data');
        }
        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }

        const playerSeasonTotalsMap = getPlayerSeasonTotalsMap(weeksData);

        // Regular season weeks for seeding
        const regularSliceFull = weeksData.slice(0, 14);
        const weeksRegular = regularSliceFull.filter(Boolean);
        if (!weeksRegular.length) {
          setChampionship({
            started: false,
            topTeam: null,
            bottomTeam: null,
          });
          setLoading(false);
          return;
        }

        // Check if semifinals are completed
        const semiEnd = Math.max(PLAYOFF_START_WEEK, PLAYOFF_END_WEEK - 1);
        const completedWeeks = getCompletedWeeksCount(season);
        const semisCompleted = semiEnd <= completedWeeks;

        if (!semisCompleted) {
          setChampionship({
            started: false,
            topTeam: null,
            bottomTeam: null,
          });
          setLoading(false);
          return;
        }

        // Get top 4 seeds from regular season
        const standingsRegular = getStandings(weeksRegular) || [];
        const top4Regular = standingsRegular
          .slice()
          .sort((a, b) => a.place - b.place)
          .slice(0, 4);

        const seedIds = top4Regular.map((r) => Number(r.roster_id));
        const seedSet = new Set(seedIds);

        // Compute cumulative semifinal totals
        const semiTotals = {};
        for (let wk = PLAYOFF_START_WEEK; wk <= semiEnd; wk += 1) {
          const weekEntries = Array.isArray(weeksData[wk - 1]) ? weeksData[wk - 1] : [];
          const breakdown = getWeekScoreBreakdown(weeksData, wk, teamData.rosters) || {};

          weekEntries.forEach((entry) => {
            if (!entry || entry.roster_id == null) {
              return;
            }
            const rid = Number(entry.roster_id);
            if (!seedSet.has(rid)) {
              return;
            }
            if (!semiTotals[rid]) {
              semiTotals[rid] = 0;
            }

            const raw = breakdown[rid];
            let pts = 0;

            if (raw) {
              const computed = StartSitSort(raw, players, idMap, null, null, playerSeasonTotalsMap);
              if (computed && typeof computed.starterTotal === 'number') {
                pts = computed.starterTotal;
              }
            } else if (typeof entry.points === 'number' && Number.isFinite(entry.points)) {
              pts = entry.points;
            }

            semiTotals[rid] += Math.round(pts * 10) / 10;
          });
        }

        // Build seed team objects
        const seeds = top4Regular
          .map((row) => {
            const rid = Number(row.roster_id);
            const roster = teamData.rosters.find(
              (r) => String(r.roster_id) === String(rid),
            );
            const user =
              roster && teamData.users
                ? teamData.users.find(
                    (u) =>
                      String(u.user_id) === String(roster.owner_id),
                  )
                : null;
            let teamName = `Team ${rid}`;
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
            return {
              rosterId: rid,
              seed: row.place,
              teamName,
              avatarUrl,
              semiTotal: semiTotals[rid] != null ? semiTotals[rid] : 0,
            };
          })
          .sort((a, b) => (a.seed || 999) - (b.seed || 999));

        const seed1 = seeds.find((t) => t.seed === 1) || seeds[0] || null;
        const seed4 = seeds.find((t) => t.seed === 4) || seeds[seeds.length - 1] || null;
        const seed2 = seeds.find((t) => t.seed === 2) || seeds[1] || null;
        const seed3 =
          seeds.find((t) => t.seed === 3) ||
          seeds[Math.min(2, Math.max(seeds.length - 1, 0))] ||
          null;

        // Determine semifinal winners
        const total1 = seed1 ? (semiTotals[seed1.rosterId] || 0) : 0;
        const total4 = seed4 ? (semiTotals[seed4.rosterId] || 0) : 0;
        const total2 = seed2 ? (semiTotals[seed2.rosterId] || 0) : 0;
        const total3 = seed3 ? (semiTotals[seed3.rosterId] || 0) : 0;

        const topWinner =
          total1 > total4 ||
          (total1 === total4 && seed1 && seed4 && (seed1.seed || 999) < (seed4.seed || 999))
            ? seed1
            : seed4;
        const bottomWinner =
          total2 > total3 ||
          (total2 === total3 && seed2 && seed3 && (seed2.seed || 999) < (seed3.seed || 999))
            ? seed2
            : seed3;

        if (!topWinner || !bottomWinner) {
          setChampionship({
            started: false,
            topTeam: null,
            bottomTeam: null,
          });
          setLoading(false);
          return;
        }

        // Calculate championship week scores
        const finalsWeek = PLAYOFF_END_WEEK;
        const finalsBreakdown = getWeekScoreBreakdown(weeksData, finalsWeek, teamData.rosters) || {};

        const computeFinalScore = (rid) => {
          let weekTotal = 0;
          const raw = finalsBreakdown[rid];
          if (raw && players && idMap) {
            try {
              const computed = StartSitSort(raw, players, idMap, null, null, playerSeasonTotalsMap);
              if (computed && typeof computed.starterTotal === 'number') {
                weekTotal = Math.round(computed.starterTotal * 10) / 10;
              }
            } catch (_) {
              // fallback to 0
            }
          }
          return weekTotal;
        };

        const topWinnerSemi = semiTotals[topWinner.rosterId] || 0;
        const bottomWinnerSemi = semiTotals[bottomWinner.rosterId] || 0;
        const highSemi = Math.max(topWinnerSemi, bottomWinnerSemi);
        const lowSemi = Math.min(topWinnerSemi, bottomWinnerSemi);
        const buffer = highSemi > lowSemi ? (highSemi - lowSemi) / 2 : 0;

        let topFinal = computeFinalScore(topWinner.rosterId);
        let bottomFinal = computeFinalScore(bottomWinner.rosterId);

        if (buffer > 0) {
          if (topWinnerSemi > bottomWinnerSemi) {
            topFinal += buffer;
          } else if (bottomWinnerSemi > topWinnerSemi) {
            bottomFinal += buffer;
          }
        }

        topFinal = Math.round(topFinal * 10) / 10;
        bottomFinal = Math.round(bottomFinal * 10) / 10;

        setChampionship({
          started: true,
          topTeam: {
            ...topWinner,
            total: topFinal,
          },
          bottomTeam: {
            ...bottomWinner,
            total: bottomFinal,
          },
        });
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Unable to load championship data right now.');
          setChampionship(null);
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const formatScore = (val) => {
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val.toFixed(1);
    }
    return '—';
  };

  const renderRow = (left, right) => {
    if (!left || !right) {
      return (
        <div className="active-playoffs-row">
          <div className="active-playoffs-side active-playoffs-side--left">
            <span className="active-playoffs-team-name">TBD</span>
          </div>
          <div className="active-playoffs-score active-playoffs-score--left">—</div>
          <div className="active-playoffs-vs">
            <span className="active-playoffs-vs-dot">vs.</span>
          </div>
          <div className="active-playoffs-score active-playoffs-score--right">—</div>
          <div className="active-playoffs-side active-playoffs-side--right">
            <span className="active-playoffs-team-name">TBD</span>
          </div>
        </div>
      );
    }

    return (
      <Link
        to={`/yoffs?format=bracket&tab=Matchups&a=${left.rosterId}&b=${right.rosterId}&matchup=3`}
        className="active-playoffs-row active-playoffs-row--clickable"
      >
        <div className={`active-playoffs-side active-playoffs-side--left${isMyRoster(left.rosterId, myRosterId) ? ' active-playoffs-side--me' : ''}`}>
          <div className="active-playoffs-team-content">
            <div className="active-playoffs-team-header">
              <span className="active-playoffs-team-seed">#{left.seed}</span>
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
          {formatScore(left.total)}
        </div>
        <div className="active-playoffs-vs">
          <span className="active-playoffs-vs-dot">vs.</span>
        </div>
        <div className="active-playoffs-score active-playoffs-score--right">
          {formatScore(right.total)}
        </div>
        <div className={`active-playoffs-side active-playoffs-side--right${isMyRoster(right.rosterId, myRosterId) ? ' active-playoffs-side--me' : ''}`}>
          <div className="active-playoffs-team-content active-playoffs-team-content--right">
            <div className="active-playoffs-team-header active-playoffs-team-header--right">
              {right.avatarUrl && (
                <img
                  className="active-playoffs-avatar"
                  src={right.avatarUrl}
                  alt={`${right.teamName} avatar`}
                />
              )}
              <span className="active-playoffs-team-seed">#{right.seed}</span>
            </div>
            <span className="active-playoffs-team-name">
              {right.teamName}
              {isMyRoster(right.rosterId, myRosterId) ? <span className="me-chip">YOU</span> : null}
            </span>
          </div>
        </div>
      </Link>
    );
  };

  let body = null;

  if (loading) {
    body = (
      <LoadingState
        className="active-playoffs-loading"
        label="Loading championship…"
        ariaLabel="Loading championship"
      />
    );
  } else if (error) {
    body = (
      <div className="active-playoffs-status active-playoffs-status--error">
        {error}
      </div>
    );
  } else if (!championship || !championship.started) {
    body = (
      <div className="active-playoffs-status">
        Championship matchup will appear once semifinals are complete.
      </div>
    );
  } else {
    body = (
      <div className="active-playoffs-body">
        {renderRow(championship.topTeam, championship.bottomTeam)}
      </div>
    );
  }

  return (
    <HomeCard>
      <div className="home-card-inner">
        <div className="home-card-title-row">
          <h2 className="home-card-title">🏆 Championship</h2>
          <Link className="active-playoffs-link" to="/yoffs">
            Go to Playoffs →
          </Link>
        </div>
        {body}
      </div>
    </HomeCard>
  );
}

export default ChampionshipCard;

