import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTeamData } from './TeamLookup';

function Sidebar() {
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    async function loadTeams() {
      try {
        const { rosters, users } = await fetchTeamData();
        // Map each roster to its owner user
        const teamLinks = rosters.map(roster => {
          const user = users.find(u => String(u.user_id) === String(roster.owner_id));
          return {
            roster_id: roster.roster_id,
            username: user ? user.display_name : `Team ${roster.roster_id}`
          };
        });
        setTeams(teamLinks);
      } catch (e) {
        setTeams([]);
      }
    }
    loadTeams();
  }, []);

  return (
    <div className="sidebar">
      <aside className="scroll-sidebar">
        <div className="scroll-top" />
        <div className="scroll-body">
          <nav>
            <ul>
              <li><Link to="/home/">Home</Link></li>
              {teams.map(team => (
                <li key={team.roster_id}>
                  <Link to={`/team/${team.roster_id}`}>{team.username}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="scroll-bottom" />
      </aside>
    </div>
  );
}

export default Sidebar; 