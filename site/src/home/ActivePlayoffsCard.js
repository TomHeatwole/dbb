import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { StartSitSort } from '../players/StartSitDecider';
import { getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';

const PLAYOFF_START_WEEK = 15;

function ActivePlayoffsCard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [semis, setSemis] = useState(null);

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

        const regularSliceFull = weeksData.slice(0, 14);
        const weeksRegular = regularSliceFull.filter(Boolean);
        if (!weeksRegular.length) {
          setSemis({
            started: false,
            seed1: null,
            seed4: null,
            seed2: null,
            seed3: null,
          });
          setLoading(false);
          return;
        }

        const semiWeekStart = PLAYOFF_START_WEEK;
        const semiWeekEnd = PLAYOFF_START_WEEK + 1;

        const hasPlayoffData =
          Array.isArray(weeksData[semiWeekStart - 1]) &&
          weeksData[semiWeekStart - 1].length > 0;

        if (!hasPlayoffData) {
          setSemis({
            started: false,
            seed1: null,
            seed4: null,
            seed2: null,
            seed3: null,
          });
          setLoading(false);
          return;
        }

        const { getStandings } = await import('../scores/ScoresParser');

        const standingsRegular = getStandings(weeksRegular) || [];
        const top4Regular = standingsRegular
          .slice()
          .sort((a, b) => a.place - b.place)
          .slice(0, 4);

        const seedIds = top4Regular.map((r) => Number(r.roster_id));
        const semiTotals = {};

        for (let wk = semiWeekStart; wk <= semiWeekEnd; wk += 1) {
          const weekEntries = Array.isArray(weeksData[wk - 1]) ? weeksData[wk - 1] : [];
          const breakdown = getWeekScoreBreakdown(weeksData, wk) || {};

          weekEntries.forEach((entry) => {
            if (!entry || entry.roster_id == null) {
              return;
            }
            const rid = Number(entry.roster_id);
            if (!seedIds.includes(rid)) {
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
              total: semiTotals[rid] != null ? semiTotals[rid] : null,
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

        setSemis({
          started: true,
          seed1,
          seed4,
          seed2,
          seed3,
        });
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Unable to load playoff data right now.');
          setSemis(null);
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

  const renderRow = (left, right, label) => {
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
      <div className="active-playoffs-row">
        <div className="active-playoffs-side active-playoffs-side--left">
          {left.avatarUrl && (
            <img
              className="active-playoffs-avatar"
              src={left.avatarUrl}
              alt={`${left.teamName} avatar`}
            />
          )}
          <span className="active-playoffs-team-name">{left.teamName}</span>
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
        <div className="active-playoffs-side active-playoffs-side--right">
          {right.avatarUrl && (
            <img
              className="active-playoffs-avatar"
              src={right.avatarUrl}
              alt={`${right.teamName} avatar`}
            />
          )}
          <span className="active-playoffs-team-name">{right.teamName}</span>
        </div>
      </div>
    );
  };

  let body = null;

  if (loading) {
    body = (
      <LoadingState
        className="active-playoffs-loading"
        label="Loading playoff matchups…"
        ariaLabel="Loading playoff matchups"
      />
    );
  } else if (error) {
    body = (
      <div className="active-playoffs-status active-playoffs-status--error">
        {error}
      </div>
    );
  } else if (!semis || !semis.started) {
    body = (
      <div className="active-playoffs-status">
        Playoffs have not started yet.
      </div>
    );
  } else {
    body = (
      <div className="active-playoffs-body">
        {renderRow(semis.seed1, semis.seed4, 'Semifinal 1')}
        {renderRow(semis.seed2, semis.seed3, 'Semifinal 2')}
      </div>
    );
  }

  return (
    <HomeCard>
      <div className="home-card-inner">
        <h2 className="home-card-title">🥇 Playoff Matchups</h2>
        {body}
        <div className="active-playoffs-link-row">
          <Link className="active-playoffs-link" to="/yoffs?format=bracket&tab=Matchups">
            Go to Playoffs →
          </Link>
        </div>
      </div>
    </HomeCard>
  );
}

export default ActivePlayoffsCard;


