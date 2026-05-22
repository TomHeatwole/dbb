import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { fetchTeamData } from '../lookups/TeamLookup';
import { getPlayerInfo, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { batchConvertSleeperToGsis } from '../lookups/GsisLookup';
import { fetchKtcData, getKtcEntryByName, formatKtcValue, KTC_FORMAT_LABELS } from '../lookups/KtcLookup';
import { fetchFantasyCalcData, getFantasyCalcEntry, formatFcValue } from '../lookups/FantasyCalcLookup';
import { fetchFfbData, getFfbEntry, formatFfbRank } from '../lookups/FfbLookup';
import { normalisePlayerName } from '../utils/playerNameMatcher';
import LoadingState from '../LoadingState';
import PlayerWeeklyScores from './PlayerWeeklyScores';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import useIsMobile from '../hooks/useIsMobile';
import PositionBadge from '../PositionBadge';

const KTC_FORMATS = ['sf', 'sf_tep'];

// Dynasty value sort options
const DYNASTY_SORT_OPTIONS = [
  { value: 'ktc',          label: 'KTC Value'       },
  { value: 'fantasycalc',  label: 'FantasyCalc'     },
  { value: 'ffb',          label: 'FFB Rank'        },
];

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
  const [fcData, setFcData] = useState(null);   // { bySleeperId, byName }
  const [ffbData, setFfbData] = useState(null); // { bySleeperId, byName }
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [sortBy, setSortBy] = useState('total'); // 'total' | 'perGame' | 'ktc' | 'fantasycalc' | 'ffb'
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
        const [teamData, csvResponse, players, idMap, ktcResult, fcResult, ffbResult] = await Promise.all([
          fetchTeamData(CURRENT_YEAR),
          fetch('/data/stats_player_reg_2025.csv'),
          fetch('/data/players.txt').then(res => res.json()),
          fetchPlayerIdMap(),
          fetchKtcData().catch(() => null),
          fetchFantasyCalcData().catch(() => null),
          fetchFfbData().catch(() => null),
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
              playerId: sleeperPlayerId || gsisId,
              sleeperId: sleeperPlayerId || null,
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

        // Step 5: Inject KTC-only players (prospects/rookies not yet in stats DB)
        // Build a set of normalised names already covered by the stats list
        const statsNormNames = new Set(allPlayers.map(p => normalisePlayerName(p.playerName)));

        // Build a set of normalised names for all rostered players (by Sleeper name)
        const rosteredNormNames = new Set();
        teamData.rosters.forEach(roster => {
          if (Array.isArray(roster.players)) {
            roster.players.forEach(pid => {
              const p = players[pid];
              if (p && p.full_name) rosteredNormNames.add(normalisePlayerName(p.full_name));
            });
          }
        });

        if (ktcResult && ktcResult.map) {
          for (const [normName, entry] of ktcResult.map) {
            if (!statsNormNames.has(normName) && !rosteredNormNames.has(normName)) {
              allPlayers.push({
                playerId: null,
                sleeperId: null,
                playerName: entry.name,
                position: entry.position,
                team: entry.nflTeam || '',
                games: 0,
                fantasyPoints: 0,
                fantasyPointsPerGame: 0,
                headshotUrl: null,
                ktcOnly: true,
              });
            }
          }
        }

        setFreeAgents(allPlayers);
        setRosters(teamData.rosters);
        setUsers(teamData.users);
        setPlayersData(players);
        setPlayerIdMap(idMap);
        setKtcMap(ktcResult ? ktcResult.map : null);
        setFcData(fcResult || null);
        setFfbData(ffbResult || null);
      } catch (err) {
        setError(err.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // Attach KTC, FantasyCalc, and FFB values to each agent
  const agentsWithValues = useMemo(() => {
    return freeAgents.map((agent) => {
      const hints = { position: agent.position, team: agent.team };

      const ktcEntry = ktcMap
        ? getKtcEntryByName(agent.playerName, ktcMap, ktcFormat, hints)
        : null;

      const fcEntry = fcData
        ? getFantasyCalcEntry(agent.sleeperId, agent.playerName, fcData.bySleeperId, fcData.byName, hints)
        : null;

      const ffbEntry = ffbData
        ? getFfbEntry(agent.sleeperId, agent.playerName, ffbData.bySleeperId, ffbData.byName)
        : null;

      return {
        ...agent,
        ktcValue:  ktcEntry ? ktcEntry.ktcValue : null,
        fcValue:   fcEntry  ? fcEntry.value     : null,
        ffbRank:   ffbEntry ? ffbEntry.rank      : null,
      };
    });
  }, [freeAgents, ktcMap, ktcFormat, fcData, ffbData]);

  // Filter and sort free agents
  const displayedAgents = useMemo(() => {
    let filtered = agentsWithValues;

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
      if (sortBy === 'fantasycalc') {
        const av = a.fcValue ?? -1;
        const bv = b.fcValue ?? -1;
        return bv !== av ? bv - av : b.fantasyPoints - a.fantasyPoints;
      }
      if (sortBy === 'ffb') {
        // Lower rank = better; unranked players go to bottom
        const av = a.ffbRank ?? 99999;
        const bv = b.ffbRank ?? 99999;
        return av !== bv ? av - bv : b.fantasyPoints - a.fantasyPoints;
      }
      return b.fantasyPoints - a.fantasyPoints;
    });

    return sorted.slice(0, limit);
  }, [agentsWithValues, positionFilter, sortBy, limit]);

  const handlePlayerClick = (agent) => {
    // Try direct lookup first (works when agent.playerId is a Sleeper ID)
    if (agent.playerId && playersData) {
      const playerInfo = getPlayerInfo(agent.playerId, playersData, playerIdMap);
      if (playerInfo) {
        setSelectedPlayer(playerInfo);
        return;
      }
    }

    // Fallback: free agents have a GSIS ID as playerId, so search by name
    if (playersData && agent.playerName) {
      const nameLower = agent.playerName.toLowerCase();
      const sleeperId = Object.keys(playersData).find((id) => {
        const p = playersData[id];
        return (p.full_name || '').toLowerCase() === nameLower;
      });
      if (sleeperId) {
        const playerInfo = getPlayerInfo(sleeperId, playersData, playerIdMap);
        if (playerInfo) {
          setSelectedPlayer(playerInfo);
        }
      }
    }
  };

  const handleCloseModal = () => {
    setSelectedPlayer(null);
  };

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setSelectedPlayer(null);
    }
    if (selectedPlayer) {
      document.addEventListener('keydown', onKeyDown);
    }
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedPlayer]);

  useEffect(() => {
    if (selectedPlayer) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [selectedPlayer]);

  const playerModal = selectedPlayer ? (
    <div className="player-modal-overlay" onClick={handleCloseModal}>
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <PlayerWeeklyScores
          player={selectedPlayer}
          onClose={handleCloseModal}
          rosters={rosters}
          users={users}
        />
      </div>
    </div>
  ) : null;

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

        {/* KTC SF / SF TE+ sub-toggle – only shown when sorting by KTC */}
        {ktcMap && sortBy === 'ktc' && (
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
              {DYNASTY_SORT_OPTIONS.map(({ value, label }) => (
                (value === 'ktc' ? ktcMap : value === 'fantasycalc' ? fcData : ffbData)
                  ? <option key={value} value={value}>{label}</option>
                  : null
              ))}
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
              <option value="200">Top 200</option>
              <option value="500">Top 500</option>
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
                {!isMobile && fcData && <th className="fa-ktc-col">FC</th>}
                {!isMobile && ffbData && <th className="fa-ktc-col">FFB</th>}
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
                          <div className="player-meta-mobile" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <PositionBadge position={agent.position} /> {agent.team || 'FA'}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  {!isMobile && <td className="position-col"><PositionBadge position={agent.position} /></td>}
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
                  {!isMobile && fcData && (
                    <td className="fa-ktc-col">
                      <span className={agent.fcValue ? 'dynasty-ktc-value' : 'dynasty-ktc-none'}>
                        {formatFcValue(agent.fcValue)}
                      </span>
                    </td>
                  )}
                  {!isMobile && ffbData && (
                    <td className="fa-ktc-col">
                      <span className={agent.ffbRank ? 'dynasty-ktc-value' : 'dynasty-ktc-none'}>
                        {formatFfbRank(agent.ffbRank)}
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

      {playerModal && createPortal(playerModal, document.body)}
    </div>
  );
}

export default HottestFreeAgents;
