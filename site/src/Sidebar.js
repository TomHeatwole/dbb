import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTeamData } from './TeamLookup';
import { fetchPlayersData } from './PlayerLookup';

function Sidebar() {
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [teamsOpen, setTeamsOpen] = useState(false);

  useEffect(() => {
    async function loadTeams() {
      try {
        const { rosters, users } = await fetchTeamData();
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

  useEffect(() => {
    async function loadPlayers() {
      try {
        const data = await fetchPlayersData();
        // Convert to array and sort by name
        const playerArr = Object.entries(data)
          .map(([id, p]) => ({ id, name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setPlayers(playerArr);
      } catch (e) {
        setPlayers([]);
      }
    }
    loadPlayers();
  }, []);

  return (
    <div className="sidebar">
      <aside className="scroll-sidebar">
        <div className="scroll-top" />
        <div className="scroll-body">
          <nav>
            <ul>
              <li><Link to="/home/">Home</Link></li>
              <li>
                <div
                  className="dropdown-toggle"
                  onClick={() => setTeamsOpen(open => !open)}
                >
                  <span>Teams</span>
                  <span style={{ marginLeft: 8, fontSize: '0.85em' }}>{teamsOpen ? '▼' : '▶'}</span>
                </div>
                {teamsOpen && (
                  <ul className="dropdown-list" style={{ marginTop: 6, paddingLeft: 0 }}>
                    {teams.map(team => (
                      <li key={team.roster_id} style={{ paddingLeft: 18 }}>
                        <Link to={`/team/${team.roster_id}`}>{team.username}</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            </ul>
          </nav>
        </div>
        <div className="scroll-bottom" />
      </aside>
    </div>
  );
}

export default Sidebar; 