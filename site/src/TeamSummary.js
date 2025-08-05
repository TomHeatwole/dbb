import React from 'react';
import { useParams } from 'react-router-dom';
import { getStandings } from './ScoresParser';

function TeamSummary({ weeksParsedData, loading }) {
  const { id } = useParams();
  const rosterId = Number(id);
  let standings = null;
  let myStanding = null;
  if (!loading && weeksParsedData) {
    standings = getStandings(weeksParsedData);
    myStanding = standings.find(s => s.roster_id === rosterId);
  }

  if (loading) return <div>Loading summary...</div>;
  if (!weeksParsedData) return <div>No summary data found.</div>;

  return (
    <div>
      {myStanding ? (
        <>
          <div>Points Scored: {myStanding.points_scored}</div>
          <div>
            Place: {myStanding.place}
            {myStanding.numTied > 1 && (
              <> ({myStanding.numTied}-way Tie)</>
            )}
          </div>
        </>
      ) : (
        <div>No data for this team.</div>
      )}
    </div>
  );
}

export default TeamSummary; 