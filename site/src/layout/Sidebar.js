import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayersData } from '../lookups/PlayerLookup';
import { findMyRosterId, isMyRoster, useAuthUser } from '../hooks/useAuthUser';
import SignOutControl from './SignOutControl';
import { inkNavClass, navIsActive, navIsAnyActive, NAV_MATCH } from './navActive';

const PODCAST_LINK = 'https://open.spotify.com/show/0bM4EGBJzZcMTj3VOpNLko';
const TEAM_SLOT_COUNT = 10;

function SidebarLink({ to, active, children }) {
  return (
    <Link
      to={to}
      className={inkNavClass(active)}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}

function Sidebar() {
  const [teams, setTeams] = useState([]);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [, setPlayers] = useState([]);
  const [teamsOpen, setTeamsOpen] = useState(true);
  const location = useLocation();
  const { user: authUser } = useAuthUser();
  const myRosterId = findMyRosterId(rosters, users, authUser);
  const isHome = navIsAnyActive(location.pathname, NAV_MATCH.home);
  const teamsHubActive = navIsAnyActive(location.pathname, NAV_MATCH.teamsHub);
  const onATeamPage = navIsActive(location.pathname, '/team');
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
        setRosters(rosters);
        setUsers(users);
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

  const sortedTeams = [...teams].sort((a, b) => {
    const aMine = isMyRoster(a.roster_id, myRosterId) ? 0 : 1;
    const bMine = isMyRoster(b.roster_id, myRosterId) ? 0 : 1;
    return aMine - bMine;
  });
  const teamSlots = Array.from(
    { length: Math.max(TEAM_SLOT_COUNT, sortedTeams.length) },
    (_, i) => sortedTeams[i] || null
  );

  return (
    <div className="sidebar">
      <aside className={`scroll-sidebar${playUnroll ? ' scroll-animating' : ''}`}>
        <div className="scroll-top" />
        <div className="scroll-body">
          <nav>
            <ul>
              <li>
                <SidebarLink to="/home/" active={isHome}>Home</SidebarLink>
              </li>
              <li>
                <SidebarLink to="/Scores/Week" active={navIsAnyActive(location.pathname, NAV_MATCH.scores)}>
                  Scores
                </SidebarLink>
              </li>
              <li>
                <SidebarLink to="/standings" active={navIsAnyActive(location.pathname, NAV_MATCH.standings)}>
                  Standings
                </SidebarLink>
              </li>
              <li>
                <SidebarLink to="/h2h" active={navIsAnyActive(location.pathname, NAV_MATCH.h2h)}>
                  Head to Head
                </SidebarLink>
              </li>
              <li>
                <SidebarLink to="/yoffs" active={navIsAnyActive(location.pathname, NAV_MATCH.playoffs)}>
                  Playoffs
                </SidebarLink>
              </li>
              <li>
                <a href={PODCAST_LINK} target="_blank" rel="noopener noreferrer">Podcast</a>
              </li>
              <li>
                <SidebarLink to="/league-history" active={navIsAnyActive(location.pathname, NAV_MATCH.history)}>
                  History
                </SidebarLink>
              </li>
              <li>
                <SidebarLink to="/hwangai" active={navIsAnyActive(location.pathname, NAV_MATCH.hwangai)}>
                  HwangAI
                </SidebarLink>
              </li>
              {authUser ? (
                <li>
                  <SignOutControl className="sidebar-signout-btn" />
                </li>
              ) : null}
              <li>
                <div
                  className={inkNavClass(teamsHubActive, 'dropdown-toggle')}
                  onClick={() => setTeamsOpen(open => !open)}
                >
                  <span>Teams</span>
                  <span className="sidebar-teams-arrow">{teamsOpen ? '▼' : '▶'}</span>
                </div>
                <ul
                  className={`dropdown-list sidebar-dropdown-list${teamsOpen ? '' : ' is-collapsed'}`}
                  aria-hidden={!teamsOpen}
                >
                  {teamSlots.map((team, i) => {
                    if (!team) {
                      return (
                        <li
                          key={`team-slot-${i}`}
                          className="sidebar-dropdown-list-item sidebar-dropdown-list-item--slot"
                          aria-hidden="true"
                        />
                      );
                    }
                    const mine = isMyRoster(team.roster_id, myRosterId);
                    const teamActive = onATeamPage
                      && navIsActive(location.pathname, `/team/${team.roster_id}`, { exact: true });
                    return (
                      <li
                        key={team.roster_id}
                        className={`sidebar-dropdown-list-item${mine ? ' sidebar-dropdown-list-item--me' : ''}`}
                      >
                        <Link
                          to={`/team/${team.roster_id}`}
                          className={inkNavClass(teamActive)}
                          aria-current={teamActive ? 'page' : undefined}
                          tabIndex={teamsOpen ? undefined : -1}
                        >
                          {team.username}
                          {mine ? <span className="me-chip">YOU</span> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
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