import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import PositionBadge from '../PositionBadge';

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const ADDABLE_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

// Left column: QB and WR; right column: everything else
const COL1_POSITIONS = ['QB', 'WR'];
const COL2_POSITIONS = ['RB', 'TE', 'K', 'DEF']; // eslint-disable-line no-unused-vars

/** Renders a single position group (label + player rows) */
function PositionGroup({ pos, players, onRemovePlayer, onPlayerClick }) {
  return (
    <div className="scenario-editor-position-group">
      <div className="scenario-editor-position-label"><PositionBadge position={pos} /></div>
      {players.map((player) => (
        <div
          key={player.player_id}
          className="scenario-editor-player-row player-clickable"
          onClick={() => onPlayerClick && onPlayerClick(player)}
        >
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
            onClick={(e) => { e.stopPropagation(); onRemovePlayer(player.player_id); }}
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
  const [selectedPlayer, setSelectedPlayer] = useState(null);
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
      return topPlayersBySeason
        .filter((player) => ADDABLE_POSITIONS.includes(player.position))
        .slice(0, 15)
        .map((player) => ({
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
        if (info && ADDABLE_POSITIONS.includes(info.position)) {
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

  const handleDropFromDropdown = (e, player) => {
    e.stopPropagation();
    onRemovePlayer(player.player_id);
    setSearchQuery('');
    setShowDropdown(false);
  };

  // Format final-standings badge for the header
  const placeStr = team.place
    ? `${team.place}${team.place === 1 ? 'st' : team.place === 2 ? 'nd' : team.place === 3 ? 'rd' : 'th'}`
    : null;
  const ptsStr = team.totalPoints != null ? `${team.totalPoints.toFixed(1)} pts` : null;
  const standingsBadge = [placeStr, ptsStr].filter(Boolean).join(' · ');

  return (
    <div className="scenario-editor-root">
      {/* Header: avatar · team name · season place + points · player count */}
      <div className="scenario-editor-header">
        {team.avatarUrl && (
          <img
            className="standings-avatar scenario-editor-avatar"
            src={team.avatarUrl}
            alt={team.teamName}
          />
        )}
        <div className="scenario-editor-header-meta">
          <span className="scenario-editor-team-name">{team.teamName}</span>
          {standingsBadge && (
            <span className="scenario-editor-standings-badge">{standingsBadge}</span>
          )}
        </div>
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
              >
                <img
                  src={getPlayerLogoUrl(player.espn_photo_url)}
                  alt={player.name}
                  className="scenario-editor-player-avatar"
                />
                <div className="scenario-editor-player-info">
                  <span className="scenario-editor-player-name">{player.name}</span>
                  <span className="scenario-editor-player-pos" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <PositionBadge position={player.position} />
                    {(player.team || player.team_abbr) && <span>{player.team || player.team_abbr}</span>}
                  </span>
                </div>
                {player.alreadyOnRoster ? (
                  <button
                    type="button"
                    className="scenario-editor-dropdown-drop-btn"
                    onClick={(e) => handleDropFromDropdown(e, player)}
                  >
                    Drop
                  </button>
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
                  onPlayerClick={setSelectedPlayer}
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
                  onPlayerClick={setSelectedPlayer}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {selectedPlayer && createPortal(
        <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
          <div className="player-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <PlayerWeeklyScores
              player={selectedPlayer}
              onClose={() => setSelectedPlayer(null)}
              ownershipOverride={team && team.teamName ? { teamName: team.teamName, avatar: team.avatarUrl || null } : null}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default ScenarioRosterEditor;
