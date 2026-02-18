/**
 * ScenarioBuilderPage — the "builder" state of the Scenario Builder feature.
 *
 * Completely self-contained: owns all data loading, roster-editing state,
 * and navigation to the eval view. No coupling to ScenarioEvalPage.
 *
 * Entry point: rendered by ScenariosPage when ?state=builder (or no state param).
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { getStandings } from '../scores/ScoresParser';
import { PREVIOUS_YEARS } from '../utils/global_constants';
import ScenarioTeamGrid from '../scenarios/ScenarioTeamGrid';
import ScenarioRosterEditor from '../scenarios/ScenarioRosterEditor';
import ScenarioDeltas from '../scenarios/ScenarioDeltas';
import ScenarioBuilderTooltip from '../scenarios/ScenarioBuilderTooltip';
import { encodeScenario } from '../scenarios/scenarioEncoding';

const OG_TITLE = 'Scenario Builder';
const OG_DESCRIPTION = 'Build what-if scenarios by editing team rosters.';

// Only completed seasons (PREVIOUS_YEARS keys), newest-first
const SCENARIO_YEARS = Object.keys(PREVIOUS_YEARS).sort((a, b) => Number(b) - Number(a));

// ── CSV helpers ──────────────────────────────────────────────────────────────

function parseStatsCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += c; }
  }
  result.push(current);
  return result;
}

/**
 * Parse the season stats CSV and return the top N players by PPR fantasy
 * points, resolved to the player-info shape used elsewhere in the app.
 */
function buildTopPlayersByStats(csvText, playersData, playerIdMap, n = 25) {
  if (!csvText || !playersData) return [];
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',');
  const idIdx   = headers.indexOf('player_id');
  const nameIdx = headers.indexOf('player_display_name');
  const ptsIdx  = headers.indexOf('fantasy_points_ppr');
  if (idIdx === -1 || ptsIdx === -1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals  = parseStatsCsvLine(lines[i]);
    const gsisId = vals[idIdx]?.trim();
    const pts    = parseFloat(vals[ptsIdx]) || 0;
    if (!gsisId || pts <= 0) continue;
    rows.push({ gsisId, name: (vals[nameIdx] || '').trim(), fantasyPoints: pts });
  }

  rows.sort((a, b) => b.fantasyPoints - a.fantasyPoints);
  const topRows = rows.slice(0, n);

  // Build reverse-lookup maps in a single pass over playersData
  const gsisSet      = new Set(topRows.map((r) => r.gsisId));
  const gsisToSleeper = {};
  const nameToSleeper = {};
  for (const sid in playersData) {
    const p = playersData[sid];
    if (p.gsis_id && gsisSet.has(p.gsis_id)) gsisToSleeper[p.gsis_id] = sid;
    if (p.full_name) nameToSleeper[p.full_name.toLowerCase()] = sid;
  }

  const result = [];
  for (const row of topRows) {
    const sleeperId = gsisToSleeper[row.gsisId] || nameToSleeper[row.name.toLowerCase()];
    if (!sleeperId) continue;
    const info = getPlayerInfo(sleeperId, playersData, playerIdMap);
    if (info) result.push({ ...info, player_id: sleeperId });
  }
  return result;
}

// ── Component ────────────────────────────────────────────────────────────────

function ScenarioBuilderPage() {
  const navigate = useNavigate();

  const [season, setSeason]                     = useState(SCENARIO_YEARS[0] || '2025');
  const [dropdownOpen, setDropdownOpen]         = useState(false);
  const [playersData, setPlayersData]           = useState(null);
  const [playerIdMap, setPlayerIdMap]           = useState(null);
  const [topPlayersBySeason, setTopPlayersBySeason] = useState([]);
  const [teamsForGrid, setTeamsForGrid]         = useState([]);
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState(null);
  // scenarioRosters — mutable copy the user edits
  const [scenarioRosters, setScenarioRosters]   = useState({});
  // originalRosters — immutable snapshot used for delta calculation
  const [originalRosters, setOriginalRosters]   = useState({});
  const [selectedRosterId, setSelectedRosterId] = useState(null);

  // ── Data loading ───────────────────────────────────────────────────────────

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
        const [teamData, idMap, weeksData, players, statsCsvResp] = await Promise.all([
          fetchTeamData(season),
          fetchPlayerIdMap(),
          fetchScoresData(season),
          fetch('/data/players.txt').then((r) => r.json()).catch(() => null),
          fetch(`/data/stats_player_reg_${season}.csv`).catch(() => null),
        ]);

        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }
        if (cancelled) return;

        let topPlayers = [];
        if (statsCsvResp && statsCsvResp.ok && players) {
          const csvText = await statsCsvResp.text();
          topPlayers = buildTopPlayersByStats(csvText, players, idMap);
        }

        setPlayersData(players);
        setPlayerIdMap(idMap);
        setTopPlayersBySeason(topPlayers);

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
            (u) => roster && String(u.user_id) === String(roster.owner_id)
          );
          let teamName = `Team ${rid}`;
          if (user?.metadata?.team_name)        teamName = user.metadata.team_name;
          else if (user?.display_name)          teamName = `Team ${user.display_name}`;
          const avatarUrl =
            (user && (user.team_avatar_url || user.user_avatar_url || user.avatar_url)) || null;
          const place       = placeByRosterId[String(rid)];
          const totalPoints = pointsByRosterId[String(rid)];
          return {
            rosterId: rid,
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
        setTeamsForGrid(teams);

        const initial = {};
        for (const roster of teamData.rosters) {
          const rid = roster && roster.roster_id != null ? Number(roster.roster_id) : null;
          if (rid != null) initial[rid] = Array.isArray(roster.players) ? [...roster.players] : [];
        }
        setScenarioRosters(initial);
        const snapshot = {};
        for (const rid in initial) snapshot[rid] = [...initial[rid]];
        setOriginalRosters(snapshot);
      } catch (e) {
        if (!cancelled) setError('Failed to load scenario data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [season]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSelectTeam = (rosterId) => setSelectedRosterId(rosterId);

  /** Revert a single delta: 'add' → remove the added player; 'remove' → restore it. */
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
    const encoded = encodeScenario(season, originalRosters, scenarioRosters);
    navigate(`?state=eval&scenario=${encoded}`);
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const selectedTeam = useMemo(
    () => teamsForGrid.find((t) => t.rosterId === selectedRosterId) || null,
    [teamsForGrid, selectedRosterId],
  );

  const hasChanges = useMemo(() => {
    for (const rid in originalRosters) {
      const orig    = new Set(originalRosters[rid] || []);
      const curr    = scenarioRosters[rid] || [];
      const currSet = new Set(curr);
      for (const pid of currSet) { if (!orig.has(pid)) return true; }
      for (const pid of orig)    { if (!currSet.has(pid)) return true; }
    }
    return false;
  }, [originalRosters, scenarioRosters]);

  // ── Year selector (left header slot) ──────────────────────────────────────

  const leftHeader = (
    <div className="team-season-dropdown" onClick={() => setDropdownOpen((o) => !o)}>
      {season}
      <span className="team-season-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
      {dropdownOpen && (
        <div className="team-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
          {SCENARIO_YEARS.map((yr) => (
            <div
              key={yr}
              className={
                'team-season-dropdown-option' +
                (yr === season ? ' team-season-dropdown-option-active' : '')
              }
              onClick={() => { setSeason(yr); setDropdownOpen(false); }}
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
        title={<>Scenario Builder <ScenarioBuilderTooltip /></>}
        subtitle={null}
        leftHeader={leftHeader}
      >
        {loading && <LoadingState label="Loading scenario data…" />}

        {!loading && error && (
          <div style={{ color: '#ff6b6b', padding: '20px' }}>{error}</div>
        )}

        {!loading && !error && (
          <div className="scenario-page-layout">
            {/* Team selector — full width across the top */}
            <div className="scenario-page-top">
              <ScenarioTeamGrid
                teams={teamsForGrid}
                selectedRosterId={selectedRosterId}
                onSelectTeam={handleSelectTeam}
              />
            </div>

            {/* Middle: deltas + evaluate (left) | roster editor (right) */}
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
                  {/* Outer span intercepts hover even when button is disabled */}
                  <span className={!hasChanges ? 'scenario-evaluate-hint' : undefined}>
                    <button
                      type="button"
                      className={
                        'scenario-evaluate-btn' +
                        (!hasChanges ? ' scenario-evaluate-btn--disabled' : '')
                      }
                      disabled={!hasChanges}
                      onClick={handleEvaluate}
                    >
                      Evaluate Scenario →
                    </button>
                    {!hasChanges && (
                      <span className="scenario-evaluate-hint-tooltip">
                        Make at least one roster change to evaluate
                      </span>
                    )}
                  </span>
                </div>
              </div>

              <div className="scenario-page-editor-col">
                {selectedTeam && playersData && playerIdMap ? (
                  <ScenarioRosterEditor
                    key={`${season}-${selectedRosterId}`}
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

export default ScenarioBuilderPage;
