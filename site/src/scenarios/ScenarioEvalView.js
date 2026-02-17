import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingState from '../LoadingState';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { getStandings } from '../scores/ScoresParser';
import ScenarioDeltas from './ScenarioDeltas';
import { decodeScenario, applyScenarioChanges } from './scenarioEncoding';

/**
 * Eval view rendered at ?state=eval&scenario=<encoded>.
 *
 * Decodes the scenario param, re-fetches the season data to get original
 * rosters, applies the encoded changes, then renders the Your Scenario panel
 * alongside a placeholder for future evaluation results.
 */
function ScenarioEvalView({ scenarioParam }) {
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState(null);
  const [originalRosters, setOriginalRosters] = useState({});
  const [scenarioRosters, setScenarioRosters] = useState({});
  const [teamsForGrid, setTeamsForGrid]     = useState([]);
  const [playersData, setPlayersData]       = useState(null);
  const [playerIdMap, setPlayerIdMap]       = useState(null);
  const [season, setSeason]                 = useState(null);

  useEffect(() => {
    const decoded = decodeScenario(scenarioParam);
    if (!decoded) {
      setError('Invalid or missing scenario data.');
      setLoading(false);
      return;
    }

    setSeason(decoded.y);
    let cancelled = false;

    async function load() {
      try {
        const [teamData, idMap, weeksData, players] = await Promise.all([
          fetchTeamData(decoded.y),
          fetchPlayerIdMap(),
          fetchScoresData(decoded.y),
          fetch('/data/players.txt').then((r) => r.json()).catch(() => null),
        ]);

        if (!teamData || !Array.isArray(teamData.rosters)) {
          throw new Error('No team data');
        }
        if (cancelled) return;

        // Build sorted teams list
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
          return pa !== pb ? pa - pb : Number(a.rosterId) - Number(b.rosterId);
        });

        // Build original rosters map
        const orig = {};
        for (const roster of teamData.rosters) {
          const rid = roster && roster.roster_id != null ? Number(roster.roster_id) : null;
          if (rid != null) {
            orig[rid] = Array.isArray(roster.players) ? [...roster.players] : [];
          }
        }

        // Apply the encoded changes to reconstruct scenarioRosters
        const modified = applyScenarioChanges(orig, decoded.c);

        setOriginalRosters(orig);
        setScenarioRosters(modified);
        setTeamsForGrid(teams);
        setPlayersData(players);
        setPlayerIdMap(idMap);
      } catch (e) {
        if (!cancelled) setError('Failed to load scenario data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [scenarioParam]);

  if (loading) return <LoadingState label="Loading scenario…" />;

  if (error) {
    return (
      <div className="scenario-eval-error">
        <p>{error}</p>
        <Link to="/scenarios" className="scenario-eval-back-link">← Back to Builder</Link>
      </div>
    );
  }

  return (
    <div className="scenario-page-layout scenario-eval-layout">
      {/* Back link */}
      <div className="scenario-eval-topbar">
        <Link to="/scenarios" className="scenario-eval-back-link">
          ← Edit Scenario
        </Link>
        {season && (
          <span className="scenario-eval-season-label">{season} Season</span>
        )}
      </div>

      {/* Two-column body: deltas on left, results placeholder on right */}
      <div className="scenario-page-middle">
        <div className="scenario-page-deltas-col">
          <ScenarioDeltas
            originalRosters={originalRosters}
            scenarioRosters={scenarioRosters}
            teamsForGrid={teamsForGrid}
            playersData={playersData}
            playerIdMap={playerIdMap}
            onRevert={null}
            readOnly
          />
        </div>

        <div className="scenario-page-editor-col">
          <div className="scenario-eval-placeholder">
            <div className="scenario-eval-placeholder-icon">📊</div>
            <div className="scenario-eval-placeholder-title">Evaluation coming soon</div>
            <div className="scenario-eval-placeholder-body">
              Results will show projected standings, scoring impact, and head-to-head outcomes
              based on your modified rosters.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ScenarioEvalView;
