/**
 * FutureScenario2BuilderPage — builder for outcome-based Future Scenarios v2.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import ScenarioTeamGrid from '../scenarios/ScenarioTeamGrid';
import ScenarioRosterEditor from '../scenarios/ScenarioRosterEditor';
import ScenarioDeltas from '../scenarios/ScenarioDeltas';
import {
  loadHwangAdpRowsForYear,
  buildTopPlayersFromHwangAdp,
} from '../scenarios/hwangAdpLoader';
import {
  encodeFutureScenario2,
  decodeFutureScenario2,
  applyScenarioChanges,
  sanitizeRosters,
} from '../scenarios/scenarioEncoding';
import { isValidPlayerId } from '../scenarios/scenarioUtils';
import { getOutcomeHistoryYears } from '../scenarios/historicalOutcomeData';
import OutcomeScenarioSeasonDropdown from '../scenarios/OutcomeScenarioSeasonDropdown';
import { loadOutcomeScenarioRosterData } from '../scenarios/outcomeScenarioLoader';
import {
  DEFAULT_OUTCOME_SCENARIO_YEAR,
  normalizeOutcomeScenarioYear,
} from '../scenarios/outcomeScenarioConfig';
import { useMyCurrentRosterId } from '../hooks/useAuthUser';

const OG_TITLE = 'Future Scenarios v2';
const OG_DESCRIPTION = 'Project rosters using Hwang ADP outcome distributions from historical seasons.';

function FutureScenarios2Tooltip({ season }) {
  const years = getOutcomeHistoryYears(season);
  const yearLabel = years.length > 0 ? `${years[0]}–${years[years.length - 1]}` : 'past seasons';

  return (
    <span className="info-icon scenario-builder-tooltip" aria-label="About Future Scenarios v2">
      ℹ️
      <span className="info-icon-tooltip">
        <div className="scenario-builder-tooltip-inner">
          <div className="scenario-builder-tooltip-body">
            <p style={{ margin: '0 0 0.6em 0' }}>
              Project your current rosters by rolling percentile outcomes from historical
              player-seasons centered on each player&apos;s Hwang Adjusted ADP rank.
            </p>
            <p style={{ margin: '0 0 0.6em 0' }}>
              For each player, we collect outcomes from ADP ±5 over {yearLabel},
              stack-rank them by season points, and roll 0–100 to pick which outcome
              to slot in.
            </p>
            <p style={{ margin: 0 }}>
              Edit rosters, hit <strong>Evaluate →</strong>, then click players to
              see the outcome pool and adjust percentile rolls.
            </p>
          </div>
        </div>
      </span>
    </span>
  );
}

function FutureScenario2BuilderPage() {
  const myRosterId = useMyCurrentRosterId();
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
  const [season, setSeason] = useState(() => {
    const pre = pendingScenarioRef.current;
    if (pre?.sy) return normalizeOutcomeScenarioYear(pre.sy);
    return DEFAULT_OUTCOME_SCENARIO_YEAR;
  });

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
        const [rosterData, players, hwangRows] = await Promise.all([
          loadOutcomeScenarioRosterData(season),
          fetch('/data/players.txt').then((r) => r.json()).catch(() => null),
          loadHwangAdpRowsForYear(season).catch(() => []),
        ]);

        if (cancelled) return;

        const { teams, originalRosters: initial, idMap } = rosterData;

        const topPlayers = players && idMap
          ? buildTopPlayersFromHwangAdp(hwangRows, players, idMap, getPlayerInfo)
          : [];

        setPlayersData(players);
        setPlayerIdMap(idMap);
        setTopPlayersBySeason(topPlayers);
        setTeamsForGrid(teams);

        const storedEncoded = sessionStorage.getItem('pendingFuture2BuilderScenario');
        const pending = storedEncoded
          ? decodeFutureScenario2(storedEncoded)
          : pendingScenarioRef.current;
        if (storedEncoded) sessionStorage.removeItem('pendingFuture2BuilderScenario');
        pendingScenarioRef.current = null;

        if (pending?.sy && normalizeOutcomeScenarioYear(pending.sy) === season) {
          if (Array.isArray(pending.c) && pending.c.length > 0) {
            setScenarioRosters(sanitizeRosters(applyScenarioChanges(initial, pending.c)));
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete('scenario');
              return next;
            }, { replace: true });
          } else {
            setScenarioRosters(sanitizeRosters(initial));
          }
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
  }, [season]);

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

  const handleEvaluate = () => {
    const encoded = encodeFutureScenario2(originalRosters, scenarioRosters, {}, season);
    navigate(`?state=eval&scenario=${encodeURIComponent(encoded)}`);
  };

  const selectedTeam = useMemo(
    () => teamsForGrid.find((t) => t.rosterId === selectedRosterId) || null,
    [teamsForGrid, selectedRosterId],
  );

  const historyYears = getOutcomeHistoryYears(season);
  const historyLabel = historyYears.length > 0
    ? `${historyYears[0]}–${historyYears[historyYears.length - 1]}`
    : 'historical seasons';

  const leftHeader = (
    <div className="outcome-scenario-header-meta">
      <OutcomeScenarioSeasonDropdown season={season} onSeasonChange={setSeason} />
      <span className="future-scenario-proj-label">
        {season} ADP · outcomes {historyLabel}
      </span>
    </div>
  );

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper
        title={<>Future Scenarios v2 <FutureScenarios2Tooltip season={season} /></>}
        subtitle={null}
        leftHeader={leftHeader}
      >
        {loading && <LoadingState label={`Loading ${season} rosters…`} />}

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
                myRosterId={myRosterId}
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
                    className="scenario-evaluate-btn"
                    onClick={handleEvaluate}
                  >
                    Roll Outcomes & Evaluate →
                  </button>
                </div>
              </div>

              <div className="scenario-page-editor-col">
                {selectedTeam && playersData && playerIdMap ? (
                  <ScenarioRosterEditor
                    key={`future2-${selectedRosterId}`}
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

export default FutureScenario2BuilderPage;
