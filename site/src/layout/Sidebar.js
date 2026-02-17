import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayersData } from '../lookups/PlayerLookup';

const PODCAST_LINK = 'https://open.spotify.com/show/0bM4EGBJzZcMTj3VOpNLko';

function Sidebar() {
  const [teams, setTeams] = useState([]);
  const [, setPlayers] = useState([]);
  const [teamsOpen, setTeamsOpen] = useState(true);
  const location = useLocation();
  const isHome = location.pathname === '/home/' || location.pathname === '/althome';
  const [playUnroll, setPlayUnroll] = useState(false);


  useEffect(() => {
    if (isHome) {
      const t = setTimeout(() => setPlayUnroll(true), 50);
      const t2 = setTimeout(() => setPlayUnroll(false), 2550);
      return () => {
        clearTimeout(t);
        clearTimeout(t2);
      };
    } else {
      setPlayUnroll(false);
    }
  }, [isHome]);

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
      <aside className={`scroll-sidebar${playUnroll ? ' scroll-animating' : ''}`}>
        <div className="scroll-top" />
        <div className="scroll-body">
          <nav>
            <ul>
              <li><Link to="/home/">Home</Link></li>
              <li><Link to="/Scores/Week">Scores</Link></li>
              <li><Link to="/standings">Standings</Link></li>
              <li><Link to="/h2h">Head to Head</Link></li>
              <li><Link to="/yoffs">Playoffs</Link></li>
              <li><Link to="/trades">Trades</Link></li>
              <li><a href={PODCAST_LINK} target="_blank" rel="noopener noreferrer">Podcast</a></li>
              <li>
                <div
                  className="dropdown-toggle"
                  onClick={() => setTeamsOpen(open => !open)}
                >
                  <span>Teams</span>
                  <span className="sidebar-teams-arrow">{teamsOpen ? '▼' : '▶'}</span>
                </div>
                {teamsOpen && (
                  <ul className="dropdown-list sidebar-dropdown-list">
                    {teams.map(team => (
                      <li key={team.roster_id} className="sidebar-dropdown-list-item">
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