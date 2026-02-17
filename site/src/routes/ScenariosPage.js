import React, { useEffect, useState, useMemo } from 'react';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { getStandings } from '../scores/ScoresParser';
import { CURRENT_YEAR } from '../utils/DateHelper';
import ScenarioTeamGrid from '../scenarios/ScenarioTeamGrid';
import ScenarioRosterEditor from '../scenarios/ScenarioRosterEditor';

const OG_TITLE = 'Scenarios';
const OG_DESCRIPTION = 'Build what-if scenarios by editing team rosters.';

function ScenariosPage() {
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [teamsForGrid, setTeamsForGrid] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Mutable scenario rosters: { [rosterId]: [playerId, ...] }
  // Initialized from real rosters, editable by user
  const [scenarioRosters, setScenarioRosters] = useState({});

  // Which team is currently open in the editor (null = none)
  const [selectedRosterId, setSelectedRosterId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [teamData, idMap, weeksData] = await Promise.all([
          fetchTeamData(CURRENT_YEAR),
          fetchPlayerIdMap(),
          fetchScoresData(CURRENT_YEAR),
        ]);

        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }

        let players = null;
        try {
          players = await fetchPlayersData(teamData.rosters);
        } catch (_) {
          players = null;
        }

        if (cancelled) return;

        setPlayersData(players);
        setPlayerIdMap(idMap);

        // Build sorted teams list (same logic as h2h page)
        const standings = getStandings(weeksData) || [];
        const placeByRosterId = {};
        standings.forEach((row) => {
          if (row && row.roster_id != null) {
            placeByRosterId[String(row.roster_id)] = row.place != null ? row.place : 999;
          }
        });

        const teamsUnsorted = (teamData.rosters || []).map((roster) => {
          const rid = roster && roster.roster_id != null ? Number(roster.roster_id) : null;
          if (rid == null) return null;
          const user = (teamData.users || []).find(
            (u) => roster && String(u.user_id) === String(roster.owner_id)
          );
          let teamName = `Team ${rid}`;
          if (user && user.metadata && user.metadata.team_name) {
            teamName = user.metadata.team_name;
          } else if (user && user.display_name) {
            teamName = `Team ${user.display_name}`;
          }
          const avatarUrl =
            (user && (user.team_avatar_url || user.user_avatar_url || user.avatar_url)) || null;
          return { rosterId: rid, teamName, avatarUrl };
        }).filter(Boolean);

        const teams = teamsUnsorted.slice().sort((a, b) => {
          const pa = placeByRosterId[String(a.rosterId)] ?? 999;
          const pb = placeByRosterId[String(b.rosterId)] ?? 999;
          if (pa !== pb) return pa - pb;
          return Number(a.rosterId) - Number(b.rosterId);
        });

        setTeamsForGrid(teams);

        // Initialize scenarioRosters from real roster data
        const initial = {};
        for (const roster of teamData.rosters) {
          const rid = roster && roster.roster_id != null ? Number(roster.roster_id) : null;
          if (rid != null) {
            initial[rid] = Array.isArray(roster.players) ? [...roster.players] : [];
          }
        }
        setScenarioRosters(initial);
      } catch (e) {
        if (!cancelled) {
          setError('Failed to load scenario data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const handleSelectTeam = (rosterId) => {
    setSelectedRosterId(rosterId);
  };

  const handleRemovePlayer = (playerId) => {
    if (selectedRosterId == null) return;
    setScenarioRosters((prev) => ({
      ...prev,
      [selectedRosterId]: (prev[selectedRosterId] || []).filter((pid) => pid !== playerId),
    }));
  };

  const handleAddPlayer = (playerId) => {
    if (selectedRosterId == null) return;
    setScenarioRosters((prev) => {
      const current = prev[selectedRosterId] || [];
      if (current.includes(playerId)) return prev; // already on roster
      return {
        ...prev,
        [selectedRosterId]: [...current, playerId],
      };
    });
  };

  const selectedTeam = useMemo(
    () => teamsForGrid.find((t) => t.rosterId === selectedRosterId) || null,
    [teamsForGrid, selectedRosterId]
  );

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper title="Scenarios" subtitle={null}>
        {loading && <LoadingState label="Loading scenario data…" />}

        {!loading && error && (
          <div style={{ color: '#ff6b6b', padding: '20px' }}>{error}</div>
        )}

        {!loading && !error && (
          <div className="scenario-page-layout">
            {/* Left panel: team grid */}
            <div className="scenario-page-grid-col">
              <ScenarioTeamGrid
                teams={teamsForGrid}
                selectedRosterId={selectedRosterId}
                onSelectTeam={handleSelectTeam}
              />
            </div>

            {/* Right panel: roster editor (only shown when a team is selected) */}
            <div className="scenario-page-editor-col">
              {selectedTeam && playersData && playerIdMap ? (
                <ScenarioRosterEditor
                  key={selectedRosterId}
                  team={selectedTeam}
                  playerIds={scenarioRosters[selectedRosterId] || []}
                  playersData={playersData}
                  playerIdMap={playerIdMap}
                  onRemovePlayer={handleRemovePlayer}
                  onAddPlayer={handleAddPlayer}
                />
              ) : (
                <div className="scenario-editor-placeholder">
                  <span>← Select a team to edit its roster</span>
                </div>
              )}
            </div>
          </div>
        )}
      </InfoPageWrapper>
    </>
  );
}

export default ScenariosPage;
