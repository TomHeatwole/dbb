import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, PieChart, Pie, Cell } from 'recharts';
import { getWeeklyStandings, getPositionalBreakdownData } from './ScoresParser';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from './PlayerLookup';
import PositionAnalytics from './PositionAnalytics';
import PositionBreakdownTable from './PositionBreakdownTable';
import { STARTER_POSITION_NAMES } from './global_constants';

const chartConfigs = [
  { title: 'Weekly Scores', key: 'weeklyScores' },
  { title: 'Bench Points Trend', key: 'benchTrend' },
  { title: 'Starter Consistency', key: 'starterConsistency' },
  { title: 'Weekly Score Differential', key: 'scoreDiff' },
  { title: 'Projected vs Actual Points', key: 'projVsActual' },
];

const WEEKS = Array.from({ length: 17 }, (_, i) => i + 1);

export default function TeamAnalytics({ weeksParsedData, teamName, rosters, users }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { id } = useParams();
  const rosterId = Number(id);
  const urlStartWeek = parseInt(searchParams.get('start_week'), 10);
  const urlEndWeek = parseInt(searchParams.get('end_week'), 10);
  const initialStartWeek = !isNaN(urlStartWeek) && urlStartWeek >= 1 && urlStartWeek <= 17 ? urlStartWeek : 1;
  const initialEndWeek = !isNaN(urlEndWeek) && urlEndWeek >= 1 && urlEndWeek <= 17 ? urlEndWeek : 17;

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

  // Update state if query params change (browser nav)
  useEffect(() => {
    if (!isNaN(urlStartWeek) && urlStartWeek !== startWeek && urlStartWeek >= 1 && urlStartWeek <= 17) setStartWeek(urlStartWeek);
    if (!isNaN(urlEndWeek) && urlEndWeek !== endWeek && urlEndWeek >= 1 && urlEndWeek <= 17) setEndWeek(urlEndWeek);
    // eslint-disable-next-line
  }, [urlStartWeek, urlEndWeek]);

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

  // Get weekly standings for the selected window
  const weeklyStandings = getWeeklyStandings(weeksParsedData, startWeek, endWeek);

  // Call getPositionalBreakdownData and log the result
  const positionalBreakdown = getPositionalBreakdownData(weeksParsedData, startWeek, endWeek);

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
              <Tooltip />
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
              <Tooltip />
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
                // Playoff Bar: 5th place running total (0-based index 4)
                const playoffBar = runningArr.length >= 5 ? (runningArr[4] - leagueFloor) : 0;
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
              <Tooltip formatter={v => (v >= 0 ? `+${v}` : v)} />
              <Legend />
              <Line type="monotone" dataKey="runningTotalPoints" stroke="#8884d8" strokeWidth={2} activeDot={{ r: 8 }} name={teamName || "Your Score"} />
              <Line type="monotone" dataKey="leagueCeiling" stroke="#00C49F" strokeWidth={2} name="League Ceiling" dot={false} strokeDasharray="6 6" />
              <Line type="monotone" dataKey="leagueMedian" stroke="#0088FE" strokeWidth={2} name="League Median" dot={false} strokeDasharray="6 6" />
              <Line type="monotone" dataKey="playoffBar" stroke="#FFD700" strokeWidth={2} name="Playoff Bar" dot={false} strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

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
        />
      ))}
    </div>
  );
} 