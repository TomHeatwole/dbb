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
import { useMyCurrentRosterId } from '../hooks/useAuthUser';
import {
  loadCurrentHwangAdpRankMap,
  loadHwangPositionMaxRanks,
} from '../scenarios/hwangAdpLoader';
import { loadHistoricalOutcomeCatalog, getOutcomeHistoryYears } from '../scenarios/historicalOutcomeData';
import {
  prepareSimulatorContext,
  runMonteCarloSimulation,
  DEFAULT_ITERATIONS,
  isLightweightSimulatorRun,
} from '../scenarios/simulatorMonteCarlo';
import SimulatorResultsPanel from '../scenarios/SimulatorResultsPanel';
import SimulatorTeamDetail from '../scenarios/SimulatorTeamDetail';
import { loadOutcomeScenarioRosterData } from '../scenarios/outcomeScenarioLoader';
import { normalizeOutcomeScenarioYear } from '../scenarios/outcomeScenarioConfig';

import SimulatorProgressBar from '../scenarios/SimulatorProgressBar';
import { TOUCHDOWN_CELEBRATION_MS } from '../scenarios/simulatorProgress';

const OG_TITLE = 'Season Simulator — Results';
const OG_DESCRIPTION = 'Championship odds from outcome-roll simulations.';

function SimulatorRunPage() {
  const myRosterId = useMyCurrentRosterId();
  const [searchParams] = useSearchParams();
  const scenarioParam = searchParams.get('scenario');

  const [phase, setPhase] = useState('loading');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [simProgress, setSimProgress] = useState(0);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [resultDeltas, setResultDeltas] = useState(null);
  const [teamFinishBuckets, setTeamFinishBuckets] = useState(null);
  const [teamScoreHistograms, setTeamScoreHistograms] = useState(null);
  const [teamSlotHistograms, setTeamSlotHistograms] = useState(null);
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
        setLoadingProgress(0);
        setSimProgress(0);

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
        setLoadingProgress(0.45);

        const yearsNeeded = getOutcomeHistoryYears(Number(seasonYear));

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
        setLoadingProgress(0.9);

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

        setLoadingProgress(1);
        setPhase('running');
        setSimProgress(0);

        const {
          results: simResults,
          resultDeltas,
          teamFinishBuckets: finishBuckets,
          teamScoreHistograms: scoreHists,
          teamSlotHistograms: slotHists,
        } = await runMonteCarloSimulation(
          ctx,
          players,
          idMap,
          {
            iterations: runCount,
            onProgress: (p) => {
              if (!cancelled) setSimProgress(p);
            },
          },
        );

        if (!cancelled) {
          setResults(simResults);
          setResultDeltas(resultDeltas);
          setTeamFinishBuckets(finishBuckets);
          setTeamScoreHistograms(scoreHists);
          setTeamSlotHistograms(slotHists);
          setSimProgress(1);
          setPhase('celebrating');
          await new Promise((resolve) => {
            setTimeout(resolve, TOUCHDOWN_CELEBRATION_MS);
          });
          if (!cancelled) {
            setPhase('done');
          }
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

  const simSamplesAvailable = !isLightweightSimulatorRun(iterations);

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
        {(phase === 'loading' || phase === 'running' || phase === 'celebrating') && (
          <div className="simulator-run-layout">
            <SimulatorProgressBar
              phase={phase}
              loadingProgress={loadingProgress}
              simProgress={simProgress}
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
                  drillDownEnabled
                  myRosterId={myRosterId}
                />
              </div>
            </div>

            {selectedRosterId != null && teamFinishBuckets ? (
              <SimulatorTeamDetail
                rosterId={selectedRosterId}
                teamsForGrid={teamsForGrid}
                teamFinishBuckets={teamFinishBuckets}
                teamScoreHistograms={teamScoreHistograms}
                teamSlotHistograms={teamSlotHistograms}
                originalRosters={originalRosters}
                scenarioRosters={scenarioRosters}
                seasonYear={scenarioSeason}
                iterations={iterations}
                simSamplesAvailable={simSamplesAvailable}
              />
            ) : (
              <div className="scenario-eval-team-stats-placeholder">
                Click a team above to see finish, score, and lineup position distributions
              </div>
            )}
          </div>
        )}
      </InfoPageWrapper>
    </>
  );
}

export default SimulatorRunPage;
