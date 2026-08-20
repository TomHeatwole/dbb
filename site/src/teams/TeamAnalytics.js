import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { getWeeklyStandings, getPositionalBreakdownData, getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import PositionAnalytics from '../players/PositionAnalytics';
import PositionBreakdownTable from '../players/PositionBreakdownTable';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import { getDefaultDisplayWeek, CURRENT_YEAR, getCurrentNFLWeek, isCurrentWeekCompleted } from '../utils/DateHelper';
import LoadingState from '../LoadingState';
import { AnalyticsLineChart, ANALYTICS_SERIES, formatWeekTick } from './AnalyticsCharts';

const WEEKS = Array.from({ length: 17 }, (_, i) => i + 1);

function hslToHex(h, s, l) {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n) => lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => {
    const v = Math.round(255 * x).toString(16).padStart(2, '0');
    return v;
  };
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

const TeamAnalytics = forwardRef(function TeamAnalytics({ weeksParsedData, teamName, rosters, users, updateQueryParams }, ref) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { id } = useParams();
  const rosterId = Number(id);
  const urlStartWeek = parseInt(searchParams.get('start_week'), 10);
  const urlEndWeek = parseInt(searchParams.get('end_week'), 10);
  const urlYear = searchParams.get('year');
  const initialStartWeek = !isNaN(urlStartWeek) && urlStartWeek >= 1 && urlStartWeek <= 17 ? urlStartWeek : 1;
  const initialEndWeek = !isNaN(urlEndWeek) && urlEndWeek >= 1 && urlEndWeek <= 17 ? urlEndWeek : getDefaultDisplayWeek(urlYear);

  const [startWeek, setStartWeek] = useState(initialStartWeek);
  const [endWeek, setEndWeek] = useState(initialEndWeek);
  const [startDropdownOpen, setStartDropdownOpen] = useState(false);
  const [endDropdownOpen, setEndDropdownOpen] = useState(false);
  const [activePos, setActivePos] = useState(0);
  const startDropdownRef = useRef(null);
  const endDropdownRef = useRef(null);

  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    const param = (String(urlYear || CURRENT_YEAR) === String(CURRENT_YEAR)) ? null : String(urlYear);
    let cancelled = false;
    setDataLoading(true);
    Promise.all([
      fetchPlayersData(param),
      fetchPlayerIdMap()
    ]).then(([p, m]) => {
      if (!cancelled) {
        setPlayersData(p);
        setPlayerIdMap(m);
        setDataLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setDataLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [urlYear]);

  // Sync start/end and tab only via parent updaters to avoid param flapping
  useEffect(() => {
    if (!updateQueryParams) {
      const newParams = new URLSearchParams(searchParams);
      newParams.set('start_week', startWeek);
      newParams.set('end_week', endWeek);
      newParams.set('tab', 'Team Analytics');
      setSearchParams(newParams, { replace: true });
    } else {
      updateQueryParams({ start_week: startWeek, end_week: endWeek, tab: 'Team Analytics' });
    }
    // eslint-disable-next-line
  }, [startWeek, endWeek]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e) {
      if (startDropdownRef.current && !startDropdownRef.current.contains(e.target)) {
        setStartDropdownOpen(false);
      }
      if (endDropdownRef.current && !endDropdownRef.current.contains(e.target)) {
        setEndDropdownOpen(false);
      }
    }
    if (startDropdownOpen || endDropdownOpen) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [startDropdownOpen, endDropdownOpen]);

  useImperativeHandle(ref, () => ({
    resetWeek: async (season) => {
      const newStart = 1;
      let newEnd = 17;
      const isCurr = String(season || CURRENT_YEAR) === String(CURRENT_YEAR);
      if (isCurr) {
        try {
          const cw = getCurrentNFLWeek(season || CURRENT_YEAR);
          const done = await isCurrentWeekCompleted(season || CURRENT_YEAR);
          newEnd = done ? cw : Math.max(1, cw - 1);
        } catch (_) {
          const cw = getCurrentNFLWeek(season || CURRENT_YEAR);
          newEnd = Math.max(1, cw - 1);
        }
      } else {
        newEnd = 17;
      }
      setStartWeek(newStart);
      setEndWeek(newEnd);
      if (updateQueryParams) {
        updateQueryParams({ start_week: newStart, end_week: newEnd, tab: 'Team Analytics', year: season === CURRENT_YEAR ? null : season });
      } else {
        const newParams = new URLSearchParams(searchParams);
        newParams.set('start_week', newStart);
        newParams.set('end_week', newEnd);
        if (season === CURRENT_YEAR) { newParams.delete('year'); } else { newParams.set('year', season); }
        setSearchParams(newParams, { replace: true });
      }
    }
  }));

  // Exclude the current week only if not completed (DB-aware)
  const isCurrentSeason = !urlYear || String(urlYear) === String(CURRENT_YEAR);
  const currentWeek = getCurrentNFLWeek(CURRENT_YEAR);
  const [currentWeekCompleted, setCurrentWeekCompleted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const done = await isCurrentWeekCompleted(urlYear || CURRENT_YEAR);
        if (!cancelled) setCurrentWeekCompleted(!!done);
      } catch (_) {
        if (!cancelled) setCurrentWeekCompleted(false);
      }
    })();
    return () => { cancelled = true; };
  }, [urlYear]);
  const adjustedEndWeek = isCurrentSeason && !currentWeekCompleted ? Math.min(endWeek, Math.max(0, currentWeek - 1)) : endWeek;
  const adjustedStartWeek = isCurrentSeason ? Math.min(startWeek, adjustedEndWeek) : startWeek;

  // When urlYear changes (season switch), reset start/end to completed weeks only (DB-aware)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const season = urlYear || CURRENT_YEAR;
      const isCurr = String(season) === String(CURRENT_YEAR);
      const newStart = 1;
      let newEnd = 17;
      if (isCurr) {
        try {
          const cw = getCurrentNFLWeek(season);
          const done = await isCurrentWeekCompleted(season);
          newEnd = done ? cw : Math.max(1, cw - 1);
        } catch (_) {
          const cw = getCurrentNFLWeek(season);
          newEnd = Math.max(1, cw - 1);
        }
      } else {
        newEnd = 17;
      }
      if (!cancelled) {
        setStartWeek(newStart);
        setEndWeek(newEnd);
      }
    })();
    return () => { cancelled = true; };
  }, [urlYear]);

  // On initial mount, if no explicit start/end in URL, set defaults to completed weeks only
  useEffect(() => {
    if (!isNaN(urlStartWeek) || !isNaN(urlEndWeek)) { return; }
    let cancelled = false;
    (async () => {
      const season = urlYear || CURRENT_YEAR;
      const isCurr = String(season) === String(CURRENT_YEAR);
      const newStart = 1;
      let newEnd = 17;
      if (isCurr) {
        try {
          const cw = getCurrentNFLWeek(season);
          const done = await isCurrentWeekCompleted(season);
          newEnd = done ? cw : Math.max(1, cw - 1);
        } catch (_) {
          const cw = getCurrentNFLWeek(season);
          newEnd = Math.max(1, cw - 1);
        }
      } else {
        newEnd = 17;
      }
      if (!cancelled) {
        setStartWeek(newStart);
        setEndWeek(newEnd);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Memoize expensive data computations
  const weeklyStandings = useMemo(() => {
    if (!weeksParsedData) return [];
    return getWeeklyStandings(weeksParsedData, adjustedStartWeek, adjustedEndWeek);
  }, [weeksParsedData, adjustedStartWeek, adjustedEndWeek]);

  const positionalBreakdown = useMemo(() => {
    if (!weeksParsedData) return [];
    return getPositionalBreakdownData(weeksParsedData, adjustedStartWeek, adjustedEndWeek);
  }, [weeksParsedData, adjustedStartWeek, adjustedEndWeek]);

  // Build a stable, uniformly distributed playerId -> color mapping for this roster/time window
  const playerColorMap = useMemo(() => {
    const map = {};
    const userTeam = positionalBreakdown && positionalBreakdown.find && positionalBreakdown.find(t => t.roster_id === rosterId);
    if (!userTeam || !userTeam.positional_player_breakdown) {
      return map;
    }
    const playerIdSet = new Set();
    Object.values(userTeam.positional_player_breakdown).forEach((posObj) => {
      if (!posObj) {
        return;
      }
      Object.keys(posObj).forEach((playerId) => playerIdSet.add(playerId));
    });
    const playerIds = Array.from(playerIdSet).sort();
    const n = playerIds.length;
    if (n === 0) {
      return map;
    }
    // Exclude the red/pink band by using a hue span from 20deg to 340deg (span 320deg)
    const hueStart = 20; // start just past red/orange
    const hueSpan = 320; // leave out 40 degrees near magenta/pink
    const saturation = 65;
    const lightness = 50;
    for (let i = 0; i < n; i++) {
      const hue = hueStart + (hueSpan * i) / n;
      map[playerIds[i]] = hslToHex(hue, saturation, lightness);
    }
    return map;
  }, [positionalBreakdown, rosterId]);

  const playerSeasonTotalsMap = useMemo(() => {
    return getPlayerSeasonTotalsMap(weeksParsedData);
  }, [weeksParsedData]);

  // Early return AFTER all hooks: Show loading state until all required data is ready
  if (dataLoading || !playersData || !playerIdMap || !weeksParsedData || !Array.isArray(weeksParsedData) || weeksParsedData.length === 0) {
    return (
      <div className="team-analytics">
        <LoadingState label="Loading analytics…" />
      </div>
    );
  }

  // Build data for the chart using StartSit totals per week
  const weeklyScoresData = weeklyStandings.map((weekArr, i) => {
    const weekNum = adjustedStartWeek + i;
    const breakdown = getWeekScoreBreakdown(weeksParsedData, weekNum) || {};
    const computedWeek = weekArr.map(row => {
      const rid = row.rosterId;
      const raw = breakdown[rid];
      let pts = row.points;
      if (raw) {
        const computed = StartSitSort(raw, playersData, playerIdMap, null, null, playerSeasonTotalsMap);
        pts = computed && typeof computed.starterTotal === 'number' ? computed.starterTotal : pts;
      }
      return { rosterId: rid, points: pts };
    });
    const user = computedWeek.find(x => x.rosterId === rosterId);
    const pointsArr = computedWeek.map(x => x.points).sort((a, b) => b - a);
    const leagueCeiling = pointsArr.length ? pointsArr[0] : 0;
    const leagueFloor = pointsArr.length ? pointsArr[pointsArr.length - 1] : 0;
    // Median: average of 5th and 6th place (0-based: 4 and 5)
    let leagueMedian = 0;
    if (pointsArr.length >= 6) {
      leagueMedian = (pointsArr[4] + pointsArr[5]) / 2;
    } else if (pointsArr.length > 0) {
      // Fallback: just use the middle value if not enough teams
      const mid = Math.floor(pointsArr.length / 2);
      leagueMedian = pointsArr[mid];
    }
    return {
      name: `Week ${weekNum}`,
      points: user ? user.points : 0,
      leagueCeiling,
      leagueFloor,
      leagueMedian: Math.round(leagueMedian * 10) / 10,
    };
  });

  const showWeekInfo = isCurrentSeason && startWeek <= currentWeek && endWeek >= currentWeek;
  const teamLineName = teamName || 'This team';

  const scoreSummary = (() => {
    if (!weeklyScoresData.length) return null;
    const pts = weeklyScoresData.map((d) => d.points);
    const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
    const medAvg = weeklyScoresData.reduce((a, d) => a + d.leagueMedian, 0) / weeklyScoresData.length;
    const vsMed = avg - medAvg;
    let high = weeklyScoresData[0];
    let low = weeklyScoresData[0];
    weeklyScoresData.forEach((d) => {
      if (d.points > high.points) high = d;
      if (d.points < low.points) low = d;
    });
    return { avg, vsMed, high, low };
  })();

  const relativeData = weeklyStandings.map((weekArr, i) => {
    const sorted = [...weekArr].sort((a, b) => b.runningTotalPoints - a.runningTotalPoints);
    const user = sorted.find(x => x.rosterId === rosterId);
    const runningArr = sorted.map(x => x.runningTotalPoints);
    const leagueFloor = runningArr.length ? runningArr[runningArr.length - 1] : 0;
    const leagueCeiling = runningArr.length ? (runningArr[0] - leagueFloor) : 0;
    let leagueMedian = 0;
    if (runningArr.length >= 6) {
      leagueMedian = ((runningArr[4] + runningArr[5]) / 2) - leagueFloor;
    } else if (runningArr.length > 0) {
      const mid = Math.floor(runningArr.length / 2);
      leagueMedian = runningArr[mid] - leagueFloor;
    }
    let playoffBarAbs = 0;
    if (runningArr.length >= 5) {
      playoffBarAbs = (runningArr[3] + runningArr[4]) / 2;
    } else if (runningArr.length >= 4) {
      playoffBarAbs = runningArr[3];
    } else if (runningArr.length > 0) {
      playoffBarAbs = runningArr[Math.floor(runningArr.length / 2)];
    }
    const playoffBar = playoffBarAbs - leagueFloor;
    return {
      name: `Week ${adjustedStartWeek + i}`,
      runningTotalPoints: user ? Math.round((user.runningTotalPoints - leagueFloor) * 10) / 10 : 0,
      leagueCeiling: Math.round(leagueCeiling * 10) / 10,
      leagueMedian: Math.round(leagueMedian * 10) / 10,
      playoffBar: Math.round(playoffBar * 10) / 10,
    };
  });

  const fmt1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
  const fmtSigned = (v) => {
    if (!Number.isFinite(v)) return '—';
    const abs = Math.abs(v).toFixed(1);
    return v > 0 ? `+${abs}` : v < 0 ? `−${abs}` : abs;
  };

  const scoreLines = [
    { dataKey: 'points', stroke: ANALYTICS_SERIES.team, name: teamLineName, activeDot: { r: 5 } },
    { dataKey: 'leagueCeiling', stroke: ANALYTICS_SERIES.ceiling, name: 'Ceiling', strokeDasharray: '5 5' },
    { dataKey: 'leagueMedian', stroke: ANALYTICS_SERIES.median, name: 'Median', strokeDasharray: '5 5' },
    { dataKey: 'leagueFloor', stroke: ANALYTICS_SERIES.floor, name: 'Floor', strokeDasharray: '5 5' },
  ];

  return (
    <div className="team-analytics">
      <div className="team-analytics-toolbar">
        <div className="team-analytics-range">
          <span className="team-analytics-range-kicker">Weeks</span>
          <div
            className="team-analytics-week-dropdown"
            onClick={() => setStartDropdownOpen(open => !open)}
            ref={startDropdownRef}
          >
            {startWeek}
            <span className="team-analytics-week-caret">{startDropdownOpen ? '▲' : '▼'}</span>
            {startDropdownOpen && (
              <div className="team-analytics-week-menu" onClick={(e) => e.stopPropagation()}>
                {WEEKS.filter(w => w <= endWeek).map(week => (
                  <div
                    key={week}
                    className={'team-analytics-week-option' + (startWeek === week ? ' team-analytics-week-option--active' : '')}
                    onClick={() => { setStartWeek(week); setStartDropdownOpen(false); }}
                  >
                    {week}
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="team-analytics-range-sep">–</span>
          <div
            className="team-analytics-week-dropdown"
            onClick={() => setEndDropdownOpen(open => !open)}
            ref={endDropdownRef}
          >
            {endWeek}
            <span className="team-analytics-week-caret">{endDropdownOpen ? '▲' : '▼'}</span>
            {endDropdownOpen && (
              <div className="team-analytics-week-menu" onClick={(e) => e.stopPropagation()}>
                {WEEKS.filter(w => w >= startWeek).map(week => (
                  <div
                    key={week}
                    className={'team-analytics-week-option' + (endWeek === week ? ' team-analytics-week-option--active' : '')}
                    onClick={() => { setEndWeek(week); setEndDropdownOpen(false); }}
                  >
                    {week}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {showWeekInfo && (
          <div className="team-analytics-note" title="Team Analytics updates after each NFL week is complete. Current week data appears once all games are final.">
            Updates after each week is complete
          </div>
        )}
      </div>

      {scoreSummary && (
        <div className="team-analytics-stat-grid">
          <div className="team-analytics-stat">
            <span className="team-analytics-stat-value">{fmt1(scoreSummary.avg)}</span>
            <span className="team-analytics-stat-label">PPG</span>
          </div>
          <div className="team-analytics-stat">
            <span className={`team-analytics-stat-value${scoreSummary.vsMed > 0 ? ' is-pos' : scoreSummary.vsMed < 0 ? ' is-neg' : ''}`}>
              {fmtSigned(scoreSummary.vsMed)}
            </span>
            <span className="team-analytics-stat-label">vs median</span>
          </div>
          <div className="team-analytics-stat">
            <span className="team-analytics-stat-value is-pos">{fmt1(scoreSummary.high.points)}</span>
            <span className="team-analytics-stat-label">High · {formatWeekTick(scoreSummary.high.name)}</span>
          </div>
          <div className="team-analytics-stat">
            <span className="team-analytics-stat-value is-neg">{fmt1(scoreSummary.low.points)}</span>
            <span className="team-analytics-stat-label">Low · {formatWeekTick(scoreSummary.low.name)}</span>
          </div>
        </div>
      )}

      <section className="team-analytics-section">
        <div className="team-analytics-section-label">Scoring</div>
        <div className="team-analytics-score-grid">
          <div className="team-analytics-card">
            <div className="team-analytics-card-head">
              <h3 className="team-analytics-card-title">Weekly scores</h3>
              <p className="team-analytics-card-sub">Starter totals vs league ceiling, median, and floor</p>
            </div>
            <AnalyticsLineChart data={weeklyScoresData} lines={scoreLines} />
          </div>
          <div className="team-analytics-card">
            <div className="team-analytics-card-head">
              <h3 className="team-analytics-card-title">Relative to league floor</h3>
              <p className="team-analytics-card-sub">Cumulative gap over the lowest total, with the playoff bar</p>
            </div>
            <AnalyticsLineChart
              data={relativeData}
              lines={[
                { dataKey: 'runningTotalPoints', stroke: ANALYTICS_SERIES.team, name: teamLineName, activeDot: { r: 5 } },
                { dataKey: 'leagueCeiling', stroke: ANALYTICS_SERIES.ceiling, name: 'Ceiling', strokeDasharray: '5 5' },
                { dataKey: 'leagueMedian', stroke: ANALYTICS_SERIES.median, name: 'Median', strokeDasharray: '5 5' },
                { dataKey: 'playoffBar', stroke: ANALYTICS_SERIES.playoff, name: 'Playoff bar', strokeDasharray: '3 3' },
              ]}
              yTickFormatter={(v) => (v >= 0 ? `+${v}` : String(v))}
              tooltipFormatter={(v) => (v >= 0 ? `+${v}` : v)}
            />
          </div>
        </div>
      </section>

      <section className="team-analytics-section">
        <div className="team-analytics-section-label">Positions</div>
        <div className="team-analytics-positions-layout">
          <PositionBreakdownTable
            weeksParsedData={weeksParsedData}
            rosterId={rosterId}
            startWeek={startWeek}
            endWeek={endWeek}
            STARTER_POSITION_NAMES={STARTER_POSITION_NAMES}
            rosters={rosters}
            users={users}
            teamName={teamName}
            searchParams={searchParams}
            selectedPos={activePos}
            onSelectPosition={setActivePos}
          />
          <PositionAnalytics
            pos={activePos}
            positionalBreakdown={positionalBreakdown}
            weeksParsedData={weeksParsedData}
            startWeek={startWeek}
            endWeek={endWeek}
            rosterId={rosterId}
            teamName={teamName}
            playersData={playersData}
            playerIdMap={playerIdMap}
            playerColorMap={playerColorMap}
          />
        </div>
      </section>
    </div>
  );
});

export default TeamAnalytics; 