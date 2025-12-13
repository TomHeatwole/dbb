import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import { CURRENT_YEAR, getCurrentNFLWeek } from './utils/DateHelper';
import { fetchScoresData } from './lookups/ScoresLookup';
import { fetchTeamData } from './lookups/TeamLookup';

function HotTeamCard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hotTeam, setHotTeam] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const season = CURRENT_YEAR;
        const currentWeek = getCurrentNFLWeek(season);
        const targetWeek = Math.max(1, currentWeek - 1);

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

        const weekArrRaw =
          Array.isArray(weeksData[targetWeek - 1]) && weeksData[targetWeek - 1]
            ? weeksData[targetWeek - 1]
            : [];
        const weekArr = weekArrRaw.filter(
          (e) => e && e.roster_id != null && typeof e.points === 'number',
        );

        if (!weekArr.length) {
          setHotTeam(null);
          setLoading(false);
          return;
        }

        let best = null;
        weekArr.forEach((entry) => {
          const pts = Number.isFinite(entry.points) ? entry.points : 0;
          if (!best || pts > best.points) {
            best = { rosterId: Number(entry.roster_id), points: pts };
          }
        });

        if (!best) {
          setHotTeam(null);
          setLoading(false);
          return;
        }

        const roster = teamData.rosters.find(
          (r) => String(r.roster_id) === String(best.rosterId),
        );
        const user =
          roster && teamData.users
            ? teamData.users.find(
                (u) => String(u.user_id) === String(roster.owner_id),
              )
            : null;

        let teamName = `Team ${best.rosterId}`;
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
        if (targetWeek > 2) {
          const startWeek = Math.max(1, targetWeek - 2);
          const temp = [];
          for (let wk = startWeek; wk <= targetWeek; wk += 1) {
            const wkArrRaw =
              Array.isArray(weeksData[wk - 1]) && weeksData[wk - 1]
                ? weeksData[wk - 1]
                : [];
            const wkArr = wkArrRaw.filter(
              (e) => e && Number(e.roster_id) === Number(best.rosterId),
            );
            if (wkArr.length === 0) {
              continue;
            }
            const entry = wkArr[0];
            if (typeof entry.points === 'number' && Number.isFinite(entry.points)) {
              temp.push({ week: wk, points: entry.points });
            }
          }
          if (temp.length >= 2) {
            const values = temp.map((r) => r.points);
            const minPts = Math.min(...values);
            const maxPts = Math.max(...values);
            recent = temp.map((r) => {
              let bucket = 'mid';
              if (maxPts !== minPts) {
                const ratio = (r.points - minPts) / (maxPts - minPts);
                if (ratio < 0.34) {
                  bucket = 'low';
                } else if (ratio < 0.67) {
                  bucket = 'mid';
                } else {
                  bucket = 'high';
                }
              }
              return { ...r, bucket };
            });
          }
        }

        setHotTeam({
          rosterId: best.rosterId,
          teamName,
          avatarUrl,
          week: targetWeek,
          points: best.points,
          recent,
        });
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Unable to load hot team right now.');
          setHotTeam(null);
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  let body = null;

  if (loading) {
    body = (
      <div className="active-playoffs-status">
        Loading…
      </div>
    );
  } else if (error) {
    body = (
      <div className="active-playoffs-status active-playoffs-status--error">
        {error}
      </div>
    );
  } else if (!hotTeam) {
    body = (
      <div className="active-playoffs-status">
        No recent hot team data yet.
      </div>
    );
  } else {
    body = (
      <div className="hot-team-body">
        <div className="hot-team-main">
          {hotTeam.avatarUrl && (
            <img
              className="hot-team-avatar"
              src={hotTeam.avatarUrl}
              alt={`${hotTeam.teamName} avatar`}
            />
          )}
          <div className="hot-team-text">
            <div className="hot-team-team-line">
              <span className="hot-team-team-name">{hotTeam.teamName}</span>
            </div>
            <div className="hot-team-score-line">
              <span className="hot-team-week-label">Week {hotTeam.week}</span>
              <span className="hot-team-score">
                {hotTeam.points.toFixed(1)} pts
              </span>
            </div>
            {Array.isArray(hotTeam.recent) && hotTeam.recent.length >= 2 && (
              <div className="hot-team-trend">
                {hotTeam.recent.map((r) => (
                  <div key={r.week} className="hot-team-trend-item">
                    <div
                      className={
                        `hot-team-trend-bar hot-team-trend-bar--${r.bucket}`
                      }
                    />
                    <div className="hot-team-trend-week">
                      W{r.week}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <HomeCard>
      <div className="home-card-inner">
        <h2 className="home-card-title">🔥 Hot Team Alert</h2>
        {body}
        {hotTeam && (
          <div className="active-playoffs-link-row">
            <Link
              className="active-playoffs-link"
              to={`/team/${hotTeam.rosterId}`}
            >
              View Team →
            </Link>
          </div>
        )}
      </div>
    </HomeCard>
  );
}

export default HotTeamCard;


