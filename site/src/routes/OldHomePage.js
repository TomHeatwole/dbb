import React, { useEffect, useState } from 'react';
import { trackPageLoad } from '../utils/UsageTracker';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchTeamData } from '../lookups/TeamLookup';
import PageMeta from '../PageMeta';

const OG_TITLE = 'The Hwang Dynasty';
const OG_DESCRIPTION = '';

function OldHomePage() {
  const [searchParams] = useSearchParams();
  const initialShowTeams = searchParams.get('view') === 'teams';

  const [showTeams, setShowTeams] = useState(initialShowTeams);
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    trackPageLoad();
    async function load() {
      try {
        const data = await fetchTeamData();
        const rosters = data && Array.isArray(data.rosters) ? data.rosters : [];
        const users = data && Array.isArray(data.users) ? data.users : [];
        const mapped = rosters.map(roster => {
          const user = users.find(u => String(u.user_id) === String(roster.owner_id)) || {};
          const ownerName = user && user.display_name ? user.display_name : 'Unknown';
          let teamName = null;
          if (user && user.metadata && user.metadata.team_name) {
            teamName = user.metadata.team_name;
          } else if (ownerName && ownerName !== 'Unknown') {
            teamName = `Team ${ownerName}`;
          } else {
            teamName = `Team ${roster.roster_id}`;
          }
          return {
            rosterId: roster.roster_id,
            teamName,
            ownerName,
            avatarUrl: user && user.avatar_url ? user.avatar_url : null,
          };
        });
        setTeams(mapped.slice(0, 10));
      } catch (e) {
        setTeams([]);
      }
    }
    load();
  }, []);

  return(
    <>
      <PageMeta
        title={OG_TITLE}
        description={OG_DESCRIPTION}
      />
      <main className="home-main">
        {!showTeams && (
          <div className="home-cta-container">
            <Link className="home-cta-btn" to="/Scores/Week" aria-label="Scores">
              <img className="home-cta-img" src="/scores.png" alt="Scores" />
              <span className="home-cta-label">Scores</span>
            </Link>
            <Link className="home-cta-btn" to="/standings" aria-label="Standings">
              <img className="home-cta-img" src="/standings.png" alt="Standings" />
              <span className="home-cta-label">Standings</span>
            </Link>
            <button
              className="home-cta-btn"
              type="button"
              aria-label="Teams"
              onClick={() => setShowTeams(true)}
            >
              <img className="home-cta-img" src="/teams.png" alt="Teams" />
              <span className="home-cta-label">Teams</span>
            </button>
          </div>
        )}
        {showTeams && (
          <div className="home-team-links" aria-label="Team Links">
            {teams.map(t => (
              <Link key={t.rosterId} to={`/team/${t.rosterId}`} className="home-team-link">
                {t.avatarUrl && (
                  <img className="home-team-link-avatar" src={t.avatarUrl} alt={`${t.ownerName} avatar`} />
                )}
                <span className="home-team-link-text">{t.teamName} - {t.ownerName}</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

export default OldHomePage;


