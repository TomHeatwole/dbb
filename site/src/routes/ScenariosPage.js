import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
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
import ScenarioEvalView from '../scenarios/ScenarioEvalView';
import { encodeScenario } from '../scenarios/scenarioEncoding';

const OG_TITLE = 'Scenario Builder';
const OG_DESCRIPTION = 'Build what-if scenarios by editing team rosters.';

// Only allow completed seasons (PREVIOUS_YEARS keys), newest first
const SCENARIO_YEARS = Object.keys(PREVIOUS_YEARS).sort((a, b) => Number(b) - Number(a));

// Parse quoted-field CSV lines (same approach as HottestFreeAgents)
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
 * Parse the season stats CSV and return the top N players by PPR fantasy points,
 * resolved to the same player-info shape used elsewhere in the app.
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

  // Parse every row into { gsisId, name, fantasyPoints }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseStatsCsvLine(lines[i]);
    const gsisId = vals[idIdx]?.trim();
    const pts    = parseFloat(vals[ptsIdx]) || 0;
    if (!gsisId || pts <= 0) continue;
    rows.push({ gsisId, name: (vals[nameIdx] || '').trim(), fantasyPoints: pts });
  }

  // Take the top N by PPR points
  rows.sort((a, b) => b.fantasyPoints - a.fantasyPoints);
  const topRows = rows.slice(0, n);

  // Build two reverse-lookup maps from playersData in a single pass
  const gsisSet = new Set(topRows.map((r) => r.gsisId));
  const gsisToSleeper = {};   // gsis_id  → sleeper_id
  const nameToSleeper = {};   // full_name (lower) → sleeper_id
  for (const sid in playersData) {
    const p = playersData[sid];
    if (p.gsis_id && gsisSet.has(p.gsis_id)) {
      gsisToSleeper[p.gsis_id] = sid;
    }
    if (p.full_name) {
      nameToSleeper[p.full_name.toLowerCase()] = sid;
    }
  }

  // Resolve each top-row to a full player-info object
  const result = [];
  for (const row of topRows) {
    const sleeperId = gsisToSleeper[row.gsisId] || nameToSleeper[row.name.toLowerCase()];
    if (!sleeperId) continue;
    const info = getPlayerInfo(sleeperId, playersData, playerIdMap);
    if (info) result.push({ ...info, player_id: sleeperId });
  }
  return result;
}

function ScenariosPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const pageState = searchParams.get('state') || 'builder';

  const [season, setSeason] = useState(SCENARIO_YEARS[0] || '2025');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [topPlayersBySeason, setTopPlayersBySeason] = useState([]);
  const [teamsForGrid, setTeamsForGrid] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // scenarioRosters: mutable copy the user edits
  const [scenarioRosters, setScenarioRosters] = useState({});
  // originalRosters: snapshot from load, never mutated — used for delta calculation
  const [originalRosters, setOriginalRosters] = useState({});

  // Which team is currently open in the editor
  const [selectedRosterId, setSelectedRosterId] = useState(null);

  // Reload everything when season changes
  useEffect(() => {
    let cancelled = false;

    // Reset UI state on new season
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

        // Build top-players list from the stats CSV
        let topPlayers = [];
        if (statsCsvResp && statsCsvResp.ok && players) {
          const csvText = await statsCsvResp.text();
          topPlayers = buildTopPlayersByStats(csvText, players, idMap);
        }

        setPlayersData(players);
        setPlayerIdMap(idMap);
        setTopPlayersBySeason(topPlayers);

        // Build sorted teams list (same logic as h2h page)
        const standings = getStandings(weeksData) || [];
        const placeByRosterId = {};
        standings.forEach((row) => {
          if (row && row.roster_id != null) {
            placeByRosterId[String(row.roster_id)] = row.place != null ? row.place : 999;
          }
        });

        const teamsUnsorted = (teamData.rosters || []).map((roster) => {
          const rid = roster && roster.roster_id != null ? Number(roster.roster_id) : null;
          if (rid == null) return null;
          const user = (teamData.users || []).find(
            (u) => roster && String(u.user_id) === String(roster.owner_id)
          );
          let teamName = `Team ${rid}`;
          if (user && user.metadata && user.metadata.team_name) {
            teamName = user.metadata.team_name;
          } else if (user && user.display_name) {
            teamName = `Team ${user.display_name}`;
          }
          const avatarUrl =
            (user && (user.team_avatar_url || user.user_avatar_url || user.avatar_url)) || null;
          return { rosterId: rid, teamName, avatarUrl };
        }).filter(Boolean);

        const teams = teamsUnsorted.slice().sort((a, b) => {
          const pa = placeByRosterId[String(a.rosterId)] ?? 999;
          const pb = placeByRosterId[String(b.rosterId)] ?? 999;
          if (pa !== pb) return pa - pb;
          return Number(a.rosterId) - Number(b.rosterId);
        });

        setTeamsForGrid(teams);

        // Initialize both the mutable copy and the immutable snapshot
        const initial = {};
        for (const roster of teamData.rosters) {
          const rid = roster && roster.roster_id != null ? Number(roster.roster_id) : null;
          if (rid != null) {
            initial[rid] = Array.isArray(roster.players) ? [...roster.players] : [];
          }
        }
        setScenarioRosters(initial);
        // Deep copy for the snapshot
        const snapshot = {};
        for (const rid in initial) {
          snapshot[rid] = [...initial[rid]];
        }
        setOriginalRosters(snapshot);
      } catch (e) {
        if (!cancelled) {
          setError('Failed to load scenario data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [season]);

  const handleSelectTeam = (rosterId) => setSelectedRosterId(rosterId);

  // Revert a single delta from the "Your Scenario" panel:
  // type 'add'    → player was added; revert by removing them
  // type 'remove' → player was removed; revert by restoring them
  const handleRevert = (rosterId, playerId, type) => {
    setScenarioRosters((prev) => {
      const current = prev[rosterId] || [];
      if (type === 'add') {
        return { ...prev, [rosterId]: current.filter((pid) => pid !== playerId) };
      } else {
        if (current.includes(playerId)) return prev;
        return { ...prev, [rosterId]: [...current, playerId] };
      }
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

  const selectedTeam = useMemo(
    () => teamsForGrid.find((t) => t.rosterId === selectedRosterId) || null,
    [teamsForGrid, selectedRosterId]
  );

  // True when the user has made at least one change across any roster
  const hasChanges = useMemo(() => {
    for (const rid in originalRosters) {
      const orig = new Set(originalRosters[rid] || []);
      const curr = scenarioRosters[rid] || [];
      const currSet = new Set(curr);
      for (const pid of currSet) { if (!orig.has(pid)) return true; }
      for (const pid of orig) { if (!currSet.has(pid)) return true; }
    }
    return false;
  }, [originalRosters, scenarioRosters]);

  const handleEvaluate = () => {
    const encoded = encodeScenario(season, originalRosters, scenarioRosters);
    navigate(`?state=eval&scenario=${encoded}`);
  };

  // Year selector rendered in the page header's left slot
  const leftHeader = (
    <div
      className="team-season-dropdown"
      onClick={() => setDropdownOpen((o) => !o)}
    >
      {season}
      <span className="team-season-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
      {dropdownOpen && (
        <div
          className="team-season-dropdown-list"
          onClick={(e) => e.stopPropagation()}
        >
          {SCENARIO_YEARS.map((yr) => (
            <div
              key={yr}
              className={
                'team-season-dropdown-option' +
                (yr === season ? ' team-season-dropdown-option-active' : '')
              }
              onClick={() => {
                setSeason(yr);
                setDropdownOpen(false);
              }}
            >
              {yr}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Eval view ────────────────────────────────────────────────────────────
  if (pageState === 'eval') {
    return (
      <>
        <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
        <InfoPageWrapper title={<>Scenario Builder <ScenarioBuilderTooltip /></>} subtitle={null}>
          <ScenarioEvalView scenarioParam={searchParams.get('scenario')} />
        </InfoPageWrapper>
      </>
    );
  }

  // ── Builder view (default) ────────────────────────────────────────────────
  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper title={<>Scenario Builder <ScenarioBuilderTooltip /></>} subtitle={null} leftHeader={leftHeader}>
        {loading && <LoadingState label="Loading scenario data…" />}

        {!loading && error && (
          <div style={{ color: '#ff6b6b', padding: '20px' }}>{error}</div>
        )}

        {!loading && !error && (
          <div className="scenario-page-layout">
            {/* Top: team selector full width */}
            <div className="scenario-page-top">
              <ScenarioTeamGrid
                teams={teamsForGrid}
                selectedRosterId={selectedRosterId}
                onSelectTeam={handleSelectTeam}
              />
            </div>

            {/* Middle: deltas + evaluate on left, editor on right */}
            <div className="scenario-page-middle">
              {/* Left: Your Scenario deltas, evaluate button pinned to bottom */}
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
                    className={'scenario-evaluate-btn' + (!hasChanges ? ' scenario-evaluate-btn--disabled' : '')}
                    disabled={!hasChanges}
                    onClick={handleEvaluate}
                  >
                    Evaluate Scenario
                  </button>
                </div>
              </div>

              {/* Right: roster editor fills full column height */}
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

export default ScenariosPage;
