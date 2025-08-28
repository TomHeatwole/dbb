import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, PieChart, Pie, Cell } from 'recharts';
import { getWeeklyStandings, getPositionalBreakdownData } from './ScoresParser';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from './PlayerLookup';
import PositionAnalytics from './PositionAnalytics';
import PositionBreakdownTable from './PositionBreakdownTable';
import PlayerBreakdownTable from './PlayerBreakdownTable';
import { STARTER_POSITION_NAMES } from './global_constants';
import { getDefaultDisplayWeek, CURRENT_YEAR } from './DateHelper';

const chartConfigs = [
  { title: 'Weekly Scores', key: 'weeklyScores' },
  { title: 'Bench Points Trend', key: 'benchTrend' },
  { title: 'Starter Consistency', key: 'starterConsistency' },
  { title: 'Weekly Score Differential', key: 'scoreDiff' },
  { title: 'Projected vs Actual Points', key: 'projVsActual' },
];

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

const TeamAnalytics = forwardRef(function TeamAnalytics({ weeksParsedData, teamName, rosters, users }, ref) {
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
  const startDropdownRef = useRef(null);
  const endDropdownRef = useRef(null);

  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);

  useEffect(() => {
    fetchPlayersData().then(setPlayersData);
    fetchPlayerIdMap().then(setPlayerIdMap);
  }, []);

  // Sync query params when startWeek or endWeek changes
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('start_week', startWeek);
    newParams.set('end_week', endWeek);
    newParams.set('tab', 'Analytics');
    setSearchParams(newParams, { replace: true });
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
    resetWeek: (season) => {
      const newParams = new URLSearchParams(searchParams);
      const startWeek = 1;
      const endWeek = getDefaultDisplayWeek(season);
      newParams.set('start_week', startWeek);
      newParams.set('end_week', endWeek);
      if (season === CURRENT_YEAR) {
        newParams.delete('year');
        setSearchParams(searchParams, { replace: true });
      } else {
        newParams.set('year', season);
      }
      setSearchParams(newParams, { replace: true });
      setStartWeek(startWeek);
      setEndWeek(endWeek);
    }
  }));

  // Get weekly standings for the selected window
  const weeklyStandings = getWeeklyStandings(weeksParsedData, startWeek, endWeek);

  // Call getPositionalBreakdownData and log the result
  const positionalBreakdown = getPositionalBreakdownData(weeksParsedData, startWeek, endWeek);

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

  // Build data for the chart
  const weeklyScoresData = weeklyStandings.map((weekArr, i) => {
    // Sort by points descending (already sorted in getWeeklyStandings)
    const user = weekArr.find(x => x.rosterId === rosterId);
    const pointsArr = weekArr.map(x => x.points).sort((a, b) => b - a);
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
      name: `Week ${startWeek + i}`,
      points: user ? user.points : 0,
      leagueCeiling,
      leagueFloor,
      leagueMedian: Math.round(leagueMedian * 10) / 10,
    };
  });

  return (
    <div className="team-analytics-root">
      {/* Weeks Selector */}
      <div className="team-scores-week-bar">
        <span className="team-analytics-week-from">From</span>
        <div
          className="team-scores-week-dropdown team-analytics-week-dropdown-start"
          onClick={() => setStartDropdownOpen(open => !open)}
          ref={startDropdownRef}
        >
          Week {startWeek}
          <span className="team-scores-week-dropdown-arrow">{startDropdownOpen ? '▲' : '▼'}</span>
          {startDropdownOpen && (
            <div className="team-scores-week-dropdown-list">
              {WEEKS.filter(w => w <= endWeek).map(week => (
                <div
                  key={week}
                  className={
                    'team-scores-week-dropdown-option' +
                    (startWeek === week ? ' team-scores-week-dropdown-option-active' : '')
                  }
                  onClick={() => { setStartWeek(week); setStartDropdownOpen(false); }}
                >
                  Week {week}
                </div>
              ))}
            </div>
          )}
        </div>
        <span className="team-analytics-week-to">to</span>
        <div
          className="team-scores-week-dropdown"
          onClick={() => setEndDropdownOpen(open => !open)}
          ref={endDropdownRef}
        >
          Week {endWeek}
          <span className="team-scores-week-dropdown-arrow">{endDropdownOpen ? '▲' : '▼'}</span>
          {endDropdownOpen && (
            <div className="team-scores-week-dropdown-list">
              {WEEKS.filter(w => w >= startWeek).map(week => (
                <div
                  key={week}
                  className={
                    'team-scores-week-dropdown-option' +
                    (endWeek === week ? ' team-scores-week-dropdown-option-active' : '')
                  }
                  onClick={() => { setEndWeek(week); setEndDropdownOpen(false); }}
                >
                  Week {week}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Charts */}
      {/* Weekly Scores chart (real data) */}
      <div className="team-analytics-chart-container">
        <h3 className="team-analytics-chart-title">Weekly Scores</h3>
        <div className="team-analytics-chart-inner">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weeklyScoresData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip contentStyle={{ backgroundColor: '#0f1430', border: '1px solid #3a4466', color: '#fff' }} labelStyle={{ color: '#fff', fontWeight: 700 }} />
              <Legend />
              <Line type="monotone" dataKey="points" stroke="#8884d8" strokeWidth={2} activeDot={{ r: 8 }} name={teamName || "Your Score"} />
              <Line type="monotone" dataKey="leagueCeiling" stroke="#00C49F" strokeWidth={2} name="League Ceiling" dot={false} strokeDasharray="6 6" />
              <Line type="monotone" dataKey="leagueFloor" stroke="#FF8042" strokeWidth={2} name="League Floor" dot={false} strokeDasharray="6 6" />
              <Line type="monotone" dataKey="leagueMedian" stroke="#0088FE" strokeWidth={2} name="League Median" dot={false} strokeDasharray="6 6" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Weekly Scores (Cumulative) chart */}
      <div className="team-analytics-chart-container">
        <h3 className="team-analytics-chart-title">Weekly Scores (Cumulative)</h3>
        <div className="team-analytics-chart-inner">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={
              weeklyStandings.map((weekArr, i) => {
                // Sort by runningTotalPoints descending
                const sorted = [...weekArr].sort((a, b) => b.runningTotalPoints - a.runningTotalPoints);
                const user = sorted.find(x => x.rosterId === rosterId);
                const runningArr = sorted.map(x => x.runningTotalPoints);
                const leagueCeiling = runningArr.length ? runningArr[0] : 0;
                const leagueFloor = runningArr.length ? runningArr[runningArr.length - 1] : 0;
                // Median: average of 5th and 6th place (0-based: 4 and 5)
                let leagueMedian = 0;
                if (runningArr.length >= 6) {
                  leagueMedian = (runningArr[4] + runningArr[5]) / 2;
                } else if (runningArr.length > 0) {
                  const mid = Math.floor(runningArr.length / 2);
                  leagueMedian = runningArr[mid];
                }
                return {
                  name: `Week ${startWeek + i}`,
                  runningTotalPoints: user ? user.runningTotalPoints : 0,
                  leagueCeiling,
                  leagueFloor,
                  leagueMedian: Math.round(leagueMedian * 10) / 10,
                };
              })
            } margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip contentStyle={{ backgroundColor: '#0f1430', border: '1px solid #3a4466', color: '#fff' }} labelStyle={{ color: '#fff', fontWeight: 700 }} />
              <Legend />
              {/* Area above playoff bar */}
              <defs>
                <linearGradient id="abovePlayoff" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#b3e5fc" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#b3e5fc" stopOpacity="0.05" />
                </linearGradient>
              </defs>
              <defs>
                <linearGradient id="betweenPlayoffAndCeiling" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#b3e5fc" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#b3e5fc" stopOpacity="0.05" />
                </linearGradient>
              </defs>
              <Line type="monotone" dataKey="runningTotalPoints" stroke="#8884d8" strokeWidth={2} activeDot={{ r: 8 }} name={teamName || "Your Score"} />
              <Line type="monotone" dataKey="leagueCeiling" stroke="#00C49F" strokeWidth={2} name="League Ceiling" dot={false} strokeDasharray="6 6" />
              <Line type="monotone" dataKey="leagueFloor" stroke="#FF8042" strokeWidth={2} name="League Floor" dot={false} strokeDasharray="6 6" />
              <Line type="monotone" dataKey="leagueMedian" stroke="#0088FE" strokeWidth={2} name="League Median" dot={false} strokeDasharray="6 6" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Weekly Scores (Cumulative - Relative to League Floor) chart */}
      <div className="team-analytics-chart-container">
        <h3 className="team-analytics-chart-title">Weekly Scores (Cumulative - Relative to League Floor)</h3>
        <div className="team-analytics-chart-inner">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={
              weeklyStandings.map((weekArr, i) => {
                // Sort by runningTotalPoints descending
                const sorted = [...weekArr].sort((a, b) => b.runningTotalPoints - a.runningTotalPoints);
                const user = sorted.find(x => x.rosterId === rosterId);
                const runningArr = sorted.map(x => x.runningTotalPoints);
                const leagueFloor = runningArr.length ? runningArr[runningArr.length - 1] : 0;
                const leagueCeiling = runningArr.length ? (runningArr[0] - leagueFloor) : 0;
                // Median: average of 5th and 6th place (0-based: 4 and 5)
                let leagueMedian = 0;
                if (runningArr.length >= 6) {
                  leagueMedian = ((runningArr[4] + runningArr[5]) / 2) - leagueFloor;
                } else if (runningArr.length > 0) {
                  const mid = Math.floor(runningArr.length / 2);
                  leagueMedian = runningArr[mid] - leagueFloor;
                }
                // Playoff Bar: average of 4th and 5th cumulative totals (0-based: 3 and 4),
                // fallback to 4th if exactly 4 teams, else median if fewer
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
                  name: `Week ${startWeek + i}`,
                  runningTotalPoints: user ? Math.round((user.runningTotalPoints - leagueFloor) * 10) / 10 : 0,
                  leagueCeiling: Math.round(leagueCeiling * 10) / 10,
                  leagueMedian: Math.round(leagueMedian * 10) / 10,
                  playoffBar: Math.round(playoffBar * 10) / 10,
                };
              })
            } margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis
                tickFormatter={v => (v >= 0 ? `+${v}` : v)}
              />
              <Tooltip formatter={v => (v >= 0 ? `+${v}` : v)} contentStyle={{ backgroundColor: '#0f1430', border: '1px solid #3a4466', color: '#fff' }} labelStyle={{ color: '#fff', fontWeight: 700 }} />
              <Legend />
              <Line type="monotone" dataKey="runningTotalPoints" stroke="#8884d8" strokeWidth={2} activeDot={{ r: 8 }} name={teamName || "Your Score"} />
              <Line type="monotone" dataKey="leagueCeiling" stroke="#00C49F" strokeWidth={2} name="League Ceiling" dot={false} strokeDasharray="6 6" />
              <Line type="monotone" dataKey="leagueMedian" stroke="#0088FE" strokeWidth={2} name="League Median" dot={false} strokeDasharray="6 6" />
              <Line type="monotone" dataKey="playoffBar" stroke="#FFD700" strokeWidth={2} name="Playoff Bar" dot={false} strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Player Breakdown Table */}
      <PlayerBreakdownTable
        weeksParsedData={weeksParsedData}
        rosterId={rosterId}
        startWeek={startWeek}
        endWeek={endWeek}
        playersData={playersData}
        playerIdMap={playerIdMap}
        STARTER_POSITION_NAMES={STARTER_POSITION_NAMES}
      />

      {/* Positional Averages Table */}
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
      />

      {STARTER_POSITION_NAMES.map((_, idx) => (
        <PositionAnalytics
          key={idx}
          pos={idx}
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
      ))}
    </div>
  );
});

export default TeamAnalytics; 