import React, { useEffect, useState, useMemo } from 'react';
import { fetchTeamData } from '../lookups/TeamLookup';
import { getPlayerInfo, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { batchConvertSleeperToGsis } from '../lookups/GsisLookup';
import { fetchKtcData, getKtcEntryByName, formatKtcValue, KTC_FORMAT_LABELS } from '../lookups/KtcLookup';
import LoadingState from '../LoadingState';
import PlayerWeeklyScores from './PlayerWeeklyScores';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import useIsMobile from '../hooks/useIsMobile';

const KTC_FORMATS = ['sf', 'sf_tep'];

// Parse CSV line handling quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

function HottestFreeAgents() {
  const [freeAgents, setFreeAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [ktcMap, setKtcMap] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [sortBy, setSortBy] = useState('total'); // 'total' | 'perGame' | 'ktc'
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [limit, setLimit] = useState(25);
  const [ktcFormat, setKtcFormat] = useState('sf_tep');
  
  const isMobile = useIsMobile();

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        // Load all required data in parallel
        const [teamData, csvResponse, players, idMap, ktcResult] = await Promise.all([
          fetchTeamData(CURRENT_YEAR),
          fetch('/data/stats_player_reg_2025.csv'),
          fetch('/data/players.txt').then(res => res.json()),
          fetchPlayerIdMap(),
          fetchKtcData().catch(() => null),
        ]);

        if (!csvResponse.ok) {
          throw new Error('Failed to load 2025 player stats');
        }

        const csvText = await csvResponse.text();
        const lines = csvText.trim().split('\n');
        
        if (lines.length < 2) {
          throw new Error('CSV file is empty or invalid');
        }

        // Parse CSV header
        const headers = parseCSVLine(lines[0]);
        const playerIdIndex = headers.indexOf('player_id');
        const playerNameIndex = headers.indexOf('player_display_name');
        const positionIndex = headers.indexOf('position');
        const teamIndex = headers.indexOf('recent_team');
        const gamesIndex = headers.indexOf('games');
        const fantasyPointsIndex = headers.indexOf('fantasy_points_ppr');
        const headshotIndex = headers.indexOf('headshot_url');

        // Step 1: Build set of all rostered Sleeper player IDs
        const rosteredSleeperIds = new Set();
        teamData.rosters.forEach(roster => {
          if (Array.isArray(roster.players)) {
            roster.players.forEach(pid => rosteredSleeperIds.add(pid));
          }
        });

        // Step 2: Convert rostered Sleeper IDs to GSIS IDs
        const sleeperToGsisMap = await batchConvertSleeperToGsis(
          Array.from(rosteredSleeperIds),
          players
        );

        // Step 3: Build set of rostered GSIS IDs
        const rosteredGsisIds = new Set(Object.values(sleeperToGsisMap));

        // Step 4: Parse CSV and filter to only free agents
        const allPlayers = [];
        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          
          const gsisId = values[playerIdIndex]?.trim(); // GSIS ID from CSV
          const playerName = values[playerNameIndex]?.trim() || '';
          const games = parseInt(values[gamesIndex]) || 0;
          const fantasyPoints = parseFloat(values[fantasyPointsIndex]) || 0;
          
          // Skip players with no games or no fantasy points
          if (!gsisId || games === 0 || fantasyPoints === 0) {
            continue;
          }

          // Check if player is owned by checking if their GSIS ID is in the rostered set
          const isOwned = rosteredGsisIds.has(gsisId);

          // Only include free agents
          if (!isOwned) {
            // Find Sleeper ID for this GSIS ID (for player modal)
            const sleeperPlayerId = Object.keys(sleeperToGsisMap).find(
              sid => sleeperToGsisMap[sid] === gsisId
            );

            allPlayers.push({
              playerId: sleeperPlayerId || gsisId, // Use Sleeper ID if available, fallback to GSIS ID
              playerName: playerName,
              position: values[positionIndex]?.trim() || '',
              team: values[teamIndex]?.trim() || '',
              games,
              fantasyPoints,
              fantasyPointsPerGame: Math.round((fantasyPoints / games) * 100) / 100,
              headshotUrl: values[headshotIndex]?.trim() || null
            });
          }
        }

        setFreeAgents(allPlayers);
        setRosters(teamData.rosters);
        setUsers(teamData.users);
        setPlayersData(players);
        setPlayerIdMap(idMap);
        setKtcMap(ktcResult ? ktcResult.map : null);
      } catch (err) {
        setError(err.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // Attach KTC values to each agent
  const agentsWithKtc = useMemo(() => {
    return freeAgents.map((agent) => {
      const entry = ktcMap ? getKtcEntryByName(agent.playerName, ktcMap, ktcFormat) : null;
      return { ...agent, ktcValue: entry ? entry.ktcValue : null };
    });
  }, [freeAgents, ktcMap, ktcFormat]);

  // Filter and sort free agents
  const displayedAgents = useMemo(() => {
    let filtered = agentsWithKtc;

    if (positionFilter !== 'ALL') {
      filtered = filtered.filter(agent => agent.position === positionFilter);
    }

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'perGame') return b.fantasyPointsPerGame - a.fantasyPointsPerGame;
      if (sortBy === 'ktc') {
        const av = a.ktcValue ?? -1;
        const bv = b.ktcValue ?? -1;
        return bv !== av ? bv - av : b.fantasyPoints - a.fantasyPoints;
      }
      return b.fantasyPoints - a.fantasyPoints;
    });

    return sorted.slice(0, limit);
  }, [agentsWithKtc, positionFilter, sortBy, limit]);

  const handlePlayerClick = (agent) => {
    // Get full player info for the modal
    const playerInfo = getPlayerInfo(agent.playerId, playersData, playerIdMap);
    if (playerInfo) {
      setSelectedPlayer(playerInfo);
    }
  };

  const handleCloseModal = () => {
    setSelectedPlayer(null);
  };

  if (loading) {
    return (
      <div style={{ padding: '20px' }}>
        <LoadingState label="Loading free agents data…" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '20px' }}>
        <div className="info-banner warning">
          <span>Error: {error}</span>
        </div>
      </div>
    );
  }

  const positions = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];

  return (
    <div className="hottest-free-agents-container">
      <div className="hottest-free-agents-header">
        <h2 style={{ marginBottom: '1rem' }}>🔥 Hottest Free Agents</h2>
        <p style={{ color: '#999', marginBottom: '1.5rem', fontSize: '0.9em' }}>
          Top scoring players in 2025 who are currently available
        </p>

        {/* KTC format toggle */}
        {ktcMap && (
          <div className="dynasty-format-toggle" style={{ marginBottom: '1rem' }}>
            {KTC_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                className={'dynasty-format-btn' + (ktcFormat === f ? ' dynasty-format-btn--active' : '')}
                onClick={() => setKtcFormat(f)}
              >
                {KTC_FORMAT_LABELS[f]}
              </button>
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="free-agents-controls">
          <div className="control-group">
            <label>Sort By:</label>
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value)}
              className="control-select"
            >
              <option value="total">Total Points</option>
              <option value="perGame">Points Per Game</option>
              {ktcMap && <option value="ktc">KTC Value</option>}
            </select>
          </div>

          <div className="control-group">
            <label>Position:</label>
            <select 
              value={positionFilter} 
              onChange={(e) => setPositionFilter(e.target.value)}
              className="control-select"
            >
              {positions.map(pos => (
                <option key={pos} value={pos}>{pos}</option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label>Show:</label>
            <select 
              value={limit} 
              onChange={(e) => setLimit(parseInt(e.target.value))}
              className="control-select"
            >
              <option value="10">Top 10</option>
              <option value="25">Top 25</option>
              <option value="50">Top 50</option>
              <option value="100">Top 100</option>
            </select>
          </div>
        </div>
      </div>

      {displayedAgents.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
          No free agents found with the selected filters.
        </div>
      ) : (
        <div className="free-agents-table-container">
          <table className="free-agents-table">
            <thead>
              <tr>
                <th className="rank-col">#</th>
                <th className="player-col">Player</th>
                {!isMobile && <th className="position-col">Pos</th>}
                {!isMobile && <th className="team-col">Team</th>}
                <th className="games-col">GP</th>
                <th className="points-col">Total Pts</th>
                <th className="ppg-col">PPG</th>
                {ktcMap && <th className="fa-ktc-col">KTC</th>}
                {!isMobile && <th className="status-col">Status</th>}
              </tr>
            </thead>
            <tbody>
              {displayedAgents.map((agent, index) => (
                <tr 
                  key={agent.playerId} 
                  className="free-agent-row"
                  onClick={() => handlePlayerClick(agent)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="rank-col">{index + 1}</td>
                  <td className="player-col">
                    <div className="player-cell">
                      <img 
                        src={getPlayerLogoUrl(agent.headshotUrl)} 
                        alt={agent.playerName}
                        className="player-headshot"
                      />
                      <div className="player-info">
                        <div className="player-name">{agent.playerName}</div>
                        {isMobile && (
                          <div className="player-meta-mobile">
                            {agent.position} • {agent.team || 'FA'}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  {!isMobile && <td className="position-col">{agent.position}</td>}
                  {!isMobile && <td className="team-col">{agent.team || '—'}</td>}
                  <td className="games-col">{agent.games}</td>
                  <td className="points-col">{agent.fantasyPoints.toFixed(2)}</td>
                  <td className="ppg-col">{agent.fantasyPointsPerGame.toFixed(2)}</td>
                  {ktcMap && (
                    <td className="fa-ktc-col">
                      <span className={agent.ktcValue ? 'dynasty-ktc-value' : 'dynasty-ktc-none'}>
                        {formatKtcValue(agent.ktcValue)}
                      </span>
                    </td>
                  )}
                  {!isMobile && (
                    <td className="status-col">
                      <span className="status-badge status-free-agent">Free Agent</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedPlayer && (
        <PlayerWeeklyScores
          player={selectedPlayer}
          onClose={handleCloseModal}
          rosters={rosters}
          users={users}
        />
      )}
    </div>
  );
}

export default HottestFreeAgents;
