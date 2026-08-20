import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import { selectHotTeam } from './HotTeamSelector';
import useIsMobile from '../hooks/useIsMobile';
import { useMyCurrentRosterId, isMyRoster } from '../hooks/useAuthUser';

function computeYAxisDomain(hotTeam) {
  if (!hotTeam) {
    return [0, 200];
  }

  let values = [];

  if (Array.isArray(hotTeam.recent) && hotTeam.recent.length) {
    values = hotTeam.recent
      .map((entry) => (typeof entry.points === 'number' ? entry.points : null))
      .filter((val) => typeof val === 'number' && Number.isFinite(val));
  }

  if (!values.length && typeof hotTeam.points === 'number' && Number.isFinite(hotTeam.points)) {
    values = [hotTeam.points];
  }

  if (!values.length) {
    return [0, 200];
  }

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  let min = Math.floor(minVal / 20) * 20;
  let max = Math.ceil(maxVal / 20) * 20;

  if (min === max) {
    min -= 20;
    max += 20;
  }

  if (max <= 0) {
    max = 20;
  }

  return [min, max];
}

function HotTeamCard({ currentWeekOverride = null }) {
  const isMobile = useIsMobile();
  const myRosterId = useMyCurrentRosterId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hotTeam, setHotTeam] = useState(null);
  const [mobileTooltip, setMobileTooltip] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (cancelled) {
          return;
        }

        const { hotTeam: selectedHotTeam } = await selectHotTeam({
          currentWeekOverride,
        });

        if (cancelled) {
          return;
        }

        setHotTeam(selectedHotTeam);
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
  }, [currentWeekOverride]);

  let body = null;

  if (loading) {
    body = (
      <LoadingState
        className="active-playoffs-loading"
        label="Loading hot team…"
        ariaLabel="Loading hot team"
      />
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
          <div className="hot-team-left">
            <Link to={`/team/${hotTeam.rosterId}`} className={`hot-team-header hot-team-header--clickable${isMyRoster(hotTeam.rosterId, myRosterId) ? ' hot-team-header--me' : ''}`}>
              {hotTeam.avatarUrl && (
                <img
                  className="hot-team-avatar"
                  src={hotTeam.avatarUrl}
                  alt={`${hotTeam.teamName} avatar`}
                />
              )}
              <div className="hot-team-team-line">
                <span className="hot-team-team-name">
                  {hotTeam.teamName}
                  {isMyRoster(hotTeam.rosterId, myRosterId) ? <span className="me-chip">YOU</span> : null}
                </span>
              </div>
            </Link>
            <div className="hot-team-text">
              <div className="hot-team-score-lines">
                {(() => {
                  const rows = [];
                  if (Array.isArray(hotTeam.recent) && hotTeam.recent.length) {
                    const recentDesc = [...hotTeam.recent]
                      .sort((a, b) => b.week - a.week)
                      .slice(0, 3);
                    recentDesc.forEach((entry) => {
                      rows.push({
                        week: entry.week,
                        points: entry.points,
                      });
                    });
                  } else {
                    rows.push({
                      week: hotTeam.week,
                      points: hotTeam.points,
                    });
                  }
                  return rows.map((row) => (
                    <Link
                      to={`/team/${hotTeam.rosterId}?tab=scores&week=${row.week}`}
                      className="hot-team-score-line hot-team-score-line--clickable"
                      key={row.week}
                    >
                      <span className="hot-team-week-label">Week {row.week}</span>
                      <span className="hot-team-score">
                        {row.points.toFixed(1)}
                        <span className="hot-team-score-units"> pts</span>
                      </span>
                    </Link>
                  ));
                })()}
              </div>
            </div>
          </div>
          {Array.isArray(hotTeam.recent) &&
            hotTeam.recent.length >= 2 &&
            hotTeam.week > 2 && (
            <div className="hot-team-trend">
              {(() => {
                const [yMin, yMax] = computeYAxisDomain(hotTeam);
                
                const handleChartClick = (e) => {
                  if (!isMobile || !e || !e.activePayload || !e.activePayload[0]) {
                    return;
                  }
                  const payload = e.activePayload[0].payload;
                  setMobileTooltip({
                    week: payload.week,
                    points: payload.points,
                  });
                };

                return (
                  <>
                    <ResponsiveContainer width="100%" height={110}>
                      <LineChart
                        data={hotTeam.recent}
                        margin={{ top: 6, right: 6, left: 0, bottom: 2 }}
                        onClick={handleChartClick}
                      >
                        <CartesianGrid stroke="#2d3748" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="week"
                          tick={{ fill: '#a0aec0', fontSize: 10 }}
                          axisLine={{ stroke: '#4a5568' }}
                          tickLine={{ stroke: '#4a5568' }}
                          tickFormatter={(value) => Math.round(value)}
                          allowDecimals={false}
                        />
                        <YAxis
                          tick={{ fill: '#a0aec0', fontSize: 10 }}
                          axisLine={{ stroke: '#4a5568' }}
                          tickLine={{ stroke: '#4a5568' }}
                          width={32}
                          domain={[yMin, yMax]}
                          allowDecimals={false}
                          tickFormatter={(value) => Math.round(value)}
                        />
                        <Tooltip
                          formatter={(v) => [`${Number(v).toFixed(1)} pts`, 'Score']}
                          labelFormatter={(w) => `Week ${w}`}
                          contentStyle={{
                            backgroundColor: '#0f1430',
                            border: '1px solid #3a4466',
                            color: '#fff',
                          }}
                          wrapperClassName={isMobile ? 'home-chart-tooltip-hidden' : ''}
                        />
                        <Line
                          type="monotone"
                          dataKey="points"
                          stroke="#f6e05e"
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          activeDot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    {isMobile && mobileTooltip && (
                      <div className="home-chart-mobile-tooltip">
                        <button
                          className="home-chart-mobile-tooltip-close"
                          onClick={() => setMobileTooltip(null)}
                          aria-label="Close tooltip"
                        >
                          ×
                        </button>
                        <div className="home-chart-mobile-tooltip-content">
                          <div className="home-chart-mobile-tooltip-label">
                            Week {mobileTooltip.week}
                          </div>
                          <div className="home-chart-mobile-tooltip-value">
                            {Number(mobileTooltip.points).toFixed(1)} pts
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <HomeCard>
      <div className="home-card-inner">
        <div className="home-card-title-row">
          <h2 className="home-card-title">🔥 Hot Team Alert</h2>
          {hotTeam ? (
            <Link
              className="active-playoffs-link"
              to={`/team/${hotTeam.rosterId}`}
            >
              View Team →
            </Link>
          ) : null}
        </div>
        {body}
      </div>
    </HomeCard>
  );
}

export default HotTeamCard;


