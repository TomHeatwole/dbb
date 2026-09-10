import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCompletedWeeksCount } from '../utils/DateHelper';
import { involvesRosterId, primaryTeamName } from './markets';
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

const SORT_NEWEST = 'newest';
const SORT_TEAM_AZ = 'team-az';
const SORT_TEAM_ZA = 'team-za';

function offerSearchText(offer) {
  if (!offer) return '';
  return `${offer.title || ''} ${offer.description || ''}`;
}

function betSearchText(bet, offer) {
  return `${offerSearchText(offer)} ${bet?.offerTitle || ''}`;
}

function itemInvolvesAnyTeam(market, text, filterIds, teams) {
  if (!filterIds.length) return true;
  return filterIds.some((rid) => involvesRosterId(market, text, rid, teams));
}

function compareNewest(a, b) {
  return new Date(b.createdAt) - new Date(a.createdAt);
}

function compareByTeam(aMarket, bMarket, teams, dir, a, b) {
  const aName = primaryTeamName(aMarket, teams);
  const bName = primaryTeamName(bMarket, teams);
  if (!aName && !bName) return compareNewest(a, b);
  if (!aName) return 1;
  if (!bName) return -1;
  const cmp = aName.localeCompare(bName, undefined, { sensitivity: 'base' });
  if (cmp !== 0) return dir === SORT_TEAM_ZA ? -cmp : cmp;
  return compareNewest(a, b);
}

function emptyForFilter(noun, filterIds, teams) {
  const names = teams
    .filter((t) => filterIds.includes(Number(t.rosterId)))
    .map((t) => t.teamName);
  if (names.length === 1) return `No ${noun} involving ${names[0]}.`;
  if (names.length === 2) return `No ${noun} involving ${names[0]} or ${names[1]}.`;
  return `No ${noun} involving the selected teams.`;
}

function filterTriggerLabel(filterIds, teams) {
  if (!filterIds.length) return 'All teams';
  if (filterIds.length === 1) {
    const team = teams.find((t) => Number(t.rosterId) === filterIds[0]);
    return team?.teamName || '1 team';
  }
  return `${filterIds.length} teams`;
}

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
  const [filterIds, setFilterIds] = useState([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState(SORT_NEWEST);
  const filterRef = useRef(null);

  const teamsByName = useMemo(
    () => [...teams].sort((a, b) => a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' })),
    [teams],
  );

  const toggleFilterTeam = (rosterId) => {
    const rid = Number(rosterId);
    setFilterIds((prev) => (
      prev.includes(rid) ? prev.filter((id) => id !== rid) : [...prev, rid]
    ));
  };

  useEffect(() => {
    if (!filterOpen) return undefined;
    const onDoc = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [filterOpen]);

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

  const offersById = useMemo(() => {
    const map = {};
    for (const offer of data.offers) map[offer.id] = offer;
    return map;
  }, [data.offers]);

  const sortOffers = useCallback((list) => {
    const copy = [...list];
    if (sortBy === SORT_NEWEST) return copy.sort(compareNewest);
    return copy.sort((a, b) => compareByTeam(a.market, b.market, teams, sortBy, a, b));
  }, [sortBy, teams]);

  const sortBets = useCallback((list) => {
    const copy = [...list];
    if (sortBy === SORT_NEWEST) return copy.sort(compareNewest);
    return copy.sort((a, b) => compareByTeam(
      offersById[a.offerId]?.market,
      offersById[b.offerId]?.market,
      teams,
      sortBy,
      a,
      b,
    ));
  }, [sortBy, teams, offersById]);

  const filterOffer = useCallback((offer) => (
    itemInvolvesAnyTeam(offer.market, offerSearchText(offer), filterIds, teams)
  ), [filterIds, teams]);

  const filterBet = useCallback((bet) => {
    if (bet.id === highlightBetId) return true;
    const offer = offersById[bet.offerId];
    return itemInvolvesAnyTeam(
      offer?.market,
      betSearchText(bet, offer),
      filterIds,
      teams,
    );
  }, [filterIds, teams, offersById, highlightBetId]);

  const openOffersAll = useMemo(
    () => data.offers.filter((o) => o.status === 'open' && new Date(o.expiresAt).getTime() > now),
    [data.offers, now],
  );
  const myOffersAll = useMemo(
    () => data.offers.filter((o) => actor && o.creatorId === actor.id),
    [data.offers, actor],
  );
  const myBetsAll = useMemo(
    () => data.bets.filter((b) => actor && (b.takerId === actor.id || b.creatorId === actor.id)),
    [data.bets, actor],
  );
  const liveBetsAll = useMemo(() => data.bets.filter((b) => b.status === 'live'), [data.bets]);

  const openOffers = useMemo(
    () => sortOffers(openOffersAll.filter(filterOffer)),
    [openOffersAll, filterOffer, sortOffers],
  );
  const myOffers = useMemo(
    () => sortOffers(myOffersAll.filter(filterOffer)),
    [myOffersAll, filterOffer, sortOffers],
  );
  const myBets = useMemo(
    () => sortBets(myBetsAll.filter(filterBet)),
    [myBetsAll, filterBet, sortBets],
  );
  const liveBets = useMemo(
    () => sortBets(liveBetsAll.filter(filterBet)),
    [liveBetsAll, filterBet, sortBets],
  );

  const counts = {
    market: openOffers.length,
    myOffers: myOffers.length,
    myBets: myBets.length,
    liveBets: liveBets.length,
  };

  const filtering = filterIds.length > 0;
  const sortingByTeam = sortBy === SORT_TEAM_AZ || sortBy === SORT_TEAM_ZA;

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

  const renderOfferCards = (offers) => {
    const nodes = [];
    let lastGroup = null;
    for (const offer of offers) {
      const group = sortingByTeam ? (primaryTeamName(offer.market, teams) || 'Other') : null;
      if (group && group !== lastGroup) {
        nodes.push(<div key={`g-offer-${group}`} className="fd-team-group">{group}</div>);
        lastGroup = group;
      }
      nodes.push(
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
        />,
      );
    }
    return nodes;
  };

  const renderBetCards = (bets) => {
    const nodes = [];
    let lastGroup = null;
    for (const bet of bets) {
      const group = sortingByTeam
        ? (primaryTeamName(offersById[bet.offerId]?.market, teams) || 'Other')
        : null;
      if (group && group !== lastGroup) {
        nodes.push(<div key={`g-bet-${group}`} className="fd-team-group">{group}</div>);
        lastGroup = group;
      }
      nodes.push(
        <BetCard key={bet.id} bet={bet} actor={actor} highlight={bet.id === highlightBetId} />,
      );
    }
    return nodes;
  };

  const renderOffers = (offers, emptyText, unfilteredCount, noun) => {
    if (offers.length === 0) {
      const msg = filtering && unfilteredCount > 0
        ? emptyForFilter(noun, filterIds, teams)
        : emptyText;
      return <div className="fd-empty">{msg}</div>;
    }
    return renderOfferCards(offers);
  };

  const renderBets = (bets, emptyText, unfilteredCount, noun) => {
    if (bets.length === 0) {
      const msg = filtering && unfilteredCount > 0
        ? emptyForFilter(noun, filterIds, teams)
        : emptyText;
      return <div className="fd-empty">{msg}</div>;
    }
    return renderBetCards(bets);
  };

  let body;
  if (loading) {
    body = <div className="fd-empty">Loading the exchange…</div>;
  } else if (tab === 'market') {
    body = renderOffers(openOffers, 'No open offers. Post the first one.', openOffersAll.length, 'open offers');
  } else if (tab === 'myOffers') {
    body = renderOffers(myOffers, "You haven't posted any offers yet.", myOffersAll.length, 'offers');
  } else if (tab === 'myBets') {
    body = renderBets(myBets, 'No live bets yet — take an offer or get one taken.', myBetsAll.length, 'bets');
  } else {
    body = renderBets(liveBets, 'No live bets on the exchange yet.', liveBetsAll.length, 'live bets');
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

      <div className="fd-controls">
        <div className="fd-controls-field fd-controls-teams" ref={filterRef}>
          <label id="fd-team-filter-label">Teams in the bet</label>
          <button
            type="button"
            className={`fd-filter-trigger${filtering ? ' fd-filter-trigger-on' : ''}`}
            aria-haspopup="true"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
          >
            <span className="fd-filter-trigger-text">{filterTriggerLabel(filterIds, teams)}</span>
            <span className="fd-filter-caret" aria-hidden="true">{filterOpen ? '▴' : '▾'}</span>
          </button>
          {filterOpen && (
            <div className="fd-filter-menu" role="group" aria-labelledby="fd-team-filter-label">
              <label className="fd-filter-option fd-filter-option-all">
                <input
                  type="checkbox"
                  checked={!filtering}
                  onChange={() => setFilterIds([])}
                />
                All teams
              </label>
              {teamsByName.map((t) => {
                const rid = Number(t.rosterId);
                const checked = filterIds.includes(rid);
                return (
                  <label
                    key={t.rosterId}
                    className="fd-filter-option"
                    title={t.ownerName ? `${t.teamName} (${t.ownerName})` : t.teamName}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFilterTeam(rid)}
                    />
                    <span className="fd-filter-option-name">{t.teamName}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <div className="fd-controls-field fd-controls-sort">
          <label htmlFor="fd-sort-by">Sort</label>
          <select
            id="fd-sort-by"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value={SORT_NEWEST}>Newest</option>
            <option value={SORT_TEAM_AZ}>Team A–Z</option>
            <option value={SORT_TEAM_ZA}>Team Z–A</option>
          </select>
        </div>
      </div>

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
