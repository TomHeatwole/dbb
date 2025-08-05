import React from 'react';

function TeamSummary({ weeksParsedData, loading }) {
  if (loading) return <div>Loading summary...</div>;
  if (!weeksParsedData) return <div>No summary data found.</div>;

  return (
    <div>
      <div>Weeks loaded: {weeksParsedData ? weeksParsedData.length : 0}</div>
      <div>Score breakdowns in week 1: {weeksParsedData && weeksParsedData[0] ? weeksParsedData[0].length : 0}</div>
    </div>
  );
}

export default TeamSummary; 