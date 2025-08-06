import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const data = [
  { name: 'Week 1', points: 120 },
  { name: 'Week 2', points: 98 },
  { name: 'Week 3', points: 110 },
  { name: 'Week 4', points: 130 },
  { name: 'Week 5', points: 105 },
  { name: 'Week 6', points: 115 },
];

const chartConfigs = [
  { title: 'Team Points Over Time' },
  { title: 'Bench Points Trend' },
  { title: 'Starter Consistency' },
  { title: 'Weekly Score Differential' },
  { title: 'Projected vs Actual Points' },
];

const WEEKS = Array.from({ length: 17 }, (_, i) => i + 1);

export default function TeamAnalytics() {
  const [searchParams, setSearchParams] = useSearchParams();
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
      {chartConfigs.map((config, idx) => (
        <div key={idx} style={{ width: '100%', maxWidth: 600, marginBottom: '1.5rem' }}>
          <h3 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>{config.title}</h3>
          <div style={{ width: '100%', height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="points" stroke="#8884d8" strokeWidth={2} activeDot={{ r: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  );
} 