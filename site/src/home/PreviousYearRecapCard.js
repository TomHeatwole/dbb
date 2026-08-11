import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import { CURRENT_YEAR, getCompletedWeeksCount } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { getWeekScoreBreakdown, getPlayerSeasonTotalsMap, getStandings } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { useMyCurrentRosterId, isMyRoster } from '../hooks/useAuthUser';

const PLAYOFF_START_WEEK = 15;
const PLAYOFF_END_WEEK = 17;

function getTeamLabel(teamInfo, rosterId) {
  const name = teamInfo && teamInfo.teamName ? teamInfo.teamName : `Team ${rosterId}`;
  const avatarUrl =
    teamInfo && teamInfo.user
      ? (teamInfo.user.team_avatar_url || teamInfo.user.user_avatar_url || teamInfo.user.avatar_url || null)
      : null;
  return { name, avatarUrl };
}

function PreviousYearRecapCard() {
  const myRosterId = useMyCurrentRosterId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resultsRows, setResultsRows] = useState(null); // [{ key, label, rosterId, teamName, avatarUrl }]
  const loadIdRef = React.useRef(0);

  // Season we're displaying: when pre-season, the completed previous year; otherwise current year
  const displaySeason =
    getCompletedWeeksCount(CURRENT_YEAR) === 0
      ? String(Number(CURRENT_YEAR) - 1)
      : CURRENT_YEAR;

  useEffect(() => {
    loadIdRef.current += 1;
    const currentLoadId = loadIdRef.current;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // When pre-season (current season hasn't started), recap the previous year
        const completedWeeksCurrent = getCompletedWeeksCount(CURRENT_YEAR);
        const season = completedWeeksCurrent === 0 ? String(Number(CURRENT_YEAR) - 1) : CURRENT_YEAR;

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

        // Require playoffs to be complete to show a recap.
        const completedWeeks = getCompletedWeeksCount(season);
        const playoffsCompleted = Number.isFinite(completedWeeks) && completedWeeks >= PLAYOFF_END_WEEK;
        if (!playoffsCompleted) {
          if (currentLoadId === loadIdRef.current && !cancelled) {
            setResultsRows((prev) => (prev && prev.length >= 3 ? prev : null));
          }
          setLoading(false);
          return;
        }

        const rosterMap = buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users);
        const playerSeasonTotalsMap = getPlayerSeasonTotalsMap(weeksData);

        // Seed top 4 from regular season standings (weeks 1-14).
        const weeksRegular = (weeksData || []).slice(0, 14).filter(Boolean);
        const standingsRegular = getStandings(weeksRegular) || [];
        const top4Regular = standingsRegular
          .slice()
          .sort((a, b) => (a.place || 999) - (b.place || 999))
          .slice(0, 4);
        if (top4Regular.length < 4) {
          if (currentLoadId === loadIdRef.current && !cancelled) {
            setResultsRows((prev) => (prev && prev.length >= 3 ? prev : null));
          }
          setLoading(false);
          return;
        }

        const seedByPlace = {};
        for (const row of top4Regular) {
          seedByPlace[row.place] = Number(row.roster_id);
        }
        const seed1 = seedByPlace[1] || Number(top4Regular[0].roster_id);
        const seed2 = seedByPlace[2] || Number(top4Regular[1].roster_id);
        const seed3 = seedByPlace[3] || Number(top4Regular[2].roster_id);
        const seed4 = seedByPlace[4] || Number(top4Regular[3].roster_id);
        const seedNumByRosterId = {
          [seed1]: 1,
          [seed2]: 2,
          [seed3]: 3,
          [seed4]: 4,
        };

        // Compute cumulative semifinal totals for each seed (Weeks 15-16).
        const semiEnd = Math.max(PLAYOFF_START_WEEK, PLAYOFF_END_WEEK - 1);
        const semiTotals = {};

        for (let wk = PLAYOFF_START_WEEK; wk <= semiEnd; wk += 1) {
          const breakdown = getWeekScoreBreakdown(weeksData, wk, teamData.rosters) || {};
          const weekEntries = Array.isArray(weeksData[wk - 1]) ? weeksData[wk - 1] : [];
          const seedIds = [seed1, seed2, seed3, seed4];
          for (const rid of seedIds) {
            const raw = breakdown[rid];
            const entry = weekEntries.find((e) => e && Number(e.roster_id) === Number(rid)) || null;
            let weekTotal =
              entry && typeof entry.points === 'number' && Number.isFinite(entry.points)
                ? Math.round(entry.points * 10) / 10
                : 0;
            if (raw && players && idMap) {
              try {
                const computed = StartSitSort(raw, players, idMap, null, null, playerSeasonTotalsMap);
                if (computed && typeof computed.starterTotal === 'number') {
                  weekTotal = Math.round(computed.starterTotal * 10) / 10;
                }
              } catch (_) {
                // keep Sleeper API points fallback
              }
            }
            if (!semiTotals[rid]) {
              semiTotals[rid] = 0;
            }
            semiTotals[rid] += weekTotal;
          }
        }

        // Semifinal winners (seed tiebreaker if equal).
        const topWinner =
          semiTotals[seed1] > semiTotals[seed4] ||
          (semiTotals[seed1] === semiTotals[seed4] && 1 < 4)
            ? seed1
            : seed4;

        const bottomWinner =
          semiTotals[seed2] > semiTotals[seed3] ||
          (semiTotals[seed2] === semiTotals[seed3] && 2 < 3)
            ? seed2
            : seed3;

        // Finals totals (Week 17) using StartSit-based starters total.
        const finalsWeek = PLAYOFF_END_WEEK;
        const finalsBreakdown = getWeekScoreBreakdown(weeksData, finalsWeek, teamData.rosters) || {};
        const finalsTotals = {};
        const finalsEntries = Array.isArray(weeksData[finalsWeek - 1]) ? weeksData[finalsWeek - 1] : [];
        for (const rid of [topWinner, bottomWinner]) {
          const raw = finalsBreakdown[rid];
          const entry = finalsEntries.find((e) => e && Number(e.roster_id) === Number(rid)) || null;
          let weekTotal =
            entry && typeof entry.points === 'number' && Number.isFinite(entry.points)
              ? Math.round(entry.points * 10) / 10
              : 0;
          if (raw && players && idMap) {
            try {
              const computed = StartSitSort(raw, players, idMap, null, null, playerSeasonTotalsMap);
              if (computed && typeof computed.starterTotal === 'number') {
                weekTotal = Math.round(computed.starterTotal * 10) / 10;
              }
            } catch (_) {
              // keep Sleeper API points fallback
            }
          }
          finalsTotals[rid] = weekTotal;
        }

        // Match /yoffs bracket behavior: apply "Semis Buffer" to the Week 17 finals score.
        // Buffer = (higher semifinal total - lower semifinal total) / 2, awarded to the higher semi scorer.
        const topWinnerSemi = semiTotals[topWinner] || 0;
        const bottomWinnerSemi = semiTotals[bottomWinner] || 0;
        const highSemi = Math.max(topWinnerSemi, bottomWinnerSemi);
        const lowSemi = Math.min(topWinnerSemi, bottomWinnerSemi);
        const buffer = highSemi > lowSemi ? (highSemi - lowSemi) / 2 : 0;
        const finalsTotalsWithBuffer = { ...finalsTotals };
        if (buffer > 0) {
          if (topWinnerSemi > bottomWinnerSemi) {
            finalsTotalsWithBuffer[topWinner] = Math.round((finalsTotalsWithBuffer[topWinner] + buffer) * 10) / 10;
          } else if (bottomWinnerSemi > topWinnerSemi) {
            finalsTotalsWithBuffer[bottomWinner] = Math.round((finalsTotalsWithBuffer[bottomWinner] + buffer) * 10) / 10;
          }
        }

        const champion =
          finalsTotalsWithBuffer[topWinner] > finalsTotalsWithBuffer[bottomWinner] ||
          (finalsTotalsWithBuffer[topWinner] === finalsTotalsWithBuffer[bottomWinner] &&
            (seedNumByRosterId[topWinner] || 99) < (seedNumByRosterId[bottomWinner] || 99))
            ? topWinner
            : bottomWinner;
        const runnerUp = champion === topWinner ? bottomWinner : topWinner;

        // Top PF (all 17 weeks). Prefer a team not already in the top 2.
        const top2Ids = new Set([champion, runnerUp].map((x) => String(x)));
        const standingsAll17 = getStandings((weeksData || []).slice(0, 17).filter(Boolean)) || [];
        const pfCandidates = standingsAll17
          .slice()
          .sort((a, b) => (b.points_scored || 0) - (a.points_scored || 0));
        let topPfRosterId = null;
        for (const r of pfCandidates) {
          if (!r || r.roster_id == null) {
            continue;
          }
          const ridStr = String(r.roster_id);
          if (!top2Ids.has(ridStr)) {
            topPfRosterId = Number(r.roster_id);
            break;
          }
        }
        if (topPfRosterId == null && pfCandidates.length) {
          topPfRosterId = Number(pfCandidates[0].roster_id);
        }

        const rows = [
          { key: 'winner', label: '🏆 Winner', rosterId: champion },
          { key: 'runner_up', label: '🥈 Runner-up', rosterId: runnerUp },
        ].map((o) => {
          const info = rosterMap[o.rosterId] || rosterMap[String(o.rosterId)] || null;
          const { name, avatarUrl } = getTeamLabel(info, o.rosterId);
          return { key: o.key, label: o.label, rosterId: o.rosterId, teamName: name, avatarUrl };
        });

        if (topPfRosterId != null) {
          const info = rosterMap[topPfRosterId] || rosterMap[String(topPfRosterId)] || null;
          const { name, avatarUrl } = getTeamLabel(info, topPfRosterId);
          rows.push({
            key: 'top_pf',
            label: '📈 Top PF',
            rosterId: topPfRosterId,
            teamName: name,
            avatarUrl
          });
        }

        if (currentLoadId === loadIdRef.current && !cancelled) {
          setResultsRows(rows);
        }
        setLoading(false);
      } catch (_) {
        if (!cancelled && currentLoadId === loadIdRef.current) {
          setError('Unable to load season recap right now.');
          setResultsRows((prev) => (prev && prev.length >= 3 ? prev : null));
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const title = `🏁 ${displaySeason} Results`;

  let body = null;
  if (loading) {
    body = <LoadingState label="Loading recap…" ariaLabel="Loading recap" />;
  } else if (error) {
    body = <div className="previous-year-recap-status previous-year-recap-status--error">{error}</div>;
  } else if (!resultsRows || resultsRows.length < 3) {
    body = (
      <div className="previous-year-recap-status">
        Not enough data yet to show results.
      </div>
    );
  } else {
    body = (
      <div className="previous-year-recap-list">
        {resultsRows.map((row) => {
          return (
            <Link
              key={row.key}
              to={`/team/${row.rosterId}`}
              className={`previous-year-recap-link${isMyRoster(row.rosterId, myRosterId) ? ' recap-team--me' : ''}`}
            >
              <div className="previous-year-recap-rank">{row.label}</div>
              <div className="previous-year-recap-team">
                {row.avatarUrl ? (
                  <img
                    className="previous-year-recap-avatar"
                    src={row.avatarUrl}
                    alt={`${row.teamName} avatar`}
                  />
                ) : (
                  <div className="previous-year-recap-avatar previous-year-recap-avatar--placeholder" />
                )}
                <div className="previous-year-recap-name">
                  {row.teamName}
                  {isMyRoster(row.rosterId, myRosterId) ? <span className="me-chip">YOU</span> : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <HomeCard className="previous-year-recap-card">
      <div className="home-card-inner">
        <h2 className="home-card-title">{title}</h2>
        <div className="home-card-body">{body}</div>
        <div className="active-playoffs-link-row">
          <Link className="active-playoffs-link" to={`/yoffs?year=${displaySeason}&format=bracket&tab=Bracket`}>
            View Playoffs →
          </Link>
        </div>
      </div>
    </HomeCard>
  );
}

export default PreviousYearRecapCard;


