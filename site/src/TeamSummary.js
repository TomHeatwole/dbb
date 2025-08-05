import React, { useEffect, useState } from 'react';
import { fetchScoresData } from './ScoresLookup';

function TeamSummary() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const data = await fetchScoresData('2024'); 
      setSummary(data);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div>Loading summary...</div>;
  if (!summary) return <div>No summary data found.</div>;

  return (
    <div>
      <div>Summary loaded for season: {summary.season}</div>
      <div>Weeks loaded: {summary.weeksParsedData ? summary.weeksParsedData.length : 0}</div>
      <div>Score breakdowns in week 1: {summary.weeksParsedData && summary.weeksParsedData[0] ? summary.weeksParsedData[0].length : 0}</div>
    </div>
  );
}

export default TeamSummary; 