import React from 'react';
import { useParams } from 'react-router-dom';
import { getStandings, getPlayerTotals } from './ScoresParser';
import { getPlayerInfo } from './PlayerLookup';

function TeamSummary({ weeksParsedData, loading, playersData, playerIdMap }) {
  const { id } = useParams();
  const rosterId = Number(id);
  let standings = null;
  let myStanding = null;
  let playerTotals = null;
  let myPlayers = [];
  if (!loading && weeksParsedData) {
    standings = getStandings(weeksParsedData);
    myStanding = standings.find(s => s.roster_id === rosterId);
    playerTotals = getPlayerTotals(weeksParsedData);
    if (playerTotals && playerTotals[rosterId]) {
      myPlayers = playerTotals[rosterId].players
        .map(p => {
          const info = getPlayerInfo(p.id, playersData, playerIdMap);
          return { ...p, search_rank: info && info.search_rank !== undefined ? info.search_rank : 9999999 };
        })
        .sort((a, b) => {
          if (b.pts !== a.pts) return b.pts - a.pts;
          return a.search_rank - b.search_rank;
        })
        .slice(0, 5);
    }
  }

  if (loading) return <div>Loading summary...</div>;
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
          <div className="team-summary-top5">
            <strong className="team-summary-top5-title">Top 5 Scorers:</strong>
            <ul className="player-list">
              {myPlayers.map((p, i) => {
                const info = getPlayerInfo(p.id, playersData, playerIdMap);
                return (
                  <li key={p.id} className="player-list-item player-list-item-flex">
                    {info && info.espn_photo_url && (
                      <img src={info.espn_photo_url} alt={info.name} className="player-avatar player-avatar-style" />
                    )}
                    <span className="player-name">{info && info.name ? info.name : p.id}</span>
                    <span className="team-summary-top5-pts">{p.pts}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : (
        <div>No data for this team.</div>
      )}
    </div>
  );
}

export default TeamSummary; 