/**
 * FutureScenarioBuilderPage — the "builder" state of the Future Scenarios feature.
 *
 * Like the Scenario Builder, but uses current live rosters and projects them
 * forward using FantasyPros rankings mapped onto a chosen historical season.
 *
 * Key differences from ScenarioBuilderPage:
 *   • Rosters always come from the current live league (not a selectable season).
 *   • The season dropdown selects the *projection year* (historical season whose
 *     stats are used for stat mapping), not the roster source.
 *   • The search pool for adding players is drawn from FantasyPros rankings
 *     rather than a historical stats CSV.
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
import { buildTopPlayersFromFpCsvs } from '../scenarios/fpRankingsLoader';
import { encodeFutureScenario, decodeFutureScenario, applyScenarioChanges } from '../scenarios/scenarioEncoding';

const OG_TITLE = 'Future Scenarios';
const OG_DESCRIPTION = 'Project your current rosters through a full season using FantasyPros rankings.';

// FP CSV paths (no position changes needed — just need the raw text for search pool)
const FP_CSV_PATHS = [
  '/data/fantasypros_qb.csv',
  '/data/fantasypros_rb_std.csv',
  '/data/fantasypros_wr_std.csv',
  '/data/fantasypros_te_half.csv',
];

// All years for which stats_player_reg_{year}.csv exists, newest-first.
// Sleeper weekly stats API is reliable from ~2018 onward; older years will
// still produce correct positional rankings but projected points may be sparse.
const PROJECTION_YEARS = [
  '2025','2024','2023','2022','2021','2020',
  '2019','2018','2017','2016','2015','2014',
  '2013','2012','2011','2010','2009','2008',
  '2007','2006','2005',
];

// ── Tooltip ───────────────────────────────────────────────────────────────────

function FutureScenariosTooltip() {
  return (
    <span className="info-icon scenario-builder-tooltip" aria-label="About Future Scenarios">
      ℹ️
      <span className="info-icon-tooltip">
        <div className="scenario-builder-tooltip-inner">
          <div className="scenario-builder-tooltip-body">
            <p style={{ margin: '0 0 0.6em 0' }}>
              Project your current rosters through a full 17-week season using
              FantasyPros rankings as a guide.
            </p>
            <p style={{ margin: '0 0 0.6em 0' }}>
              Each player's FP positional rank is mapped to the player who
              achieved that same rank in the chosen projection season. That
              historical player's week-by-week stats become the projection.
            </p>
            <p style={{ margin: 0 }}>
              Use the <strong>projection year</strong> dropdown to choose which
              historical season's stats to use. Edit any roster to model a trade
              or waiver move, then hit <strong>Evaluate →</strong> to see projected standings.
            </p>
          </div>
        </div>
      </span>
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

function FutureScenarioBuilderPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Decode any pre-loaded future scenario from sessionStorage / URL on mount.
  const pendingScenarioRef = useRef(() => {
    const param = searchParams.get('scenario');
    return param ? decodeFutureScenario(param) : null;
  });
  if (typeof pendingScenarioRef.current === 'function') {
    pendingScenarioRef.current = pendingScenarioRef.current();
  }

  const [projectionYear, setProjectionYear] = useState(() => {
    const pre = pendingScenarioRef.current;
    if (pre && PROJECTION_YEARS.includes(pre.py)) return pre.py;
    return PROJECTION_YEARS[0] || '2024';
  });
  const [dropdownOpen, setDropdownOpen]         = useState(false);
  const [playersData, setPlayersData]           = useState(null);
  const [playerIdMap, setPlayerIdMap]           = useState(null);
  const [topPlayersBySeason, setTopPlayersBySeason] = useState([]);
  const [teamsForGrid, setTeamsForGrid]         = useState([]);
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState(null);
  const [scenarioRosters, setScenarioRosters]   = useState({});
  const [originalRosters, setOriginalRosters]   = useState({});
  const [selectedRosterId, setSelectedRosterId] = useState(null);

  // ── Data loading ───────────────────────────────────────────────────────────
  // Rosters are always current-year — only loaded once on mount.
  // Changing the projection year does NOT reload rosters.

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

        const [teamData, idMap, weeksData, players, ...fpResponses] = await Promise.all([
          fetchTeamData(currentYear),
          fetchPlayerIdMap(),
          fetchScoresData(currentYear).catch(() => null),
          fetch('/data/players.txt').then((r) => r.json()).catch(() => null),
          ...FP_CSV_PATHS.map((p) => fetch(p).catch(() => null)),
        ]);

        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }
        if (cancelled) return;

        // Build FP search pool
        const fpTexts = await Promise.all(
          fpResponses.map((r) => (r && r.ok ? r.text().catch(() => null) : null)),
        );
        const topPlayers = players && idMap
          ? buildTopPlayersFromFpCsvs(fpTexts, players, idMap, getPlayerInfo)
          : [];

        setPlayersData(players);
        setPlayerIdMap(idMap);
        setTopPlayersBySeason(topPlayers);

        // Build teams, optionally including current standings if available
        const standings         = getStandings(weeksData) || [];
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
            place:       place && place !== 999 ? place : null,
            totalPoints: totalPoints ?? null,
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
          const rid = roster && roster.roster_id != null ? Number(roster.roster_id) : null;
          if (rid != null) initial[rid] = Array.isArray(roster.players) ? [...roster.players] : [];
        }

        // Restore scenario from sessionStorage (returning from eval) or URL param
        const storedEncoded = sessionStorage.getItem('pendingFutureBuilderScenario');
        const pending = storedEncoded
          ? decodeFutureScenario(storedEncoded)
          : pendingScenarioRef.current;
        if (storedEncoded) sessionStorage.removeItem('pendingFutureBuilderScenario');
        pendingScenarioRef.current = null;

        if (pending && Array.isArray(pending.c) && pending.c.length > 0) {
          setScenarioRosters(applyScenarioChanges(initial, pending.c));
          if (pending.py && PROJECTION_YEARS.includes(pending.py)) {
            setProjectionYear(pending.py);
          }
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('scenario');
            return next;
          }, { replace: true });
        } else {
          setScenarioRosters(initial);
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
  }, []); // Rosters only load once — projection year changes don't reload

  // ── Handlers ───────────────────────────────────────────────────────────────

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
    if (selectedRosterId == null) return;
    setScenarioRosters((prev) => {
      const current = prev[selectedRosterId] || [];
      if (current.includes(playerId)) return prev;
      return { ...prev, [selectedRosterId]: [...current, playerId] };
    });
  };

  const handleEvaluate = () => {
    const encoded = encodeFutureScenario(projectionYear, originalRosters, scenarioRosters);
    navigate(`?state=eval&scenario=${encodeURIComponent(encoded)}`);
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const selectedTeam = useMemo(
    () => teamsForGrid.find((t) => t.rosterId === selectedRosterId) || null,
    [teamsForGrid, selectedRosterId],
  );

  // ── Projection year selector (left header slot) ───────────────────────────

  const leftHeader = (
    <div className="team-season-dropdown" onClick={() => setDropdownOpen((o) => !o)}>
      <span className="future-scenario-proj-label">Proj: </span>
      {projectionYear}
      <span className="team-season-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
      {dropdownOpen && (
        <div className="team-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
          {PROJECTION_YEARS.map((yr) => (
            <div
              key={yr}
              className={
                'team-season-dropdown-option' +
                (yr === projectionYear ? ' team-season-dropdown-option-active' : '')
              }
              onClick={() => { setProjectionYear(yr); setDropdownOpen(false); }}
            >
              {yr}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper
        title={<>Future Scenarios <FutureScenariosTooltip /></>}
        subtitle={null}
        leftHeader={leftHeader}
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
                    className="scenario-evaluate-btn"
                    onClick={handleEvaluate}
                  >
                    Evaluate Scenario →
                  </button>
                </div>
              </div>

              <div className="scenario-page-editor-col">
                {selectedTeam && playersData && playerIdMap ? (
                  <ScenarioRosterEditor
                    key={`future-${selectedRosterId}`}
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

export default FutureScenarioBuilderPage;
