/**
 * SimulatorRunPage — load scenario, run 1000 Monte Carlo sims, show win rates.
 */

import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { getStandings } from '../scores/ScoresParser';
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
import { getCurrentYear } from '../utils/DateHelper';

const OG_TITLE = 'Season Simulator — Results';
const OG_DESCRIPTION = 'Championship odds from 1000 outcome-roll simulations.';

async function loadCurrentRosterData() {
  const currentYear = getCurrentYear();
  const [teamData, idMap, weeksData, players] = await Promise.all([
    fetchTeamData(currentYear),
    fetchPlayerIdMap(),
    fetchScoresData(currentYear).catch(() => null),
    fetch('/data/players.txt').then((r) => r.json()).catch(() => null),
  ]);

  if (!teamData || !Array.isArray(teamData.rosters)) {
    throw new Error('No team data');
  }

  const standings = getStandings(weeksData) || [];
  const placeByRosterId = {};
  standings.forEach((row) => {
    if (row?.roster_id != null) {
      placeByRosterId[String(row.roster_id)] = row.place != null ? row.place : 999;
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
    };
  }).filter(Boolean);

  const teams = teamsUnsorted.slice().sort((a, b) => {
    const pa = placeByRosterId[String(a.rosterId)] ?? 999;
    const pb = placeByRosterId[String(b.rosterId)] ?? 999;
    return pa !== pb ? pa - pb : Number(a.rosterId) - Number(b.rosterId);
  });

  const originalRosters = {};
  for (const roster of teamData.rosters) {
    const rid = roster?.roster_id != null ? Number(roster.roster_id) : null;
    if (rid != null) {
      originalRosters[rid] = Array.isArray(roster.players) ? [...roster.players] : [];
    }
  }

  return { teams, originalRosters, idMap, players };
}

function SimulatorProgressBar({ progress, phase }) {
  const pct = Math.round((progress || 0) * 100);
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
          {Math.round((progress || 0) * DEFAULT_ITERATIONS).toLocaleString()}
          {' / '}
          {DEFAULT_ITERATIONS.toLocaleString()}
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
  const [teamsForGrid, setTeamsForGrid] = useState([]);
  const [originalRosters, setOriginalRosters] = useState({});
  const [scenarioRosters, setScenarioRosters] = useState({});
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);

  useEffect(() => {
    const decoded = decodeFutureScenario2(scenarioParam);
    if (!decoded) {
      setError('Invalid or missing scenario data.');
      setPhase('error');
      return;
    }

    let cancelled = false;

    async function run() {
      try {
        setPhase('loading');
        setProgress(0.05);

        const currentYear = getCurrentYear();
        const [rosterData, cfg, adpMap, maxRanks] = await Promise.all([
          loadCurrentRosterData(),
          fetch('/data/score_format.json').then((r) => r.json()).catch(() => null),
          loadCurrentHwangAdpRankMap(currentYear),
          loadHwangPositionMaxRanks(currentYear),
        ]);

        if (cancelled) return;

        const { teams, originalRosters: orig, idMap, players } = rosterData;
        const catalog = await loadHistoricalOutcomeCatalog(currentYear, players);
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
          hwangAdpRankMap: adpMap,
          catalog: catalog.catalog,
          positionMaxRanks: maxRanks,
          weeklyStatsByYear,
          scoringConfig: cfg,
          playersData: players,
        });

        setPhase('running');
        setProgress(0.2);

        const simResults = await runMonteCarloSimulation(ctx, players, idMap, {
          iterations: DEFAULT_ITERATIONS,
          onProgress: (p) => {
            if (!cancelled) setProgress(0.2 + p * 0.8);
          },
        });

        if (!cancelled) {
          setResults(simResults);
          setProgress(1);
          setPhase('done');
        }
      } catch (e) {
        if (!cancelled) {
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
      <InfoPageWrapper title="Season Simulator" subtitle={null} leftHeader={backLink}>
        {(phase === 'loading' || phase === 'running') && (
          <div className="simulator-run-layout">
            <SimulatorProgressBar progress={progress} phase={phase} />
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
                  teamsForGrid={teamsForGrid}
                  iterations={DEFAULT_ITERATIONS}
                />
              </div>
            </div>
          </div>
        )}
      </InfoPageWrapper>
    </>
  );
}

export default SimulatorRunPage;
