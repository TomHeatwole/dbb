/**
 * SimulatorBuilderPage — set rosters then run Monte Carlo simulations.
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
  DEFAULT_RANK_SOURCE,
  RANK_SOURCE_DASH,
  isCurrentSeasonRankDashAllowed,
  loadRedraftDashRankRows,
  normalizeRankSource,
  rankSourceShortLabel,
} from '../scenarios/simulatorRankSource';
import {
  encodeSimulatorScenario,
  decodeFutureScenario2,
  applyScenarioChanges,
  sanitizeRosters,
} from '../scenarios/scenarioEncoding';
import { isValidPlayerId } from '../scenarios/scenarioUtils';
import { getOutcomeHistoryYears } from '../scenarios/historicalOutcomeData';
import OutcomeScenarioSeasonDropdown from '../scenarios/OutcomeScenarioSeasonDropdown';
import SimulatorRunSettings from '../scenarios/SimulatorRunSettings';
import { loadOutcomeScenarioRosterData } from '../scenarios/outcomeScenarioLoader';
import {
  DEFAULT_OUTCOME_SCENARIO_YEAR,
  normalizeOutcomeScenarioYear,
} from '../scenarios/outcomeScenarioConfig';
import { DEFAULT_ITERATIONS } from '../scenarios/simulatorMonteCarlo';
import { DEFAULT_VARIANCE, normalizeVariance, DEFAULT_MONOTONE, normalizeMonotone } from '../scenarios/outcomeDistribution';
import { useMyCurrentRosterId } from '../hooks/useAuthUser';

const OG_TITLE = 'Season Simulator';
const OG_DESCRIPTION = 'Run outcome-roll simulations and see championship odds.';

function SimulatorTooltip({ season, iterations, rankSource }) {
  const years = getOutcomeHistoryYears(season);
  const yearLabel = years.length > 0 ? `${years[0]}–${years[years.length - 1]}` : 'past seasons';
  const rankLabel = rankSource === RANK_SOURCE_DASH
    ? 'Redraft Dash positional rank'
    : `${season} Hwang ADP`;

  return (
    <span className="info-icon scenario-builder-tooltip" aria-label="About the Season Simulator">
      ℹ️
      <span className="info-icon-tooltip">
        <div className="scenario-builder-tooltip-inner">
          <div className="scenario-builder-tooltip-body">
            <p style={{ margin: '0 0 0.6em 0' }}>
              Same outcome engine as Future Scenarios v2 — each player gets a random
              percentile roll from their {rankLabel} ±2 historical pool ({yearLabel}),
              densified with synthetic in-between seasons, for weeks 1–14. Playoff weeks
              15–17 are rolled independently from real historical playoffs of similar
              regular-season scorers.
            </p>
            <p style={{ margin: 0 }}>
              Edit rosters, then run <strong>{iterations.toLocaleString()} simulations</strong> to
              see each team&apos;s championship win rate.
            </p>
          </div>
        </div>
      </span>
    </span>
  );
}

function SimulatorBuilderPage() {
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
  const [iterations, setIterations] = useState(() => {
    const pre = pendingScenarioRef.current;
    return pre?.n ?? DEFAULT_ITERATIONS;
  });
  const [variance, setVariance] = useState(() => {
    const pre = pendingScenarioRef.current;
    return normalizeVariance(pre?.v ?? DEFAULT_VARIANCE);
  });
  const [monotone, setMonotone] = useState(() => {
    const pre = pendingScenarioRef.current;
    return normalizeMonotone(pre?.m ?? DEFAULT_MONOTONE);
  });
  const [rankSource, setRankSource] = useState(() => {
    const pre = pendingScenarioRef.current;
    return normalizeRankSource(pre?.rs ?? DEFAULT_RANK_SOURCE, pre?.sy);
  });
  const [hwangRankRows, setHwangRankRows] = useState([]);
  const [dashRankRows, setDashRankRows] = useState([]);

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
        const [rosterData, players, hwangRows, dashRows] = await Promise.all([
          loadOutcomeScenarioRosterData(season),
          fetch('/data/players.txt').then((r) => r.json()).catch(() => null),
          loadHwangAdpRowsForYear(season).catch(() => []),
          isCurrentSeasonRankDashAllowed(season)
            ? loadRedraftDashRankRows().catch(() => [])
            : Promise.resolve([]),
        ]);

        if (cancelled) return;

        const { teams, originalRosters: initial, idMap } = rosterData;

        setPlayersData(players);
        setPlayerIdMap(idMap);
        setHwangRankRows(hwangRows);
        setDashRankRows(dashRows);
        setTeamsForGrid(teams);

        const storedEncoded = sessionStorage.getItem('pendingSimulatorBuilderScenario');
        const pending = storedEncoded
          ? decodeFutureScenario2(storedEncoded)
          : pendingScenarioRef.current;
        if (storedEncoded) sessionStorage.removeItem('pendingSimulatorBuilderScenario');
        pendingScenarioRef.current = null;

        if (pending?.sy && normalizeOutcomeScenarioYear(pending.sy) === season) {
          if (pending.n != null) setIterations(pending.n);
          if (pending.v != null) setVariance(normalizeVariance(pending.v));
          if (pending.m != null) setMonotone(normalizeMonotone(pending.m));
          if (pending.rs != null) setRankSource(normalizeRankSource(pending.rs, season));
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

  useEffect(() => {
    if (loading) return;
    setRankSource((prev) => {
      if (prev === RANK_SOURCE_DASH && dashRankRows.length === 0) return DEFAULT_RANK_SOURCE;
      return normalizeRankSource(prev, season);
    });
  }, [loading, season, dashRankRows.length]);

  const topPlayersBySeason = useMemo(() => {
    if (!playersData || !playerIdMap) return [];
    const rows = rankSource === RANK_SOURCE_DASH && dashRankRows.length > 0
      ? dashRankRows
      : hwangRankRows;
    return buildTopPlayersFromHwangAdp(rows, playersData, playerIdMap, getPlayerInfo);
  }, [rankSource, dashRankRows, hwangRankRows, playersData, playerIdMap]);

  const dashRanksAvailable = isCurrentSeasonRankDashAllowed(season) && dashRankRows.length > 0;

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
    const encoded = encodeSimulatorScenario(originalRosters, scenarioRosters, {
      seasonYear: season,
      iterations,
      variance,
      monotone,
      rankSource,
    });
    navigate(`?state=run&scenario=${encodeURIComponent(encoded)}`);
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
      <OutcomeScenarioSeasonDropdown
        season={season}
        onSeasonChange={(next) => {
          setSeason(next);
          setRankSource((prev) => normalizeRankSource(prev, next));
        }}
      />
      <span className="future-scenario-proj-label">
        {season} {rankSourceShortLabel(rankSource, season)} · outcomes {historyLabel}
      </span>
    </div>
  );

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper
        title={<>Season Simulator <SimulatorTooltip season={season} iterations={iterations} rankSource={rankSource} /></>}
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
                <div className="scenario-evaluate-wrapper simulator-run-controls">
                  <button
                    type="button"
                    className="scenario-evaluate-btn simulator-run-btn"
                    onClick={handleRun}
                  >
                    Run {iterations.toLocaleString()} Simulations →
                  </button>
                  <SimulatorRunSettings
                    iterations={iterations}
                    onChangeIterations={setIterations}
                    variance={variance}
                    onChangeVariance={setVariance}
                    monotone={monotone}
                    onChangeMonotone={setMonotone}
                    rankSource={rankSource}
                    onChangeRankSource={setRankSource}
                    allowRedraftDash={dashRanksAvailable}
                  />
                </div>
              </div>

              <div className="scenario-page-editor-col">
                {selectedTeam && playersData && playerIdMap ? (
                  <ScenarioRosterEditor
                    key={`sim-${season}-${selectedRosterId}`}
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
