/**
 * FutureScenario2EvalPage — eval for outcome-based Future Scenarios v2.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import { fetchMultipleWeeksStats } from '../data_parse/weeklyStatsLoader';
import ScenarioDeltas from '../scenarios/ScenarioDeltas';
import {
  decodeFutureScenario2,
  applyScenarioChanges,
  encodeFutureScenario2,
} from '../scenarios/scenarioEncoding';
import { validateScenarioRosters } from '../scenarios/scenarioValidation';
import {
  loadCurrentHwangAdpRankMap,
  loadHwangPositionMaxRanks,
} from '../scenarios/hwangAdpLoader';
import { loadHistoricalOutcomeCatalog } from '../scenarios/historicalOutcomeData';
import { generateMissingRolls, buildPlayerProjections } from '../scenarios/outcomeDistribution';
import { computeFutureScenario2Eval, collectRequiredSeasonYears } from '../scenarios/computeFutureScenario2Eval';
import ScenarioStandingsPanel from '../scenarios/ScenarioStandingsPanel';
import ScenarioTeamDetail from '../scenarios/ScenarioTeamDetail';
import { getOutcomeHistoryYears } from '../scenarios/historicalOutcomeData';
import { loadOutcomeScenarioRosterData } from '../scenarios/outcomeScenarioLoader';
import { normalizeOutcomeScenarioYear } from '../scenarios/outcomeScenarioConfig';

const OG_TITLE = 'Future Scenarios v2 — Evaluate';
const OG_DESCRIPTION = 'See projected standings from rolled Hwang ADP outcome distributions.';

function ScenarioInvalidBadge({ violations }) {
  if (!violations || violations.isValid) return null;

  const lines = [
    ...violations.oversizedRosters.map(
      (r) => `${r.teamName} roster size: ${r.playerCount} (limit ${r.limit})`,
    ),
    ...violations.duplicatePlayers.map(
      (p) => `${p.playerName} on multiple rosters`,
    ),
  ];

  return (
    <span className="scenario-invalid-badge">
      <span className="scenario-invalid-badge-icon">!</span>
      Invalid Scenario
      <span className="scenario-invalid-badge-tooltip">
        <span className="scenario-invalid-badge-tooltip-intro">
          This scenario is impossible, but you can still evaluate how scoring would look below.
        </span>
        <span className="scenario-invalid-badge-tooltip-reasons-label">Invalid reasons:</span>
        <ul className="scenario-invalid-badge-tooltip-list">
          {lines.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      </span>
    </span>
  );
}

function FutureScenario2EvalPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const scenarioParam = searchParams.get('scenario');

  const [loading, setLoading] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [error, setError] = useState(null);
  const [originalRosters, setOriginalRosters] = useState({});
  const [scenarioRosters, setScenarioRosters] = useState({});
  const [teamsForGrid, setTeamsForGrid] = useState([]);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [scoringConfig, setScoringConfig] = useState(null);
  const [hwangAdpRankMap, setHwangAdpRankMap] = useState(null);
  const [outcomeCatalog, setOutcomeCatalog] = useState(null);
  const [positionMaxRanks, setPositionMaxRanks] = useState(null);
  const [percentileRolls, setPercentileRolls] = useState({});
  const [weeklyStatsByYear, setWeeklyStatsByYear] = useState(null);
  const [selectedRosterId, setSelectedRosterId] = useState(null);
  const [scenarioSeason, setScenarioSeason] = useState(null);

  const rosterViolations = useMemo(
    () => validateScenarioRosters(scenarioRosters, teamsForGrid, playersData),
    [scenarioRosters, teamsForGrid, playersData],
  );

  const evalResult = useMemo(() => {
    if (
      !hwangAdpRankMap || !outcomeCatalog || !positionMaxRanks || !weeklyStatsByYear ||
      !scoringConfig || !playersData || !playerIdMap ||
      !originalRosters || !scenarioRosters ||
      Object.keys(originalRosters).length === 0
    ) return null;

    return computeFutureScenario2Eval(
      originalRosters,
      scenarioRosters,
      hwangAdpRankMap,
      outcomeCatalog.catalog,
      positionMaxRanks,
      percentileRolls,
      weeklyStatsByYear,
      scoringConfig,
      playersData,
      playerIdMap,
    );
  }, [
    hwangAdpRankMap, outcomeCatalog, positionMaxRanks, percentileRolls,
    weeklyStatsByYear, scoringConfig, playersData, playerIdMap,
    originalRosters, scenarioRosters,
  ]);

  useEffect(() => {
    const decoded = decodeFutureScenario2(scenarioParam);
    if (!decoded) {
      setError('Invalid or missing scenario data.');
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const seasonYear = normalizeOutcomeScenarioYear(decoded.sy);
        setScenarioSeason(seasonYear);

        const [
          rosterData,
          cfg,
          adpMap,
          maxRanks,
        ] = await Promise.all([
          loadOutcomeScenarioRosterData(seasonYear),
          fetch('/data/score_format.json').then((r) => r.json()).catch(() => null),
          loadCurrentHwangAdpRankMap(seasonYear),
          loadHwangPositionMaxRanks(seasonYear),
        ]);

        if (cancelled) return;

        const { teams, originalRosters: orig, idMap, players } = rosterData;
        const catalog = await loadHistoricalOutcomeCatalog(Number(seasonYear), players);

        const modified = applyScenarioChanges(orig, decoded.c);

        const allPlayerIds = new Set();
        for (const rid in modified) {
          for (const pid of modified[rid]) allPlayerIds.add(pid);
        }
        for (const rid in orig) {
          for (const pid of orig[rid]) allPlayerIds.add(pid);
        }

        const rolls = generateMissingRolls([...allPlayerIds], decoded.p);
        const rollsWereGenerated = [...allPlayerIds].some((pid) => decoded.p?.[pid] == null);

        if (rollsWereGenerated && !cancelled) {
          const encoded = encodeFutureScenario2(orig, modified, rolls, seasonYear);
          navigate(`?state=eval&scenario=${encodeURIComponent(encoded)}`, { replace: true });
        }

        setOriginalRosters(orig);
        setScenarioRosters(modified);
        setTeamsForGrid(teams);
        setPlayersData(players);
        setPlayerIdMap(idMap);
        setScoringConfig(cfg);
        setHwangAdpRankMap(adpMap);
        setOutcomeCatalog(catalog);
        setPositionMaxRanks(maxRanks);
        setPercentileRolls(rolls);
      } catch (e) {
        if (!cancelled) setError('Failed to load scenario data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [scenarioParam, navigate]);

  const yearsNeeded = useMemo(() => {
    if (!hwangAdpRankMap || !outcomeCatalog || !positionMaxRanks) return [];

    const allPlayerIds = new Set();
    for (const rid in scenarioRosters) {
      for (const pid of (scenarioRosters[rid] || [])) allPlayerIds.add(pid);
    }
    for (const rid in originalRosters) {
      for (const pid of (originalRosters[rid] || [])) allPlayerIds.add(pid);
    }

    const projections = buildPlayerProjections(
      allPlayerIds,
      hwangAdpRankMap,
      outcomeCatalog.catalog,
      positionMaxRanks,
      percentileRolls,
    );
    return collectRequiredSeasonYears(projections);
  }, [
    hwangAdpRankMap, outcomeCatalog, positionMaxRanks, percentileRolls,
    originalRosters, scenarioRosters,
  ]);

  useEffect(() => {
    if (yearsNeeded.length === 0) {
      setWeeklyStatsByYear({});
      return;
    }

    let cancelled = false;
    setLoadingStats(true);

    async function loadWeeklyStats() {
      const allWeeks = Array.from({ length: 17 }, (_, i) => i + 1);
      const byYear = {};

      await Promise.all(
        yearsNeeded.map(async (year) => {
          const raw = await fetchMultipleWeeksStats(year, allWeeks, 0).catch(() => null);
          byYear[String(year)] = raw
            ? Array.from({ length: 17 }, (_, i) => raw[i + 1] || null)
            : Array.from({ length: 17 }, () => null);
        }),
      );

      if (!cancelled) {
        setWeeklyStatsByYear(byYear);
        setLoadingStats(false);
      }
    }

    loadWeeklyStats();
    return () => { cancelled = true; };
  }, [yearsNeeded]);

  const handlePercentileChange = useCallback((playerId, percentile) => {
    setPercentileRolls((prev) => {
      const next = { ...prev, [playerId]: Math.max(0, Math.min(100, Math.round(percentile))) };
      const encoded = encodeFutureScenario2(
        originalRosters,
        scenarioRosters,
        next,
        scenarioSeason,
      );
      navigate(`?state=eval&scenario=${encodeURIComponent(encoded)}`, { replace: true });
      return next;
    });
  }, [originalRosters, scenarioRosters, scenarioSeason, navigate]);

  const handleRerollAll = useCallback(() => {
    const allPlayerIds = new Set();
    for (const rid in scenarioRosters) {
      for (const pid of scenarioRosters[rid]) allPlayerIds.add(pid);
    }
    const next = {};
    for (const pid of allPlayerIds) {
      next[pid] = Math.floor(Math.random() * 101);
    }
    setPercentileRolls(next);
    const encoded = encodeFutureScenario2(
      originalRosters,
      scenarioRosters,
      next,
      scenarioSeason,
    );
    navigate(`?state=eval&scenario=${encodeURIComponent(encoded)}`, { replace: true });
  }, [originalRosters, scenarioRosters, scenarioSeason, navigate]);

  const historyYears = getOutcomeHistoryYears(scenarioSeason || normalizeOutcomeScenarioYear());
  const historyLabel = historyYears.length > 0
    ? `${historyYears[0]}–${historyYears[historyYears.length - 1]}`
    : 'historical seasons';

  const backLink = (
    <Link
      to="/future-scenarios-2?state=builder"
      className="scenario-eval-back-link"
      onClick={() => {
        if (scenarioParam) {
          sessionStorage.setItem('pendingFuture2BuilderScenario', scenarioParam);
        }
      }}
    >
      ← Edit Scenario
    </Link>
  );

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper
        title="Future Scenarios v2"
        subtitle={null}
        leftHeader={backLink}
      >
        {loading && <LoadingState label="Loading outcome data…" />}

        {!loading && error && (
          <div className="scenario-eval-error">
            <p>{error}</p>
            <Link to="/future-scenarios-2" className="scenario-eval-back-link">
              ← Back to Builder
            </Link>
          </div>
        )}

        {!loading && !error && (
          <div className="scenario-page-layout scenario-eval-layout">
            <div className="scenario-eval-topbar">
              <span className="scenario-eval-season-label">
                {scenarioSeason} ADP · outcomes {historyLabel} · Hwang ADP ±5
              </span>
              <button
                type="button"
                className="outcome-reroll-all-btn"
                onClick={handleRerollAll}
              >
                Re-roll all
              </button>
              <ScenarioInvalidBadge violations={rosterViolations} />
            </div>

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
                {evalResult && !loadingStats ? (
                  <ScenarioStandingsPanel
                    scenarioStandings={evalResult.scenarioStandings}
                    teamDeltas={evalResult.teamDeltas}
                    teamsForGrid={teamsForGrid}
                    selectedRosterId={selectedRosterId}
                    onSelectTeam={setSelectedRosterId}
                  />
                ) : (
                  <div className="scenario-eval-placeholder">
                    <div className="scenario-eval-placeholder-icon">🎲</div>
                    <div className="scenario-eval-placeholder-title">
                      {loadingStats ? 'Loading weekly stats…' : 'Computing…'}
                    </div>
                    <div className="scenario-eval-placeholder-body">
                      Rolling percentile outcomes from {historyLabel} and building
                      optimal lineups for all 17 weeks.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {evalResult && !loadingStats && (
              selectedRosterId != null ? (
                <ScenarioTeamDetail
                  rosterId={selectedRosterId}
                  teamsForGrid={teamsForGrid}
                  originalWeeklyScores={evalResult.originalWeeklyScores}
                  scenarioWeeklyScores={evalResult.scenarioWeeklyScores}
                  playersData={playersData}
                  playerIdMap={playerIdMap}
                  playerProjections={evalResult.playerProjections}
                  onPercentileChange={handlePercentileChange}
                  scenarioRosters={scenarioRosters}
                  playerWeeklyPoints={evalResult.playerWeeklyPoints}
                />
              ) : (
                <div className="scenario-eval-team-stats-placeholder">
                  Click on a team above to see projected weekly breakdown and outcome rolls
                </div>
              )
            )}
          </div>
        )}
      </InfoPageWrapper>
    </>
  );
}

export default FutureScenario2EvalPage;
