import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { fetchTransactions, buildTradeSides } from '../lookups/TransactionLookup';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { calculateDraftOrder, convertPlacementToPickNumbers } from '../utils/DraftOrderHelper';

const MAX_TRADES_SHOWN = 3;

// Previous season provides the standing order for the upcoming draft (2025 → 2026 draft).
// Also used to force fetchPlayersData onto the static players.txt path (safe during pre-season).
const PREV_SEASON = String(Number(CURRENT_YEAR) - 1);

function formatTradeDate(ts) {
  if (!ts) return '';
  return new Date(Number(ts)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Format a pick as "2026 1.05" when pick-number data is available,
// or fall back to "2026 R1" style for future / unknown picks.
function formatPickLabel(pick, rosterIdToPickNum) {
  const season = pick.season ? String(pick.season) : '?';
  const round = pick.round != null ? Number(pick.round) : null;

  if (season === CURRENT_YEAR && round != null && pick.roster_id != null) {
    const pickNum = rosterIdToPickNum[String(pick.roster_id)];
    if (Number.isFinite(pickNum)) {
      return `${season} ${round}.${String(pickNum).padStart(2, '0')}`;
    }
  }

  if (round != null) return `${season} R${round}`;
  return `${season} Pick`;
}

// One side (team) of a trade — shows what they received.
function TeamSide({ rosterId, teamInfo, side, rosterIdToPickNum, players, idMap, onPlayerClick }) {
  const name = teamInfo?.teamName || `Team ${rosterId}`;
  const avatarUrl =
    teamInfo?.user?.team_avatar_url ||
    teamInfo?.user?.user_avatar_url ||
    teamInfo?.user?.avatar_url ||
    null;

  // Build ordered list of received assets
  const assets = [];

  for (const playerId of (side?.playerIds || [])) {
    const info = getPlayerInfo(playerId, players, idMap);
    const playerName = info?.name || `Player ${playerId}`;
    const photo = info?.espn_photo_url || null;
    const pos = info?.position || '';
    const team = info?.team || info?.team_abbr || '';
    const meta = [pos, team].filter(Boolean).join(' · ');
    assets.push({ type: 'player', key: `p-${playerId}`, label: playerName, meta, photo, fullInfo: info });
  }

  for (let i = 0; i < (side?.picks || []).length; i++) {
    const label = formatPickLabel(side.picks[i], rosterIdToPickNum);
    assets.push({ type: 'pick', key: `pick-${i}`, label });
  }

  if (side?.faab > 0) {
    assets.push({ type: 'faab', key: 'faab', label: `+$${side.faab} FAAB` });
  }

  return (
    <div className="recent-trades-side">
      {/* Team name links to their team page in a new tab */}
      <Link
        className="recent-trades-team-header"
        to={`/team/${rosterId}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {avatarUrl ? (
          <img className="recent-trades-team-avatar" src={avatarUrl} alt="" />
        ) : (
          <div className="recent-trades-team-avatar recent-trades-team-avatar--placeholder" />
        )}
        <span className="recent-trades-team-name">{name}</span>
      </Link>

      {assets.length > 0 && (
        <>
          <div className="recent-trades-receives-label">Receives:</div>
          <div className="recent-trades-assets">
            {assets.map((asset) => {
              if (asset.type === 'player') {
                return (
                  <button
                    key={asset.key}
                    type="button"
                    className="recent-trades-asset recent-trades-asset--player"
                    onClick={() => onPlayerClick(asset.fullInfo)}
                  >
                    <img
                      className="recent-trades-player-photo"
                      src={getPlayerLogoUrl(asset.photo)}
                      alt=""
                    />
                    <div className="recent-trades-asset-text">
                      <span className="recent-trades-asset-name">{asset.label}</span>
                      {asset.meta && (
                        <span className="recent-trades-asset-meta">{asset.meta}</span>
                      )}
                    </div>
                  </button>
                );
              }
              // Picks and FAAB — not clickable
              return (
                <div key={asset.key} className="recent-trades-asset">
                  <div className="recent-trades-asset-text">
                    <span className="recent-trades-asset-name">{asset.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {assets.length === 0 && (
        <div className="recent-trades-assets">
          <div className="recent-trades-asset">
            <span className="recent-trades-none">—</span>
          </div>
        </div>
      )}
    </div>
  );
}

function TradeItem({ trade, rosterMap, rosterIdToPickNum, players, idMap, onPlayerClick }) {
  const sides = buildTradeSides(trade);
  const rosterIds = Object.keys(sides).map(Number).sort((a, b) => a - b);
  if (rosterIds.length < 2) return null;

  const [leftId, rightId] = rosterIds;
  const leftInfo = rosterMap[leftId] || rosterMap[String(leftId)] || null;
  const rightInfo = rosterMap[rightId] || rosterMap[String(rightId)] || null;

  return (
    <div className="recent-trades-item">
      <div className="recent-trades-date">{formatTradeDate(trade.created)}</div>
      <div className="recent-trades-body">
        <TeamSide
          rosterId={leftId}
          teamInfo={leftInfo}
          side={sides[leftId]}
          rosterIdToPickNum={rosterIdToPickNum}
          players={players}
          idMap={idMap}
          onPlayerClick={onPlayerClick}
        />
        <div className="recent-trades-divider" aria-hidden="true">⇄</div>
        <TeamSide
          rosterId={rightId}
          teamInfo={rightInfo}
          side={sides[rightId]}
          rosterIdToPickNum={rosterIdToPickNum}
          players={players}
          idMap={idMap}
          onPlayerClick={onPlayerClick}
        />
      </div>
    </div>
  );
}

function RecentTradesCard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trades, setTrades] = useState(null);
  const [rosterMap, setRosterMap] = useState({});
  const [rosterIdToPickNum, setRosterIdToPickNum] = useState({});
  const [players, setPlayers] = useState(null);
  const [idMap, setIdMap] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const loadIdRef = useRef(0);

  // Lock body scroll when player modal is open
  useEffect(() => {
    if (selectedPlayer) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [selectedPlayer]);

  // Escape key closes the modal
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setSelectedPlayer(null);
    }
    if (selectedPlayer) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedPlayer]);

  useEffect(() => {
    loadIdRef.current += 1;
    const currentLoadId = loadIdRef.current;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [
          allTransactions,
          currentTeamData,
          playersData,
          playerIdMap,
          prevWeeksData,
          prevTeamData,
        ] = await Promise.all([
          fetchTransactions(1),
          fetchTeamData(CURRENT_YEAR),
          // Pass PREV_SEASON so fetchPlayersData always uses the static players.txt
          // file rather than an empty pre-season snapshot.
          fetchPlayersData(PREV_SEASON),
          fetchPlayerIdMap(),
          fetchScoresData(PREV_SEASON),
          fetchTeamData(PREV_SEASON),
        ]);

        if (cancelled) return;

        // Team names / avatars from the current (2026) league
        const map =
          currentTeamData?.rosters && currentTeamData?.users
            ? buildRosterIdToTeamInfoMap(currentTeamData.rosters, currentTeamData.users)
            : {};

        // Pick-number map: rosterId → draft slot (1-10) for the upcoming draft.
        // Enables "2026 1.05" formatting instead of generic "2026 R1".
        let pickNumMap = {};
        try {
          const placeToRosterId = calculateDraftOrder(
            PREV_SEASON,
            prevWeeksData,
            prevTeamData,
            playersData,
            playerIdMap
          );
          pickNumMap = convertPlacementToPickNumbers(placeToRosterId);
        } catch (_) {
          // Non-fatal: generic round format used as fallback
        }

        const tradeList = Array.isArray(allTransactions)
          ? allTransactions
              .filter((t) => t && t.type === 'trade' && t.status === 'complete')
              .sort((a, b) => (b.created || 0) - (a.created || 0))
              .slice(0, MAX_TRADES_SHOWN)
          : [];

        if (currentLoadId === loadIdRef.current && !cancelled) {
          setRosterMap(map);
          setRosterIdToPickNum(pickNumMap);
          setPlayers(playersData);
          setIdMap(playerIdMap);
          setTeamData(currentTeamData);
          setTrades(tradeList);
        }
      } catch (_) {
        if (!cancelled && currentLoadId === loadIdRef.current) {
          setError('Unable to load trades right now.');
        }
      } finally {
        if (!cancelled && currentLoadId === loadIdRef.current) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const modal = selectedPlayer ? (
    <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <PlayerWeeklyScores
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          rosters={teamData?.rosters || []}
          users={teamData?.users || []}
        />
      </div>
    </div>
  ) : null;

  let body;
  if (loading) {
    body = <LoadingState label="Loading trades…" ariaLabel="Loading recent trades" />;
  } else if (error) {
    body = <div className="recent-trades-status recent-trades-status--error">{error}</div>;
  } else if (!trades || trades.length === 0) {
    body = <div className="recent-trades-status">No trades yet this off-season.</div>;
  } else {
    body = (
      <div className="recent-trades-list">
        {trades.map((trade) => (
          <TradeItem
            key={trade.transaction_id}
            trade={trade}
            rosterMap={rosterMap}
            rosterIdToPickNum={rosterIdToPickNum}
            players={players}
            idMap={idMap}
            onPlayerClick={setSelectedPlayer}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <HomeCard className="recent-trades-card">
        <div className="home-card-inner">
          <h2 className="home-card-title">🤝 Recent Trades</h2>
          <div className="home-card-body">{body}</div>
        </div>
      </HomeCard>
      {modal && createPortal(modal, document.body)}
    </>
  );
}

export default RecentTradesCard;
