import React, { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerDBData } from './usePlayerDBData';
import {
  PLAYER_DB_COLUMNS,
  DEFAULT_SORT_KEY,
  DEFAULT_SORT_DIR,
  getDefaultColumnVisibility,
} from './playerDBColumns';
import { PLAYER_DB_FILTERS, getDefaultFilterState } from './playerDBFilters';
import PlayerDBTable from './PlayerDBTable';
import PlayerDBControls from './PlayerDBControls';
import LoadingState from '../LoadingState';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import { getPlayerInfo, fetchPlayerIdMap, fetchPlayersData } from '../lookups/PlayerLookup';

const DEFAULT_LIMIT = 100;

function PlayerDBPage() {
  const { players, loading, error, rosterInfo } = usePlayerDBData();

  const [ktcFormat, setKtcFormat]             = useState('sf_tep');
  const [filterState, setFilterState]         = useState(getDefaultFilterState);
  const [sortKey, setSortKey]                 = useState(DEFAULT_SORT_KEY);
  const [sortDir, setSortDir]                 = useState(DEFAULT_SORT_DIR);
  const [limit, setLimit]                     = useState(DEFAULT_LIMIT);
  const [columnVisibility, setColumnVisibility] = useState(getDefaultColumnVisibility);
  const [selectedPlayer, setSelectedPlayer]   = useState(null);
  const [playerIdMap, setPlayerIdMap]         = useState(null);

  // Enrich players with format-resolved ktcValue / ktcRank / ktcPosRank
  const enrichedPlayers = useMemo(() =>
    players.map(p => ({
      ...p,
      ktcValue:   ktcFormat === 'sf_tep' ? p.ktcValue_tep   : p.ktcValue_sf,
      ktcRank:    ktcFormat === 'sf_tep' ? p.ktcRank_tep    : p.ktcRank_sf,
      ktcPosRank: ktcFormat === 'sf_tep' ? p.ktcPosRank_tep : p.ktcPosRank_sf,
    })),
    [players, ktcFormat]
  );

  // Apply all active filters using filter definitions
  const filteredPlayers = useMemo(() => {
    let result = enrichedPlayers;
    for (const filterDef of PLAYER_DB_FILTERS) {
      const value = filterState[filterDef.key];
      result = result.filter(p => filterDef.filterFn(p, value));
    }
    return result;
  }, [enrichedPlayers, filterState]);

  // Sort
  const sortedPlayers = useMemo(() => {
    const col = PLAYER_DB_COLUMNS.find(c => c.key === sortKey);
    if (!col?.sortFn) return filteredPlayers;
    const sorted = [...filteredPlayers].sort(col.sortFn);
    return sortDir === 'asc' ? sorted : sorted.reverse();
  }, [filteredPlayers, sortKey, sortDir]);

  // Apply limit
  const displayedPlayers = useMemo(
    () => sortedPlayers.slice(0, limit),
    [sortedPlayers, limit]
  );

  const handleFilterChange = useCallback((key, value) => {
    setFilterState(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSort = useCallback((key) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      const isAlpha = key === 'name' || key === 'position' || key === 'nflTeam' || key === 'fantasyTeamName';
      setSortKey(key);
      setSortDir(isAlpha ? 'asc' : 'desc');
    }
  }, [sortKey]);

  const handleColumnVisibilityChange = useCallback((key, visible) => {
    setColumnVisibility(prev => ({ ...prev, [key]: visible }));
  }, []);

  const handleResetColumnVisibility = useCallback(() => {
    setColumnVisibility(getDefaultColumnVisibility());
  }, []);

  const handleRowClick = useCallback(async (player) => {
    if (!player.sleeperId) return;

    let idMap = playerIdMap;
    if (!idMap) {
      try {
        idMap = await fetchPlayerIdMap();
        setPlayerIdMap(idMap);
      } catch (_) {
        idMap = {};
      }
    }

    const playersData = await fetchPlayersData(null).catch(() => null);

    if (playersData) {
      const info = getPlayerInfo(player.sleeperId, playersData, idMap);
      if (info) {
        setSelectedPlayer(info);
        return;
      }
    }

    // Fallback: synthesise a minimal info object from what we already have
    setSelectedPlayer({
      player_id: player.sleeperId,
      full_name: player.name,
      name: player.name,
      position: player.position,
      team: player.nflTeam,
      espn_photo_url: player.headshotUrl,
    });
  }, [playerIdMap]);

  const handleCloseModal = useCallback(() => setSelectedPlayer(null), []);

  React.useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setSelectedPlayer(null);
    }
    if (selectedPlayer) document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedPlayer]);

  React.useEffect(() => {
    if (selectedPlayer) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [selectedPlayer]);

  if (loading) {
    return (
      <div style={{ padding: '20px' }}>
        <LoadingState label="Building player database…" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '20px' }}>
        <div className="info-banner warning">
          <span>Error loading player data: {error}</span>
        </div>
      </div>
    );
  }

  const playerModal = selectedPlayer ? (
    <div className="player-modal-overlay" onClick={handleCloseModal}>
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        <PlayerWeeklyScores
          player={selectedPlayer}
          onClose={handleCloseModal}
          rosters={rosterInfo.rosters}
          users={rosterInfo.users}
        />
      </div>
    </div>
  ) : null;

  return (
    <div className="pdb-container">
      <div className="pdb-header">
        <h2 className="pdb-title">Player Database</h2>
        <p className="pdb-subtitle">
          All dynasty-relevant QB/RB/WR/TE — search, filter, and sort across
          every data source.
        </p>
      </div>

      <PlayerDBControls
        allPlayers={enrichedPlayers}
        filterState={filterState}
        onFilterChange={handleFilterChange}
        ktcFormat={ktcFormat}
        onKtcFormatChange={setKtcFormat}
        limit={limit}
        onLimitChange={setLimit}
        resultCount={displayedPlayers.length}
        totalCount={sortedPlayers.length}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={handleColumnVisibilityChange}
        onResetColumnVisibility={handleResetColumnVisibility}
      />

      <PlayerDBTable
        columns={PLAYER_DB_COLUMNS}
        players={displayedPlayers}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        onRowClick={handleRowClick}
        columnVisibility={columnVisibility}
      />

      {playerModal && createPortal(playerModal, document.body)}
    </div>
  );
}

export default PlayerDBPage;
