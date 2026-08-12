import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getCompletedWeeksCount } from '../utils/DateHelper';
import OfferCard from './OfferCard';
import BetCard from './BetCard';
import CreateOfferPanel from './CreateOfferPanel';

// Weekly bets are only offered on the upcoming week: the first week that
// hasn't completed yet. Before the season starts this is week 1.
function getUpcomingWeek() {
  return Math.min(17, Math.max(1, getCompletedWeeksCount() + 1));
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const TABS = [
  { id: 'market', label: 'Market' },
  { id: 'myOffers', label: 'My offers' },
  { id: 'myBets', label: 'My bets' },
  { id: 'liveBets', label: 'All live bets' },
];

/**
 * The exchange itself. Data source (test DB vs real API) is injected.
 * props:
 *   client  — exchange client (createTestClient / createRemoteClient)
 *   actor   — { id, name } the current identity
 *   teams   — [{ rosterId, teamName, ownerName }]
 *   onResetTestData — optional, shown only for the test client
 */
function FredDuelExchange({ client, actor, teams, onResetTestData }) {
  const now = useNow(1000);
  const [data, setData] = useState({ offers: [], bets: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState('market');
  const [showCreate, setShowCreate] = useState(false);
  const [highlightBetId, setHighlightBetId] = useState(null);

  // "🔥 N takers" on an offer card → jump to the live-bets tab, scroll to the
  // ticket, and flash it.
  const viewBet = useCallback((betId) => {
    setTab('liveBets');
    setHighlightBetId(betId);
  }, []);

  useEffect(() => {
    if (tab !== 'liveBets' || highlightBetId == null) return undefined;
    const el = document.getElementById(`fd-bet-${highlightBetId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlightBetId(null), 2600);
    return () => clearTimeout(t);
  }, [tab, highlightBetId]);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await client.listAll());
    } catch (e) {
      setLoadError(e.message);
    }
    setLoading(false);
  }, [client]);

  useEffect(() => {
    setLoading(true);
    refresh();
    const t = setInterval(refresh, 60 * 1000);
    return () => clearInterval(t);
  }, [refresh]);

  const betsByOfferId = useMemo(() => {
    const map = {};
    for (const bet of data.bets) {
      (map[bet.offerId] = map[bet.offerId] || []).push(bet);
    }
    return map;
  }, [data.bets]);

  const openOffers = useMemo(
    () => data.offers.filter((o) => o.status === 'open' && new Date(o.expiresAt).getTime() > now),
    [data.offers, now],
  );
  const myOffers = useMemo(
    () => data.offers.filter((o) => actor && o.creatorId === actor.id),
    [data.offers, actor],
  );
  const myBets = useMemo(
    () => data.bets.filter((b) => actor && (b.takerId === actor.id || b.creatorId === actor.id)),
    [data.bets, actor],
  );
  const liveBets = useMemo(() => data.bets.filter((b) => b.status === 'live'), [data.bets]);

  const counts = {
    market: openOffers.length,
    myOffers: myOffers.length,
    myBets: myBets.length,
    liveBets: liveBets.length,
  };

  const takeOffer = (offerId) => async (stake) => {
    await client.takeOffer(offerId, stake);
    await refresh();
  };
  const cancelOffer = (offerId) => async () => {
    await client.cancelOffer(offerId);
    await refresh();
  };
  const updateOfferExposure = (offerId) => async (newRemaining) => {
    await client.updateOfferExposure(offerId, newRemaining);
    await refresh();
  };
  const createOffer = async (input) => {
    await client.createOffer(input);
    setTab('market');
    await refresh();
  };

  const renderOffers = (offers, emptyText) => {
    if (offers.length === 0) return <div className="fd-empty">{emptyText}</div>;
    return offers.map((offer) => (
      <OfferCard
        key={offer.id}
        offer={offer}
        linkedBets={betsByOfferId[offer.id] || []}
        actor={actor}
        now={now}
        onTake={takeOffer(offer.id)}
        onCancel={cancelOffer(offer.id)}
        onUpdateExposure={updateOfferExposure(offer.id)}
        onViewBets={viewBet}
      />
    ));
  };

  const renderBets = (bets, emptyText) => {
    if (bets.length === 0) return <div className="fd-empty">{emptyText}</div>;
    return bets.map((bet) => (
      <BetCard key={bet.id} bet={bet} actor={actor} highlight={bet.id === highlightBetId} />
    ));
  };

  let body;
  if (loading) {
    body = <div className="fd-empty">Loading the exchange…</div>;
  } else if (tab === 'market') {
    body = renderOffers(openOffers, 'No open offers. Post the first one.');
  } else if (tab === 'myOffers') {
    body = renderOffers(myOffers, "You haven't posted any offers yet.");
  } else if (tab === 'myBets') {
    body = renderBets(myBets, 'No live bets yet — take an offer or get one taken.');
  } else {
    body = renderBets(liveBets, 'No live bets on the exchange yet.');
  }

  return (
    <div className="fd-exchange">
      <div className="fd-toolbar">
        <div className="fd-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`fd-tab${tab === t.id ? ' fd-tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="fd-tab-count">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <div className="fd-toolbar-actions">
          <button className="fd-btn fd-btn-ghost" onClick={refresh} title="Refresh">↻</button>
          {client.isTest && onResetTestData && (
            <button
              className="fd-btn fd-btn-ghost"
              onClick={async () => { await onResetTestData(); await refresh(); }}
            >
              Reset test data
            </button>
          )}
          <button
            className="fd-btn fd-btn-primary"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? 'Hide editor' : '+ New offer'}
          </button>
        </div>
      </div>

      {loadError && <div className="fd-error">Couldn't load the exchange: {loadError}</div>}

      {showCreate && (
        <CreateOfferPanel
          teams={teams}
          currentWeek={getUpcomingWeek()}
          onCreate={createOffer}
          onClose={() => setShowCreate(false)}
        />
      )}

      <div className="fd-list">{body}</div>
    </div>
  );
}

export default FredDuelExchange;
