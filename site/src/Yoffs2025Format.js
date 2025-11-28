import React, { useEffect, useState } from 'react';
import YoffsScoresView from './YoffsScoresView';
import { fetchScoresData } from './ScoresLookup';
import { fetchTeamData } from './TeamLookup';
import { getStandings } from './ScoresParser';
import useIsMobile from './useIsMobile';

function Yoffs2025Format({ season, selectedTab, onTabChange, playoffStartWeek, playoffEndWeek }) {
  const tabOptions = ['Bracket', 'Scores', 'Matchups'];
  const [seedTeams, setSeedTeams] = useState(null);
  const [loadingSeeds, setLoadingSeeds] = useState(true);
  const [seedError, setSeedError] = useState(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;

    async function loadSeeds() {
      setLoadingSeeds(true);
      setSeedError(null);
      try {
        const [weeksData, teamData] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season)
        ]);
        if (cancelled) {
          return;
        }
        if (!weeksData || !Array.isArray(weeksData)) {
          throw new Error('No scores data');
        }
        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }

        const regularSliceFull = weeksData.slice(0, 14);
        const weeksRegular = regularSliceFull.filter(Boolean);
        if (!weeksRegular.length) {
          setSeedTeams([]);
          setLoadingSeeds(false);
          return;
        }

        const standingsRegular = getStandings(weeksRegular) || [];
        const top4Regular = standingsRegular
          .slice()
          .sort((a, b) => a.place - b.place)
          .slice(0, 4);

        const seeds = top4Regular
          .map((row) => {
            const rid = Number(row.roster_id);
            const roster = teamData.rosters.find(
              (r) => String(r.roster_id) === String(rid)
            );
            const user =
              roster && teamData.users
                ? teamData.users.find(
                    (u) =>
                      String(u.user_id) === String(roster.owner_id)
                  )
                : null;
            let teamName = `Team ${rid}`;
            if (user && user.metadata && user.metadata.team_name) {
              teamName = user.metadata.team_name;
            } else if (user && user.display_name) {
              teamName = `Team ${user.display_name}`;
            }
            const avatarUrl =
              (user &&
                (user.team_avatar_url ||
                  user.user_avatar_url ||
                  user.avatar_url)) ||
              null;
            return {
              rosterId: rid,
              seed: row.place,
              teamName,
              avatarUrl
            };
          })
          .sort((a, b) => (a.seed || 999) - (b.seed || 999));

        setSeedTeams(seeds);
        setLoadingSeeds(false);
      } catch (e) {
        if (!cancelled) {
          setSeedError('Failed to load bracket seeds');
          setSeedTeams([]);
          setLoadingSeeds(false);
        }
      }
    }

    loadSeeds();

    return () => {
      cancelled = true;
    };
  }, [season]);

  return (
    <>
      <div className="team-tabs-bar">
        {tabOptions.map((tab) => (
          <button
            key={tab}
            className={`team-tab${selectedTab === tab ? ' team-tab-active' : ''}`}
            onClick={() => {
              if (onTabChange) {
                onTabChange(tab);
              }
            }}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>

      {selectedTab === 'Bracket' && (
        <>
          {loadingSeeds && (
            <div className="loading-center">
              <div className="spinner" aria-label="Loading" />
              <div className="loading-text">Loading bracket…</div>
            </div>
          )}
          {!loadingSeeds && seedError && <div>{seedError}</div>}
          {!loadingSeeds && !seedError && (!seedTeams || seedTeams.length === 0) && (
            <div>No playoff teams found for this season.</div>
          )}
          {!loadingSeeds && !seedError && seedTeams && seedTeams.length > 0 && (
            <div className="yoffs-bracket">
              {(() => {
                const semiStart = playoffStartWeek;
                const semiEnd = Math.max(playoffStartWeek, playoffEndWeek - 1);
                const finalsWeek = playoffEndWeek;
                const semiLabel =
                  semiStart === semiEnd
                    ? `Semifinals (Week ${semiStart})`
                    : `Semifinals (Weeks ${semiStart}-${semiEnd})`;
                const finalsLabel = 
                  `Championship (Week ${finalsWeek})`;

                const seed1 = seedTeams.find((t) => t.seed === 1) || seedTeams[0];
                const seed4 =
                  seedTeams.find((t) => t.seed === 4) ||
                  seedTeams[seedTeams.length - 1];
                const seed2 = seedTeams.find((t) => t.seed === 2) || seedTeams[1];
                const seed3 =
                  seedTeams.find((t) => t.seed === 3) ||
                  seedTeams[Math.min(2, seedTeams.length - 1)];

                return (
                  <>
                    <div className="yoffs-bracket-column yoffs-bracket-column--left">
                      <div className="yoffs-bracket-round-label">
                        {semiLabel}
                      </div>
                      <div className="yoffs-bracket-match">
                        <div className="yoffs-bracket-team">
                          <span className="yoffs-bracket-seed">#{seed1.seed}</span>
                          {seed1.avatarUrl && (
                            <img
                              className="standings-avatar"
                              src={seed1.avatarUrl}
                              alt={`${seed1.teamName} avatar`}
                            />
                          )}
                          <span className="yoffs-bracket-name">{seed1.teamName}</span>
                        </div>
                        <div className="yoffs-bracket-team">
                          <span className="yoffs-bracket-seed">#{seed4.seed}</span>
                          {seed4.avatarUrl && (
                            <img
                              className="standings-avatar"
                              src={seed4.avatarUrl}
                              alt={`${seed4.teamName} avatar`}
                            />
                          )}
                          <span className="yoffs-bracket-name">{seed4.teamName}</span>
                        </div>
                      </div>
                      <div className="yoffs-bracket-match">
                        <div className="yoffs-bracket-team">
                          <span className="yoffs-bracket-seed">#{seed2.seed}</span>
                          {seed2.avatarUrl && (
                            <img
                              className="standings-avatar"
                              src={seed2.avatarUrl}
                              alt={`${seed2.teamName} avatar`}
                            />
                          )}
                          <span className="yoffs-bracket-name">{seed2.teamName}</span>
                        </div>
                        <div className="yoffs-bracket-team">
                          <span className="yoffs-bracket-seed">#{seed3.seed}</span>
                          {seed3.avatarUrl && (
                            <img
                              className="standings-avatar"
                              src={seed3.avatarUrl}
                              alt={`${seed3.teamName} avatar`}
                            />
                          )}
                          <span className="yoffs-bracket-name">{seed3.teamName}</span>
                        </div>
                      </div>
                    </div>
                    <div className="yoffs-bracket-column yoffs-bracket-column--right">
                      <div className="yoffs-bracket-final-label">
                        {finalsLabel}
                      </div>
                      <div className="yoffs-bracket-final-spacer">
                        <div className="yoffs-bracket-match yoffs-bracket-match--final">
                          <div className="yoffs-bracket-team yoffs-bracket-team--placeholder">
                            Winner of #1 vs #4
                          </div>
                          <div className="yoffs-bracket-team yoffs-bracket-team--placeholder">
                            Winner of #2 vs #3
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </>
      )}

      {selectedTab === 'Scores' && (
        <YoffsScoresView
          season={season}
          rows={null}
          startWeek={playoffStartWeek}
          endWeek={playoffEndWeek}
        />
      )}

      {selectedTab === 'Matchups' && (
        <div className="yoffs-tab-placeholder">
          TODO: Playoff Matchups tab.
        </div>
      )}
    </>
  );
}

export default Yoffs2025Format;


