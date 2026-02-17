import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { fetchTransactions } from '../lookups/TransactionLookup';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { calculateDraftOrder, convertPlacementToPickNumbers } from '../utils/DraftOrderHelper';
import { PREVIOUS_YEARS } from '../utils/global_constants';
import { filterAndSortTrades, TradeItem } from '../trades/TradeComponents';

const PREVIEW_SIZE = 3;

// Previous season drives both the static players.txt lookup and the draft pick order.
const PREV_SEASON = String(Number(CURRENT_YEAR) - 1);

function RecentTradesCard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trades, setTrades] = useState([]);
  const [rosterMap, setRosterMap] = useState({});
  const [rosterIdToPickNum, setRosterIdToPickNum] = useState({});
  const [players, setPlayers] = useState(null);
  const [idMap, setIdMap] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const loadIdRef = useRef(0);

  // Body scroll lock when player modal is open
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
          // PREV_SEASON forces the static players.txt path (safe during pre-season)
          fetchPlayersData(PREV_SEASON),
          fetchPlayerIdMap(),
          fetchScoresData(PREV_SEASON),
          fetchTeamData(PREV_SEASON),
        ]);

        if (cancelled) return;

        const map =
          currentTeamData?.rosters && currentTeamData?.users
            ? buildRosterIdToTeamInfoMap(currentTeamData.rosters, currentTeamData.users)
            : {};

        // Pick-number map for "2026 1.05" formatting
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

        if (currentLoadId === loadIdRef.current && !cancelled) {
          setRosterMap(map);
          setRosterIdToPickNum(pickNumMap);
          setPlayers(playersData);
          setIdMap(playerIdMap);
          setTeamData(currentTeamData);
          setTrades(filterAndSortTrades(allTransactions));
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
    return () => { cancelled = true; };
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
  } else if (trades.length === 0) {
    body = <div className="recent-trades-status">No trades yet this off-season.</div>;
  } else {
    const preview = trades.slice(0, PREVIEW_SIZE);
    body = (
      <div className="recent-trades-list">
        {preview.map((trade) => (
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

  // Determine whether the "See all trades" link makes sense to show
  const showLink = !loading && !error;
  const prevLeagueExists = !!PREVIOUS_YEARS[PREV_SEASON];
  const hasMore = trades.length > PREVIEW_SIZE || prevLeagueExists;

  return (
    <>
      <HomeCard className="recent-trades-card">
        <div className="home-card-inner">
          <h2 className="home-card-title">🤝 Recent Trades</h2>
          <div className="home-card-body">{body}</div>
          {showLink && (
            <div className="active-playoffs-link-row">
              <Link className="active-playoffs-link" to="/trades">
                {hasMore ? 'See all trades →' : 'Trade history →'}
              </Link>
            </div>
          )}
        </div>
      </HomeCard>
      {modal && createPortal(modal, document.body)}
    </>
  );
}

export default RecentTradesCard;
