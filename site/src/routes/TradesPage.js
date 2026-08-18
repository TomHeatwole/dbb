import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import { fetchTransactions } from '../lookups/TransactionLookup';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { calculateDraftOrder, convertPlacementToPickNumbers } from '../utils/DraftOrderHelper';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { LEAGUE_ID, PREVIOUS_YEARS } from '../utils/global_constants';
import { filterAndSortTrades, TradeItem } from '../trades/TradeComponents';

const OG_TITLE = 'Trade History';
const OG_DESCRIPTION = 'Every trade in league history, organized by season.';

const ALL_YEARS = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)]
  .sort((a, b) => Number(b) - Number(a));

function getLeagueId(year) {
  if (String(year) === String(CURRENT_YEAR)) return LEAGUE_ID;
  return PREVIOUS_YEARS[String(year)] || null;
}

const PREV_SEASON = String(Number(CURRENT_YEAR) - 1);

function TradesPage() {
  // yearSections: [{ year, trades, rosterMap, teamData }] in descending year order
  const [yearSections, setYearSections] = useState([]);
  const [players, setPlayers] = useState(null);
  const [idMap, setIdMap] = useState(null);
  const [rosterIdToPickNum, setRosterIdToPickNum] = useState({});
  // teamData for the current year (used for the player modal)
  const [currentTeamData, setCurrentTeamData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  // Body scroll lock & Escape key for player modal
  useEffect(() => {
    if (selectedPlayer) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [selectedPlayer]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setSelectedPlayer(null);
    }
    if (selectedPlayer) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedPlayer]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [playersData, playerIdMap, prevWeeksData, prevTeamData, ...yearResults] =
          await Promise.all([
            fetchPlayersData(PREV_SEASON),
            fetchPlayerIdMap(),
            fetchScoresData(PREV_SEASON).catch(() => null),
            fetchTeamData(PREV_SEASON).catch(() => null),
            // One entry per year: fetch transactions + team data in parallel
            ...ALL_YEARS.map(async (year) => {
              const leagueId = getLeagueId(year);
              if (!leagueId) return { year, trades: [], rosterMap: {}, teamData: null };
              try {
                const [transactions, teamData] = await Promise.all([
                  fetchTransactions(1, leagueId),
                  fetchTeamData(year),
                ]);
                const trades = filterAndSortTrades(transactions);
                const rosterMap =
                  teamData?.rosters && teamData?.users
                    ? buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users)
                    : {};
                return { year, trades, rosterMap, teamData };
              } catch (_) {
                return { year, trades: [], rosterMap: {}, teamData: null };
              }
            }),
          ]);

        if (cancelled) return;

        setPlayers(playersData);
        setIdMap(playerIdMap);

        // Compute "1.05" pick numbers for current draft year
        try {
          const placeToRosterId = calculateDraftOrder(
            PREV_SEASON,
            prevWeeksData,
            prevTeamData,
            playersData,
            playerIdMap
          );
          setRosterIdToPickNum(convertPlacementToPickNumbers(placeToRosterId));
        } catch (_) {
          // Non-fatal — generic "R1" format used as fallback
        }

        // Expose current-year teamData for the player modal
        const currentResult = yearResults.find(
          (r) => String(r.year) === String(CURRENT_YEAR)
        );
        if (currentResult?.teamData) {
          setCurrentTeamData(currentResult.teamData);
        }

        // Only include years that have at least one trade
        setYearSections(yearResults.filter((r) => r.trades.length > 0));
      } catch (_) {
        if (!cancelled) setError('Failed to load trade history.');
      } finally {
        if (!cancelled) setLoading(false);
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
          rosters={currentTeamData?.rosters || []}
          users={currentTeamData?.users || []}
        />
      </div>
    </div>
  ) : null;

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper title="Trade History" subtitle={null}>
        {loading && <LoadingState label="Loading trade history…" />}

        {!loading && error && (
          <div className="trades-page-error">{error}</div>
        )}

        {!loading && !error && yearSections.length === 0 && (
          <div className="trades-page-empty">No trades recorded yet.</div>
        )}

        {!loading && !error && yearSections.length > 0 && (
          <div className="trades-page-root">
            {yearSections.map(({ year, trades, rosterMap }) => (
              <section key={year} className="trades-page-year-section">
                <h2 className="trades-page-year-heading">{year} Season</h2>
                <div className="trades-page-count">
                  {trades.length} trade{trades.length !== 1 ? 's' : ''}
                </div>
                <div className="recent-trades-list trades-page-list">
                  {trades.map((trade) => (
                    <TradeItem
                      key={trade.transaction_id}
                      trade={trade}
                      rosterMap={rosterMap}
                      rosterIdToPickNum={
                        String(year) === String(CURRENT_YEAR) ? rosterIdToPickNum : {}
                      }
                      players={players}
                      idMap={idMap}
                      onPlayerClick={setSelectedPlayer}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </InfoPageWrapper>
      {modal && createPortal(modal, document.body)}
    </>
  );
}

export default TradesPage;
