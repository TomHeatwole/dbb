import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, PieChart, Pie, Cell } from 'recharts';
import { getWeeklyStandings, getPositionalBreakdownData } from './ScoresParser';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from './PlayerLookup';

const chartConfigs = [
  { title: 'Weekly Scores', key: 'weeklyScores' },
  { title: 'Bench Points Trend', key: 'benchTrend' },
  { title: 'Starter Consistency', key: 'starterConsistency' },
  { title: 'Weekly Score Differential', key: 'scoreDiff' },
  { title: 'Projected vs Actual Points', key: 'projVsActual' },
];

const WEEKS = Array.from({ length: 17 }, (_, i) => i + 1);

export default function TeamAnalytics({ weeksParsedData, teamName }) {
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

  // QB1 (position 0) chart data
  const qb1ChartData = [];
  for (let weekIdx = 0; weekIdx < (endWeek - startWeek + 1); ++weekIdx) {
    const weekNum = startWeek + weekIdx;
    // For this week, gather all teams' QB1 scores
    const week = weeksParsedData[weekNum - 1];
    if (!week) continue;
    const qb1Scores = week.map(entry => (entry && entry.starters_points && entry.starters_points[0] != null) ? entry.starters_points[0] : 0);
    const userEntry = week.find(entry => entry && entry.roster_id === rosterId);
    const userQB1 = userEntry && userEntry.starters_points && userEntry.starters_points[0] != null ? userEntry.starters_points[0] : 0;
    const sorted = [...qb1Scores].sort((a, b) => b - a);
    const leagueCeiling = sorted.length ? sorted[0] : 0;
    const leagueFloor = sorted.length ? sorted[sorted.length - 1] : 0;
    let leagueMedian = 0;
    if (sorted.length >= 6) {
      leagueMedian = (sorted[4] + sorted[5]) / 2;
    } else if (sorted.length > 0) {
      const mid = Math.floor(sorted.length / 2);
      leagueMedian = sorted[mid];
    }
    qb1ChartData.push({
      name: `Week ${weekNum}`,
      userQB1: Math.round(userQB1 * 10) / 10,
      leagueCeiling: Math.round(leagueCeiling * 10) / 10,
      leagueFloor: Math.round(leagueFloor * 10) / 10,
      leagueMedian: Math.round(leagueMedian * 10) / 10,
    });
  }

  // QB1 breakdown pie chart data
  let qb1BreakdownData = [];
  if (positionalBreakdown && positionalBreakdown.length && playersData && playerIdMap) {
    const userTeam = positionalBreakdown.find(t => t.roster_id === rosterId);
    if (userTeam && userTeam.positional_player_breakdown && userTeam.positional_player_breakdown[0]) {
      qb1BreakdownData = Object.entries(userTeam.positional_player_breakdown[0])
        .map(([playerId, data]) => {
          const info = getPlayerInfo(playerId, playersData, playerIdMap);
          return {
            playerId,
            count: data.starts,
            cumulative_score: data.cumulative_score,
            name: info ? info.name : playerId,
            position: info ? info.position : '',
            img: info ? info.espn_photo_url : null,
          };
        })
        .sort((a, b) => b.count - a.count);
    }
  }

  // Color palette for pie slices
  const pieColors = [
    '#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#0088FE', '#00C49F', '#FFBB28', '#FF4444', '#A28FD0', '#FFB6B9', '#B5EAD7', '#C7CEEA', '#FFDAC1', '#E2F0CB', '#B5EAD7', '#FF9AA2'
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '60vh', gap: '2.5rem', padding: '0 0 2rem 0' }}>
      {/* Weeks Selector */}
      <div className="team-scores-week-bar">
        <span style={{ marginRight: 10 }}>From</span>
        <div
          className="team-scores-week-dropdown"
          onClick={() => setStartDropdownOpen(open => !open)}
          ref={startDropdownRef}
          style={{ marginRight: 16 }}
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
        <span style={{ margin: '0 10px' }}>to</span>
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
      <div style={{ width: '100%', maxWidth: '900px', marginBottom: '1.5rem' }}>
        <h3 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>Weekly Scores</h3>
        <div style={{ width: '100%', height: 420 }}>
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
      <div style={{ width: '100%', maxWidth: '900px', marginBottom: '1.5rem' }}>
        <h3 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>Weekly Scores (Cumulative)</h3>
        <div style={{ width: '100%', height: 420 }}>
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
                // Playoff Bar: 5th place running total (0-based index 4)
                const playoffBar = runningArr.length >= 5 ? runningArr[4] : 0;
                return {
                  name: `Week ${startWeek + i}`,
                  runningTotalPoints: user ? user.runningTotalPoints : 0,
                  leagueCeiling,
                  leagueFloor,
                  leagueMedian: Math.round(leagueMedian * 10) / 10,
                  playoffBar,
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
              <Line type="monotone" dataKey="playoffBar" stroke="#FFD700" strokeWidth={2} name="Playoff Bar" dot={false} strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* QB1 (Position 0) chart */}
      <div style={{ width: '100%', maxWidth: '900px', marginBottom: '1.5rem' }}>
        <h3 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>QB1 Weekly Scores</h3>
        <div style={{ width: '100%', height: 420 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={qb1ChartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="userQB1" stroke="#8884d8" strokeWidth={2} activeDot={{ r: 8 }} name={teamName || "Your QB1"} />
              <Line type="monotone" dataKey="leagueCeiling" stroke="#00C49F" strokeWidth={2} name="League Ceiling" dot={false} strokeDasharray="6 6" />
              <Line type="monotone" dataKey="leagueFloor" stroke="#FF8042" strokeWidth={2} name="League Floor" dot={false} strokeDasharray="6 6" />
              <Line type="monotone" dataKey="leagueMedian" stroke="#0088FE" strokeWidth={2} name="League Median" dot={false} strokeDasharray="6 6" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* QB1 Breakdown Pie Chart */}
      <div style={{ width: '100%', maxWidth: '900px', margin: '0 auto 2rem auto' }}>
        <h3 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>QB1 Breakdown</h3>
        <div style={{ width: '100%', height: 420, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {qb1BreakdownData.length > 0 ? (
            <ResponsiveContainer width={700} height={420}>
              <PieChart>
                <Pie
                  data={qb1BreakdownData}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={120}
                  label={({ name, count }) => `${name} (${count})`}
                >
                  {qb1BreakdownData.map((entry, idx) => (
                    <Cell key={`cell-${entry.playerId}`} fill={pieColors[idx % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      // Find userTeam and QB1 breakdown for richer info
                      const userTeam = positionalBreakdown.find(t => t.roster_id === rosterId);
                      const qb1Breakdown = userTeam && userTeam.positional_player_breakdown && userTeam.positional_player_breakdown[0];
                      const totalStarts = endWeek - startWeek + 1;
                      const qb1Scores = userTeam && userTeam.positional_scores && userTeam.positional_scores[0];
                      const playerStarts = d.count;
                      const startPct = totalStarts > 0 ? Math.round((playerStarts / totalStarts) * 1000) / 10 : 0;
                      // Compute average score as QB1 for this player using new structure
                      let avgScore = 0;
                      if (d.count > 0 && d.cumulative_score !== undefined) {
                        avgScore = Math.round((d.cumulative_score / d.count) * 10) / 10;
                      }
                      return (
                        <div style={{ background: '#fff', border: '1px solid #ccc', padding: 10, color: '#111', textAlign: 'center' }}>
                          {d.img && <img src={d.img} alt={d.name} style={{ width: 48, height: 48, borderRadius: '50%', margin: '0 auto 8px auto', display: 'block' }} />}
                          <div><b>{d.name} ({d.position})</b></div>
                          <div><b>QB1 starts:</b> {playerStarts}</div>
                          <div><b>QB1 start percentage:</b> {startPct}%</div>
                          <div><b>Avg score as QB1:</b> {avgScore}</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ textAlign: 'center', color: '#888' }}>No QB1 data available.</div>
          )}
        </div>
      </div>
    </div>
  );
} 