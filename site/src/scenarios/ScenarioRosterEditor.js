import React, { useState, useEffect, useRef } from 'react';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

// Left column: QB and WR; right column: everything else
const COL1_POSITIONS = ['QB', 'WR'];
const COL2_POSITIONS = ['RB', 'TE', 'K', 'DEF']; // eslint-disable-line no-unused-vars

function positionSortKey(pos) {
  const idx = POSITION_ORDER.indexOf(pos);
  return idx === -1 ? POSITION_ORDER.length : idx;
}

/** Renders a single position group (label + player rows) */
function PositionGroup({ pos, players, onRemovePlayer }) {
  return (
    <div className="scenario-editor-position-group">
      <div className="scenario-editor-position-label">{pos}</div>
      {players.map((player) => (
        <div key={player.player_id} className="scenario-editor-player-row">
          <img
            src={getPlayerLogoUrl(player.espn_photo_url)}
            alt={player.name}
            className="scenario-editor-player-avatar"
          />
          <div className="scenario-editor-player-info">
            <span className="scenario-editor-player-name">{player.name}</span>
            {(player.team || player.team_abbr) && (
              <span className="scenario-editor-player-pos">
                {player.team || player.team_abbr}
              </span>
            )}
          </div>
          <button
            type="button"
            className="scenario-editor-remove-btn"
            onClick={() => onRemovePlayer(player.player_id)}
            title={`Remove ${player.name}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Editable roster panel for a single scenario team.
 * - Shows current roster players grouped by position
 * - Remove button on each player row
 * - Search bar at the bottom to add players (mirrors PlayerSearch sandbox behavior)
 */
function ScenarioRosterEditor({
  team,
  playerIds,
  playersData,
  playerIdMap,
  topPlayersBySeason,
  onRemovePlayer,
  onAddPlayer,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const searchWrapperRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Resolve player IDs to full info, grouped by position
  const playersByPosition = {};
  for (const pid of (playerIds || [])) {
    const info = getPlayerInfo(pid, playersData, playerIdMap);
    const player = info
      ? { ...info, player_id: pid }
      : { name: pid, position: '', espn_photo_url: null, player_id: pid };
    const pos = POSITION_ORDER.includes(player.position) ? player.position : 'Other';
    if (!playersByPosition[pos]) playersByPosition[pos] = [];
    playersByPosition[pos].push(player);
  }

  // Build sorted position sections (only positions that have players)
  const allSections = [...POSITION_ORDER, 'Other']
    .filter((pos) => playersByPosition[pos] && playersByPosition[pos].length > 0)
    .map((pos) => ({
      pos,
      players: playersByPosition[pos].slice().sort((a, b) =>
        (a.name || '').localeCompare(b.name || '')
      ),
    }));

  const col1Sections = allSections.filter((s) => COL1_POSITIONS.includes(s.pos));
  const col2Sections = allSections.filter((s) => !COL1_POSITIONS.includes(s.pos));

  // Search results: mirror PlayerSearch sandbox behavior
  // - Empty query + has trending → show top 10 trending
  // - Non-empty query → filter all playersData by name
  const existingSet = new Set(playerIds || []);

  const getDropdownPlayers = () => {
    if (!playersData) return [];

    if (!searchQuery.trim()) {
      // Show top fantasy-point scorers for the season when search is empty
      if (!topPlayersBySeason || topPlayersBySeason.length === 0) return [];
      return topPlayersBySeason.slice(0, 15).map((player) => ({
        ...player,
        alreadyOnRoster: existingSet.has(player.player_id),
      }));
    }

    const query = searchQuery.toLowerCase();
    const results = [];
    for (const pid in playersData) {
      if (results.length >= 20) break;
      const p = playersData[pid];
      const full = (p.full_name || '').toLowerCase();
      const first = (p.first_name || '').toLowerCase();
      const last = (p.last_name || '').toLowerCase();
      if (full.includes(query) || first.includes(query) || last.includes(query)) {
        const info = getPlayerInfo(pid, playersData, playerIdMap);
        if (info) {
          results.push({ ...info, player_id: pid, alreadyOnRoster: existingSet.has(pid) });
        }
      }
    }
    return results;
  };

  const dropdownPlayers = getDropdownPlayers();
  const showTopPlayersLabel = !searchQuery.trim() && dropdownPlayers.length > 0;

  const handleAddPlayer = (player) => {
    if (player.alreadyOnRoster) return;
    onAddPlayer(player.player_id);
    setSearchQuery('');
    setShowDropdown(false);
  };

  return (
    <div className="scenario-editor-root">
      {/* Header */}
      <div className="scenario-editor-header">
        {team.avatarUrl && (
          <img
            className="standings-avatar scenario-editor-avatar"
            src={team.avatarUrl}
            alt={team.teamName}
          />
        )}
        <span className="scenario-editor-team-name">{team.teamName}</span>
        <span className="scenario-editor-player-count">{(playerIds || []).length} players</span>
      </div>

      {/* Add player search — at the top, mirrors sandbox PlayerSearch behavior */}
      <div
        className="scenario-editor-search-wrapper"
        ref={searchWrapperRef}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          className="scenario-editor-search-input"
          value={searchQuery}
          placeholder="Search to add a player…"
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
        />
        {showDropdown && dropdownPlayers.length > 0 && (
          <div className="scenario-editor-dropdown">
            {showTopPlayersLabel && (
              <div className="scenario-editor-dropdown-section-label">Top Fantasy Players</div>
            )}
            {dropdownPlayers.map((player) => (
              <div
                key={player.player_id}
                className={
                  'scenario-editor-dropdown-item' +
                  (player.alreadyOnRoster ? ' scenario-editor-dropdown-item--on-roster' : '')
                }
                onClick={() => handleAddPlayer(player)}
                onMouseEnter={(e) => {
                  if (!player.alreadyOnRoster)
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <img
                  src={getPlayerLogoUrl(player.espn_photo_url)}
                  alt={player.name}
                  className="scenario-editor-player-avatar"
                />
                <div className="scenario-editor-player-info">
                  <span className="scenario-editor-player-name">{player.name}</span>
                  <span className="scenario-editor-player-pos">
                    {player.position || ''}
                    {player.position && (player.team || player.team_abbr) ? ' · ' : ''}
                    {player.team || player.team_abbr || ''}
                  </span>
                </div>
                {player.alreadyOnRoster ? (
                  <span className="scenario-editor-on-roster-label">On roster</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Player list: two-column grid (QB/WR left, RB/TE/K/DEF right) */}
      <div className="scenario-editor-player-list">
        {allSections.length === 0 && (
          <div className="scenario-editor-empty">No players on this roster.</div>
        )}
        {allSections.length > 0 && (
          <>
            {/* Column 1: QB, WR */}
            <div className="scenario-editor-roster-col">
              {col1Sections.map(({ pos, players }) => (
                <PositionGroup
                  key={pos}
                  pos={pos}
                  players={players}
                  onRemovePlayer={onRemovePlayer}
                />
              ))}
            </div>
            {/* Column 2: RB, TE, K, DEF, Other */}
            <div className="scenario-editor-roster-col">
              {col2Sections.map(({ pos, players }) => (
                <PositionGroup
                  key={pos}
                  pos={pos}
                  players={players}
                  onRemovePlayer={onRemovePlayer}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ScenarioRosterEditor;
