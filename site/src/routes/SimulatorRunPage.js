/**
 * SimulatorRunPage — load scenario, run Monte Carlo sims, show win rates.
 */

import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import { fetchMultipleWeeksStats } from '../data_parse/weeklyStatsLoader';
import ScenarioDeltas from '../scenarios/ScenarioDeltas';
import { decodeFutureScenario2, applyScenarioChanges } from '../scenarios/scenarioEncoding';
import {
  loadCurrentHwangAdpRankMap,
  loadHwangPositionMaxRanks,
} from '../scenarios/hwangAdpLoader';
import { loadHistoricalOutcomeCatalog } from '../scenarios/historicalOutcomeData';
import { buildPlayerProjections } from '../scenarios/outcomeDistribution';
import { collectRequiredSeasonYears } from '../scenarios/computeFutureScenario2Eval';
import {
  prepareSimulatorContext,
  runMonteCarloSimulation,
  DEFAULT_ITERATIONS,
} from '../scenarios/simulatorMonteCarlo';
import SimulatorResultsPanel from '../scenarios/SimulatorResultsPanel';
import SimulatorTeamDetail from '../scenarios/SimulatorTeamDetail';
import { loadOutcomeScenarioRosterData } from '../scenarios/outcomeScenarioLoader';
import { normalizeOutcomeScenarioYear } from '../scenarios/outcomeScenarioConfig';

const OG_TITLE = 'Season Simulator — Results';
const OG_DESCRIPTION = 'Championship odds from outcome-roll simulations.';

function SimulatorProgressBar({ progress, phase, iterations }) {
  const pct = Math.round((progress || 0) * 100);
  const total = iterations || DEFAULT_ITERATIONS;
  return (
    <div className="simulator-progress">
      <div className="simulator-progress-label">
        {phase === 'loading' ? 'Loading simulation data…' : `Running simulations… ${pct}%`}
      </div>
      <div className="simulator-progress-track">
        <div
          className="simulator-progress-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      {phase === 'running' && (
        <div className="simulator-progress-detail">
          {Math.round((progress || 0) * total).toLocaleString()}
          {' / '}
          {total.toLocaleString()}
          {' complete'}
        </div>
      )}
    </div>
  );
}

function SimulatorRunPage() {
  const [searchParams] = useSearchParams();
  const scenarioParam = searchParams.get('scenario');

  const [phase, setPhase] = useState('loading');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [resultDeltas, setResultDeltas] = useState(null);
  const [simRuns, setSimRuns] = useState(null);
  const [selectedRosterId, setSelectedRosterId] = useState(null);
  const [teamsForGrid, setTeamsForGrid] = useState([]);
  const [originalRosters, setOriginalRosters] = useState({});
  const [scenarioRosters, setScenarioRosters] = useState({});
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [scenarioSeason, setScenarioSeason] = useState(null);
  const [iterations, setIterations] = useState(DEFAULT_ITERATIONS);

  useEffect(() => {
    const decoded = decodeFutureScenario2(scenarioParam);
    if (!decoded) {
      setError('Invalid or missing scenario data.');
      setPhase('error');
      return;
    }

    const seasonYear = normalizeOutcomeScenarioYear(decoded.sy);
    const runCount = decoded.n ?? DEFAULT_ITERATIONS;
    setScenarioSeason(seasonYear);
    setIterations(runCount);

    let cancelled = false;

    async function run() {
      try {
        setPhase('loading');
        setProgress(0.05);

        const [rosterData, cfg, adpMap, maxRanks] = await Promise.all([
          loadOutcomeScenarioRosterData(seasonYear),
          fetch('/data/score_format.json').then((r) => r.json()).catch(() => null),
          loadCurrentHwangAdpRankMap(seasonYear),
          loadHwangPositionMaxRanks(seasonYear),
        ]);

        if (cancelled) return;

        const { teams, originalRosters: orig, idMap, players } = rosterData;
        const catalog = await loadHistoricalOutcomeCatalog(Number(seasonYear), players);
        const modified = applyScenarioChanges(orig, decoded.c);

        setTeamsForGrid(teams);
        setOriginalRosters(orig);
        setScenarioRosters(modified);
        setPlayersData(players);
        setPlayerIdMap(idMap);
        setProgress(0.15);

        const allPlayerIds = new Set();
        for (const rid in modified) {
          for (const pid of modified[rid]) allPlayerIds.add(pid);
        }

        const projections = buildPlayerProjections(
          allPlayerIds,
          adpMap,
          catalog.catalog,
          maxRanks,
          Object.fromEntries([...allPlayerIds].map((pid) => [pid, 50])),
        );
        const yearsNeeded = collectRequiredSeasonYears(projections);

        const allWeeks = Array.from({ length: 17 }, (_, i) => i + 1);
        const weeklyStatsByYear = {};
        await Promise.all(
          yearsNeeded.map(async (year) => {
            const raw = await fetchMultipleWeeksStats(year, allWeeks, 0).catch(() => null);
            weeklyStatsByYear[String(year)] = raw
              ? Array.from({ length: 17 }, (_, i) => raw[i + 1] || null)
              : Array.from({ length: 17 }, () => null);
          }),
        );

        if (cancelled) return;
        setProgress(0.2);

        const ctx = prepareSimulatorContext({
          scenarioRosters: modified,
          baselineRosters: orig,
          hwangAdpRankMap: adpMap,
          catalog: catalog.catalog,
          positionMaxRanks: maxRanks,
          weeklyStatsByYear,
          scoringConfig: cfg,
          playersData: players,
        });

        setPhase('running');
        setProgress(0.2);

        const { results: simResults, resultDeltas, simRuns: runs } = await runMonteCarloSimulation(
          ctx,
          players,
          idMap,
          {
            iterations: runCount,
            onProgress: (p) => {
              if (!cancelled) setProgress(0.2 + p * 0.8);
            },
          },
        );

        if (!cancelled) {
          setResults(simResults);
          setResultDeltas(resultDeltas);
          setSimRuns(runs);
          setProgress(1);
          setPhase('done');
        }
      } catch (e) {
        if (!cancelled) {
          console.error('Simulator run failed:', e);
          setError('Simulation failed. Please try again.');
          setPhase('error');
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, [scenarioParam]);

  const backLink = (
    <Link
      to="/simulator?state=builder"
      className="scenario-eval-back-link"
      onClick={() => {
        if (scenarioParam) {
          sessionStorage.setItem('pendingSimulatorBuilderScenario', scenarioParam);
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
        title="Season Simulator"
        subtitle={scenarioSeason ? `${scenarioSeason} · ${iterations.toLocaleString()} runs` : null}
        leftHeader={backLink}
      >
        {(phase === 'loading' || phase === 'running') && (
          <div className="simulator-run-layout">
            <SimulatorProgressBar
              progress={progress}
              phase={phase}
              iterations={iterations}
            />
            {phase === 'loading' && (
              <LoadingState label="Preparing outcome pools and weekly stats…" />
            )}
          </div>
        )}

        {phase === 'error' && (
          <div className="scenario-eval-error">
            <p>{error || 'Something went wrong.'}</p>
            <Link to="/simulator" className="scenario-eval-back-link">
              ← Back to Builder
            </Link>
          </div>
        )}

        {phase === 'done' && results && (
          <div className="scenario-page-layout scenario-eval-layout">
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
                <SimulatorResultsPanel
                  results={results}
                  resultDeltas={resultDeltas}
                  teamsForGrid={teamsForGrid}
                  iterations={iterations}
                  selectedRosterId={selectedRosterId}
                  onSelectTeam={setSelectedRosterId}
                />
              </div>
            </div>

            {selectedRosterId != null && simRuns ? (
              <SimulatorTeamDetail
                rosterId={selectedRosterId}
                teamsForGrid={teamsForGrid}
                simRuns={simRuns}
                originalRosters={originalRosters}
                scenarioRosters={scenarioRosters}
                seasonYear={scenarioSeason}
                iterations={iterations}
              />
            ) : (
              <div className="scenario-eval-team-stats-placeholder">
                Click a team above to see finish distribution and open specific simulations
              </div>
            )}
          </div>
        )}
      </InfoPageWrapper>
    </>
  );
}

export default SimulatorRunPage;
