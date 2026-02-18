/**
 * ScenarioEvalPage — the "eval" state of the Scenario Builder feature.
 *
 * Completely self-contained: owns all data loading for the evaluation view.
 * No coupling to ScenarioBuilderPage.
 *
 * Entry point: rendered by ScenariosPage when ?state=eval&scenario=<encoded>.
 *
 * The scenario param is decoded to get the season year and per-team changes.
 * Season data is re-fetched so the original rosters can be reconstructed,
 * then the encoded changes are applied to produce the modified rosters.
 *
 * The right-hand panel is a placeholder — ready for a second agent to build
 * the actual evaluation logic without touching ScenarioBuilderPage.
 */

import React, { useEffect, useMemo, useState } from 'react';
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
import ScenarioBuilderTooltip from '../scenarios/ScenarioBuilderTooltip';
import { decodeScenario, applyScenarioChanges } from '../scenarios/scenarioEncoding';
import { validateScenarioRosters } from '../scenarios/scenarioValidation';
import { computeScenarioEval } from '../scenarios/computeScenarioEval';
import ScenarioStandingsPanel from '../scenarios/ScenarioStandingsPanel';
import ScenarioTeamDetail from '../scenarios/ScenarioTeamDetail';

const OG_TITLE = 'Scenario Builder — Evaluate';
const OG_DESCRIPTION = 'Evaluate what-if scenario results for a customised team roster.';

// ── Team data helper (mirrors the builder's loading logic) ───────────────────

async function loadSeasonData(year) {
  const allWeeks = Array.from({ length: 17 }, (_, i) => i + 1);

  const [teamData, idMap, weeksData, players, scoringConfig, sleeperWeeklyStats] = await Promise.all([
    fetchTeamData(year),
    fetchPlayerIdMap(),
    fetchScoresData(year),
    fetch('/data/players.txt').then((r) => r.json()).catch(() => null),
    fetch('/data/score_format.json').then((r) => r.json()).catch(() => null),
    fetchMultipleWeeksStats(year, allWeeks, 0).catch(() => null),
  ]);

  if (!teamData || !Array.isArray(teamData.rosters)) {
    throw new Error('No team data');
  }

  const standings        = getStandings(weeksData) || [];
  const placeByRosterId  = {};
  const pointsByRosterId = {};
  standings.forEach((row) => {
    if (row && row.roster_id != null) {
      placeByRosterId[String(row.roster_id)]  = row.place != null ? row.place : 999;
      pointsByRosterId[String(row.roster_id)] = row.points_scored ?? 0;
    }
  });

  const teamsUnsorted = (teamData.rosters || []).map((roster) => {
    const rid = roster && roster.roster_id != null ? Number(roster.roster_id) : null;
    if (rid == null) return null;
    const user = (teamData.users || []).find(
      (u) => roster && String(u.user_id) === String(roster.owner_id),
    );
    let teamName = `Team ${rid}`;
    if (user?.metadata?.team_name)   teamName = user.metadata.team_name;
    else if (user?.display_name)     teamName = `Team ${user.display_name}`;
    const avatarUrl =
      (user && (user.team_avatar_url || user.user_avatar_url || user.avatar_url)) || null;
    const place       = placeByRosterId[String(rid)];
    const totalPoints = pointsByRosterId[String(rid)];
    return {
      rosterId:    rid,
      teamName,
      avatarUrl,
      place:       place !== 999 ? place : null,
      totalPoints: totalPoints ?? null,
    };
  }).filter(Boolean);

  const teams = teamsUnsorted.slice().sort((a, b) => {
    const pa = placeByRosterId[String(a.rosterId)] ?? 999;
    const pb = placeByRosterId[String(b.rosterId)] ?? 999;
    return pa !== pb ? pa - pb : Number(a.rosterId) - Number(b.rosterId);
  });

  const originalRosters = {};
  for (const roster of teamData.rosters) {
    const rid = roster && roster.roster_id != null ? Number(roster.roster_id) : null;
    if (rid != null) originalRosters[rid] = Array.isArray(roster.players) ? [...roster.players] : [];
  }

  // Convert the week-keyed object { 1: stats, 2: stats, ... } to a 0-indexed array
  const sleeperWeeklyStatsArray = sleeperWeeklyStats
    ? Array.from({ length: 17 }, (_, i) => sleeperWeeklyStats[i + 1] || null)
    : null;

  return { teams, originalRosters, idMap, players, weeksData, scoringConfig, sleeperWeeklyStats: sleeperWeeklyStatsArray };
}

// ── Invalid scenario badge ────────────────────────────────────────────────────

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

// ── Component ────────────────────────────────────────────────────────────────

function ScenarioEvalPage() {
  const [searchParams]                            = useSearchParams();
  const scenarioParam                             = searchParams.get('scenario');

  const [loading, setLoading]                     = useState(true);
  const [error, setError]                         = useState(null);
  const [season, setSeason]                       = useState(null);
  const [originalRosters, setOriginalRosters]     = useState({});
  const [scenarioRosters, setScenarioRosters]     = useState({});
  const [teamsForGrid, setTeamsForGrid]           = useState([]);
  const [playersData, setPlayersData]             = useState(null);
  const [playerIdMap, setPlayerIdMap]             = useState(null);
  const [weeksParsedData, setWeeksParsedData]     = useState(null);
  const [scoringConfig, setScoringConfig]         = useState(null);
  const [sleeperWeeklyStats, setSleeperWeeklyStats] = useState(null);
  const [selectedRosterId, setSelectedRosterId]   = useState(null);

  const rosterViolations = useMemo(
    () => validateScenarioRosters(scenarioRosters, teamsForGrid, playersData),
    [scenarioRosters, teamsForGrid, playersData],
  );

  const evalResult = useMemo(() => {
    if (!weeksParsedData || !playersData || !playerIdMap ||
        !originalRosters || !scenarioRosters ||
        Object.keys(originalRosters).length === 0) return null;
    return computeScenarioEval(
      weeksParsedData, originalRosters, scenarioRosters,
      playersData, playerIdMap,
      sleeperWeeklyStats, scoringConfig,
    );
  }, [weeksParsedData, originalRosters, scenarioRosters, playersData, playerIdMap, sleeperWeeklyStats, scoringConfig]);

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
        const {
          teams, originalRosters: orig, idMap, players, weeksData,
          scoringConfig: cfg, sleeperWeeklyStats: sleeperStats,
        } = await loadSeasonData(decoded.y);

        if (cancelled) return;

        const modified = applyScenarioChanges(orig, decoded.c);

        setOriginalRosters(orig);
        setScenarioRosters(modified);
        setTeamsForGrid(teams);
        setPlayersData(players);
        setPlayerIdMap(idMap);
        setWeeksParsedData(weeksData);
        setScoringConfig(cfg);
        setSleeperWeeklyStats(sleeperStats);
      } catch (e) {
        if (!cancelled) setError('Failed to load scenario data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [scenarioParam]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const backLink = (
    <Link
      to={`/scenarios?state=builder${scenarioParam ? `&scenario=${scenarioParam}` : ''}`}
      className="scenario-eval-back-link"
    >
      ← Edit Scenario
    </Link>
  );

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper
        title={<>Scenario Builder <ScenarioBuilderTooltip /></>}
        subtitle={null}
        leftHeader={backLink}
      >
        {loading && <LoadingState label="Loading scenario…" />}

        {!loading && error && (
          <div className="scenario-eval-error">
            <p>{error}</p>
            <Link to="/scenarios" className="scenario-eval-back-link">← Back to Builder</Link>
          </div>
        )}

        {!loading && !error && (
          <div className="scenario-page-layout scenario-eval-layout">
            {/* Season badge + validity notice */}
            {season && (
              <div className="scenario-eval-topbar">
                <span className="scenario-eval-season-label">{season} Season</span>
                <ScenarioInvalidBadge violations={rosterViolations} />
              </div>
            )}

            {/* Two-column body: deltas (left) | evaluation results (right) */}
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

              {/*
               * ── Evaluation results panel ────────────────────────────────
               * This is the handoff zone for the eval-focused agent.
               * Replace the placeholder below with actual evaluation content.
               * All required data is available via props from this component's
               * state: originalRosters, scenarioRosters, teamsForGrid,
               * playersData, playerIdMap, season.
               */}
              <div className="scenario-page-editor-col">
                {evalResult ? (
                  <ScenarioStandingsPanel
                    scenarioStandings={evalResult.scenarioStandings}
                    teamDeltas={evalResult.teamDeltas}
                    teamsForGrid={teamsForGrid}
                    selectedRosterId={selectedRosterId}
                    onSelectTeam={setSelectedRosterId}
                  />
                ) : (
                  <div className="scenario-eval-placeholder">
                    <div className="scenario-eval-placeholder-icon">📊</div>
                    <div className="scenario-eval-placeholder-title">Computing…</div>
                    <div className="scenario-eval-placeholder-body">
                      Building optimal lineups for all 17 weeks.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {evalResult && (
              selectedRosterId != null ? (
                <ScenarioTeamDetail
                  rosterId={selectedRosterId}
                  teamsForGrid={teamsForGrid}
                  originalWeeklyScores={evalResult.originalWeeklyScores}
                  scenarioWeeklyScores={evalResult.scenarioWeeklyScores}
                  playersData={playersData}
                  playerIdMap={playerIdMap}
                />
              ) : (
                <div className="scenario-eval-team-stats-placeholder">
                  Click on a team above to see their updated advanced stats
                </div>
              )
            )}
          </div>
        )}
      </InfoPageWrapper>
    </>
  );
}

export default ScenarioEvalPage;
