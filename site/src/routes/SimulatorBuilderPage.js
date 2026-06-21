/**
 * SimulatorBuilderPage — set rosters then run 1000 Monte Carlo simulations.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { getStandings } from '../scores/ScoresParser';
import { getCurrentYear } from '../utils/DateHelper';
import ScenarioTeamGrid from '../scenarios/ScenarioTeamGrid';
import ScenarioRosterEditor from '../scenarios/ScenarioRosterEditor';
import ScenarioDeltas from '../scenarios/ScenarioDeltas';
import {
  loadHwangAdpRowsForYear,
  buildTopPlayersFromHwangAdp,
} from '../scenarios/hwangAdpLoader';
import {
  encodeSimulatorScenario,
  decodeFutureScenario2,
  applyScenarioChanges,
  sanitizeRosters,
} from '../scenarios/scenarioEncoding';
import { isValidPlayerId } from '../scenarios/scenarioUtils';
import { getOutcomeHistoryYears } from '../scenarios/historicalOutcomeData';
import { DEFAULT_ITERATIONS } from '../scenarios/simulatorMonteCarlo';

const OG_TITLE = 'Season Simulator';
const OG_DESCRIPTION = 'Run 1000 outcome-roll simulations and see championship odds.';

function SimulatorTooltip() {
  const years = getOutcomeHistoryYears(getCurrentYear());
  const yearLabel = years.length > 0 ? `${years[0]}–${years[years.length - 1]}` : 'past seasons';

  return (
    <span className="info-icon scenario-builder-tooltip" aria-label="About the Season Simulator">
      ℹ️
      <span className="info-icon-tooltip">
        <div className="scenario-builder-tooltip-inner">
          <div className="scenario-builder-tooltip-body">
            <p style={{ margin: '0 0 0.6em 0' }}>
              Same outcome engine as Future Scenarios v2 — each player gets a random
              percentile roll from their Hwang ADP ±5 historical pool ({yearLabel}).
            </p>
            <p style={{ margin: 0 }}>
              Edit rosters, then run <strong>{DEFAULT_ITERATIONS.toLocaleString()} simulations</strong> to
              see each team&apos;s championship win rate.
            </p>
          </div>
        </div>
      </span>
    </span>
  );
}

function SimulatorBuilderPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const pendingScenarioRef = useRef(() => {
    const param = searchParams.get('scenario');
    return param ? decodeFutureScenario2(param) : null;
  });
  if (typeof pendingScenarioRef.current === 'function') {
    pendingScenarioRef.current = pendingScenarioRef.current();
  }

  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [topPlayersBySeason, setTopPlayersBySeason] = useState([]);
  const [teamsForGrid, setTeamsForGrid] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scenarioRosters, setScenarioRosters] = useState({});
  const [originalRosters, setOriginalRosters] = useState({});
  const [selectedRosterId, setSelectedRosterId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSelectedRosterId(null);
    setTeamsForGrid([]);
    setScenarioRosters({});
    setOriginalRosters({});

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const currentYear = getCurrentYear();
        const [teamData, idMap, weeksData, players, hwangRows] = await Promise.all([
          fetchTeamData(currentYear),
          fetchPlayerIdMap(),
          fetchScoresData(currentYear).catch(() => null),
          fetch('/data/players.txt').then((r) => r.json()).catch(() => null),
          loadHwangAdpRowsForYear(currentYear).catch(() => []),
        ]);

        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }
        if (cancelled) return;

        const topPlayers = players && idMap
          ? buildTopPlayersFromHwangAdp(hwangRows, players, idMap, getPlayerInfo)
          : [];

        setPlayersData(players);
        setPlayerIdMap(idMap);
        setTopPlayersBySeason(topPlayers);

        const standings = getStandings(weeksData) || [];
        const placeByRosterId = {};
        const pointsByRosterId = {};
        standings.forEach((row) => {
          if (row && row.roster_id != null) {
            placeByRosterId[String(row.roster_id)] = row.place != null ? row.place : 999;
            pointsByRosterId[String(row.roster_id)] = row.points_scored ?? 0;
          }
        });

        const teamsUnsorted = (teamData.rosters || []).map((roster) => {
          const rid = roster?.roster_id != null ? Number(roster.roster_id) : null;
          if (rid == null) return null;
          const user = (teamData.users || []).find(
            (u) => String(u.user_id) === String(roster.owner_id),
          );
          let teamName = `Team ${rid}`;
          if (user?.metadata?.team_name) teamName = user.metadata.team_name;
          else if (user?.display_name) teamName = `Team ${user.display_name}`;
          const avatarUrl =
            (user && (user.team_avatar_url || user.user_avatar_url || user.avatar_url)) || null;
          return {
            rosterId: rid,
            teamName,
            avatarUrl,
            place: placeByRosterId[String(rid)] !== 999 ? placeByRosterId[String(rid)] : null,
            totalPoints: pointsByRosterId[String(rid)] ?? null,
          };
        }).filter(Boolean);

        const teams = teamsUnsorted.slice().sort((a, b) => {
          const pa = placeByRosterId[String(a.rosterId)] ?? 999;
          const pb = placeByRosterId[String(b.rosterId)] ?? 999;
          return pa !== pb ? pa - pb : Number(a.rosterId) - Number(b.rosterId);
        });
        setTeamsForGrid(teams);

        const initial = {};
        for (const roster of teamData.rosters) {
          const rid = roster?.roster_id != null ? Number(roster.roster_id) : null;
          if (rid != null) initial[rid] = Array.isArray(roster.players) ? [...roster.players] : [];
        }

        const storedEncoded = sessionStorage.getItem('pendingSimulatorBuilderScenario');
        const pending = storedEncoded
          ? decodeFutureScenario2(storedEncoded)
          : pendingScenarioRef.current;
        if (storedEncoded) sessionStorage.removeItem('pendingSimulatorBuilderScenario');
        pendingScenarioRef.current = null;

        if (pending && Array.isArray(pending.c) && pending.c.length > 0) {
          setScenarioRosters(sanitizeRosters(applyScenarioChanges(initial, pending.c)));
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('scenario');
            return next;
          }, { replace: true });
        } else {
          setScenarioRosters(sanitizeRosters(initial));
        }

        const snapshot = {};
        for (const rid in initial) snapshot[rid] = [...initial[rid]];
        setOriginalRosters(snapshot);
      } catch (e) {
        if (!cancelled) setError('Failed to load roster data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Strip any invalid player IDs left from older bugs (e.g. undefined entries).
  useEffect(() => {
    if (loading || teamsForGrid.length === 0) return;
    setScenarioRosters((prev) => {
      const next = sanitizeRosters(prev);
      const changed = Object.keys(prev).some(
        (rid) => (prev[rid] || []).length !== (next[rid] || []).length,
      );
      return changed ? next : prev;
    });
  }, [loading, teamsForGrid.length]);

  const handleSelectTeam = (rosterId) => setSelectedRosterId(rosterId);

  const handleRevert = (rosterId, playerId, type) => {
    setScenarioRosters((prev) => {
      const current = prev[rosterId] || [];
      if (type === 'add') {
        return { ...prev, [rosterId]: current.filter((pid) => pid !== playerId) };
      }
      if (current.includes(playerId)) return prev;
      return { ...prev, [rosterId]: [...current, playerId] };
    });
  };

  const handleRemovePlayer = (playerId) => {
    if (selectedRosterId == null) return;
    setScenarioRosters((prev) => ({
      ...prev,
      [selectedRosterId]: (prev[selectedRosterId] || []).filter((pid) => pid !== playerId),
    }));
  };

  const handleAddPlayer = (playerId) => {
    if (selectedRosterId == null || !isValidPlayerId(playerId)) return;
    setScenarioRosters((prev) => {
      const current = prev[selectedRosterId] || [];
      if (current.includes(playerId)) return prev;
      return { ...prev, [selectedRosterId]: [...current, playerId] };
    });
  };

  const handleRun = () => {
    const encoded = encodeSimulatorScenario(originalRosters, scenarioRosters);
    navigate(`?state=run&scenario=${encodeURIComponent(encoded)}`);
  };

  const selectedTeam = useMemo(
    () => teamsForGrid.find((t) => t.rosterId === selectedRosterId) || null,
    [teamsForGrid, selectedRosterId],
  );

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper
        title={<>Season Simulator <SimulatorTooltip /></>}
        subtitle={null}
        leftHeader={
          <span className="future-scenario-proj-label">
            {DEFAULT_ITERATIONS.toLocaleString()} sims per run
          </span>
        }
      >
        {loading && <LoadingState label="Loading current rosters…" />}

        {!loading && error && (
          <div style={{ color: '#ff6b6b', padding: '20px' }}>{error}</div>
        )}

        {!loading && !error && (
          <div className="scenario-page-layout">
            <div className="scenario-page-top">
              <ScenarioTeamGrid
                teams={teamsForGrid}
                selectedRosterId={selectedRosterId}
                onSelectTeam={handleSelectTeam}
              />
            </div>

            <div className="scenario-page-middle">
              <div className="scenario-page-deltas-col">
                {playersData && playerIdMap && (
                  <ScenarioDeltas
                    originalRosters={originalRosters}
                    scenarioRosters={scenarioRosters}
                    teamsForGrid={teamsForGrid}
                    playersData={playersData}
                    playerIdMap={playerIdMap}
                    onRevert={handleRevert}
                  />
                )}
                <div className="scenario-evaluate-wrapper">
                  <button
                    type="button"
                    className="scenario-evaluate-btn simulator-run-btn"
                    onClick={handleRun}
                  >
                    Run {DEFAULT_ITERATIONS.toLocaleString()} Simulations →
                  </button>
                </div>
              </div>

              <div className="scenario-page-editor-col">
                {selectedTeam && playersData && playerIdMap ? (
                  <ScenarioRosterEditor
                    key={`sim-${selectedRosterId}`}
                    team={selectedTeam}
                    playerIds={scenarioRosters[selectedRosterId] || []}
                    playersData={playersData}
                    playerIdMap={playerIdMap}
                    topPlayersBySeason={topPlayersBySeason}
                    onRemovePlayer={handleRemovePlayer}
                    onAddPlayer={handleAddPlayer}
                  />
                ) : (
                  <div className="scenario-editor-placeholder">
                    <span>↑ Select a team above to edit its roster</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </InfoPageWrapper>
    </>
  );
}

export default SimulatorBuilderPage;
