import React from 'react';
import { useParams } from 'react-router-dom';
import { getStandings } from './ScoresParser';
import FullRoster from './FullRoster';

function TeamSummary({ weeksParsedData, loading, playersData, playerIdMap, playerList }) {
  const { id } = useParams();
  const rosterId = Number(id);
  let standings = null;
  let myStanding = null;
  if (!loading && weeksParsedData) {
    standings = getStandings(weeksParsedData);
    myStanding = standings.find(s => s.roster_id === rosterId);
  }

  if (loading) return (
    <div className="loading-center">
      <div className="spinner" aria-label="Loading" />
      <div className="loading-text">Loading summary…</div>
    </div>
  );
  if (!weeksParsedData) return <div>No summary data found.</div>;

  return (
    <div className="team-summary-root">
      {myStanding ? (
        <>
          <div className="team-summary-place">
            Place: #{myStanding.place}
            {myStanding.numTied > 1 && (
              <span className="team-summary-tie">
                ({myStanding.numTied}-way Tie)
              </span>
            )}
          </div>
          <div className="team-summary-points">
            {myStanding.points_scored} Fantasy Points
          </div>
          <FullRoster playerList={playerList} />
        </>
      ) : (
        <div>No data for this team.</div>
      )}
    </div>
  );
}

export default TeamSummary; 