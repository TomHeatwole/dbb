import React from 'react';
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

export default function TeamAnalytics() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '60vh', gap: '2.5rem', padding: '2rem 0' }}>
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