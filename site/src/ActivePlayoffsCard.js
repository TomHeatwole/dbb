import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import { CURRENT_YEAR, getCompletedWeeksCount } from './utils/DateHelper';
import { fetchScoresData } from './lookups/ScoresLookup';
import { fetchTeamData } from './lookups/TeamLookup';

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
        const completedWeeks = getCompletedWeeksCount(season);
        const playoffsStarted = completedWeeks >= PLAYOFF_START_WEEK;

        if (!playoffsStarted) {
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

        const [weeksData, teamData] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season),
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

        const regularSliceFull = weeksData.slice(0, 14);
        const weeksRegular = regularSliceFull.filter(Boolean);
        if (!weeksRegular.length) {
          setSemis({
            started: true,
            seed1: null,
            seed4: null,
            seed2: null,
            seed3: null,
          });
          setLoading(false);
          return;
        }

        const { getStandings } = await import('./scores/ScoresParser');

        const standingsRegular = getStandings(weeksRegular) || [];
        const top4Regular = standingsRegular
          .slice()
          .sort((a, b) => a.place - b.place)
          .slice(0, 4);

        const seedIds = top4Regular.map((r) => Number(r.roster_id));
        const semiWeekStart = PLAYOFF_START_WEEK;
        const semiWeekEnd = PLAYOFF_START_WEEK + 1;
        const semiTotals = {};

        for (let wk = semiWeekStart; wk <= semiWeekEnd; wk += 1) {
          const weekEntries = Array.isArray(weeksData[wk - 1]) ? weeksData[wk - 1] : [];
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
            if (typeof entry.points === 'number' && Number.isFinite(entry.points)) {
              semiTotals[rid] += Math.round(entry.points * 10) / 10;
            }
          });
        }

        const seeds = top4Regular
          .map((row) => {
            const rid = Number(row.roster_id);
            const roster = teamData.rosters.find(
              (r) => String(r.roster_id) === String(rid)
            );
            const user =
              roster && teamData.users
                ? teamData.users.find(
                    (u) =>
                      String(u.user_id) === String(roster.owner_id)
                  )
                : null;
            let teamName = `Team ${rid}`;
            if (user && user.metadata && user.metadata.team_name) {
              teamName = user.metadata.team_name;
            } else if (user && user.display_name) {
              teamName = `Team ${user.display_name}`;
            }
            return {
              rosterId: rid,
              seed: row.place,
              teamName,
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
          <div className="active-playoffs-side">
            <div className="active-playoffs-team-name">TBD</div>
            <div className="active-playoffs-score">—</div>
          </div>
          <div className="active-playoffs-vs">
            <span className="active-playoffs-vs-label">{label}</span>
          </div>
          <div className="active-playoffs-side active-playoffs-side--right">
            <div className="active-playoffs-team-name">TBD</div>
            <div className="active-playoffs-score">—</div>
          </div>
        </div>
      );
    }

    return (
      <div className="active-playoffs-row">
        <div className="active-playoffs-side">
          <div className="active-playoffs-team-seed">#{left.seed}</div>
          <div className="active-playoffs-team-name">{left.teamName}</div>
          <div className="active-playoffs-score">{formatScore(left.total)}</div>
        </div>
        <div className="active-playoffs-vs">
          <span className="active-playoffs-vs-label">{label}</span>
        </div>
        <div className="active-playoffs-side active-playoffs-side--right">
          <div className="active-playoffs-team-seed">#{right.seed}</div>
          <div className="active-playoffs-team-name">{right.teamName}</div>
          <div className="active-playoffs-score">{formatScore(right.total)}</div>
        </div>
      </div>
    );
  };

  let body = null;

  if (loading) {
    body = (
      <div className="active-playoffs-status">
        Loading playoff matchups…
      </div>
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
        <h2 className="home-card-title">Playoff Matchups</h2>
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


