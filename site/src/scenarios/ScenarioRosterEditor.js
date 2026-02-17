import React, { useState, useEffect, useRef } from 'react';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function positionSortKey(pos) {
  const idx = POSITION_ORDER.indexOf(pos);
  return idx === -1 ? POSITION_ORDER.length : idx;
}

/**
 * Editable roster panel for a single scenario team.
 * - Shows current roster players grouped by position
 * - Remove button on each player row
 * - Search bar at the bottom to add players
 */
function ScenarioRosterEditor({
  team,
  playerIds,
  playersData,
  playerIdMap,
  onRemovePlayer,
  onAddPlayer,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) {
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [showDropdown]);

  // Resolve player IDs to full info objects
  const resolvedPlayers = (playerIds || [])
    .map((pid) => {
      const info = getPlayerInfo(pid, playersData, playerIdMap);
      return info ? { ...info, player_id: pid } : { name: pid, position: '', espn_photo_url: null, player_id: pid };
    })
    .sort((a, b) => {
      const pa = positionSortKey(a.position || '');
      const pb = positionSortKey(b.position || '');
      if (pa !== pb) return pa - pb;
      return (a.name || '').localeCompare(b.name || '');
    });

  // Search: filter all players in playersData by query
  const getSearchResults = () => {
    if (!playersData || !searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const existingSet = new Set(playerIds || []);
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

  const searchResults = getSearchResults();

  const handleAddPlayer = (player) => {
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
        <span className="scenario-editor-player-count">{resolvedPlayers.length} players</span>
      </div>

      {/* Player list */}
      <div className="scenario-editor-player-list">
        {resolvedPlayers.length === 0 && (
          <div className="scenario-editor-empty">No players on this roster.</div>
        )}
        {resolvedPlayers.map((player) => (
          <div key={player.player_id} className="scenario-editor-player-row">
            <img
              src={getPlayerLogoUrl(player.espn_photo_url)}
              alt={player.name}
              className="scenario-editor-player-avatar"
            />
            <div className="scenario-editor-player-info">
              <span className="scenario-editor-player-name">{player.name}</span>
              {player.position && (
                <span className="scenario-editor-player-pos">{player.position}</span>
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

      {/* Add player search */}
      <div className="scenario-editor-search-wrapper" ref={searchRef}>
        <input
          type="text"
          className="scenario-editor-search-input"
          value={searchQuery}
          placeholder="Search to add a player…"
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => {
            if (searchQuery.trim()) setShowDropdown(true);
          }}
        />
        {showDropdown && searchResults.length > 0 && (
          <div className="scenario-editor-dropdown">
            {searchResults.map((player) => (
              <div
                key={player.player_id}
                className={
                  'scenario-editor-dropdown-item' +
                  (player.alreadyOnRoster ? ' scenario-editor-dropdown-item--on-roster' : '')
                }
                onClick={() => {
                  if (!player.alreadyOnRoster) handleAddPlayer(player);
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
                {player.alreadyOnRoster && (
                  <span className="scenario-editor-on-roster-label">On roster</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ScenarioRosterEditor;
