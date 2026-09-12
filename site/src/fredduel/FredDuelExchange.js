import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCompletedWeeksCount } from '../utils/DateHelper';
import { involvesRosterId, primaryTeamName } from './markets';
import { compareLongestLine, compareShortestLine } from './oddsMath';
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
const SORT_OLDEST = 'oldest';
const SORT_LONGEST = 'longest';
const SORT_SHORTEST = 'shortest';
const SORT_TEAM_AZ = 'team-az';
const SORT_TEAM_ZA = 'team-za';

const SORT_OPTIONS = [
  { id: SORT_NEWEST, label: 'Newest' },
  { id: SORT_OLDEST, label: 'Oldest' },
  { id: SORT_LONGEST, label: 'Longest' },
  { id: SORT_SHORTEST, label: 'Shortest' },
  { id: SORT_TEAM_AZ, label: 'Team A–Z' },
  { id: SORT_TEAM_ZA, label: 'Team Z–A' },
];

function FilterCaret({ open }) {
  return (
    <svg
      className={`fd-filter-caret${open ? ' fd-filter-caret-open' : ''}`}
      viewBox="0 0 12 8"
      width="11"
      height="7"
      aria-hidden="true"
    >
      <path
        d="M1.5 1.75 L6 6.25 L10.5 1.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

function compareOldest(a, b) {
  return new Date(a.createdAt) - new Date(b.createdAt);
}

function compareByLine(a, b, dir) {
  const cmp = dir === SORT_SHORTEST
    ? compareShortestLine(a.line, b.line)
    : compareLongestLine(a.line, b.line);
  if (cmp !== 0) return cmp;
  return compareNewest(a, b);
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

function emptyForFilters(noun, { filterIds, teams, layerIds, layers }) {
  const teamNames = teams
    .filter((t) => filterIds.includes(Number(t.rosterId)))
    .map((t) => t.teamName);
  const layerNames = layers
    .filter((l) => layerIds.includes(l.id))
    .map((l) => l.name);
  const bits = [];
  if (teamNames.length === 1) bits.push(`involving ${teamNames[0]}`);
  else if (teamNames.length === 2) bits.push(`involving ${teamNames[0]} or ${teamNames[1]}`);
  else if (teamNames.length > 2) bits.push('involving the selected teams');
  if (layerNames.length === 1) bits.push(`laid by ${layerNames[0]}`);
  else if (layerNames.length === 2) bits.push(`laid by ${layerNames[0]} or ${layerNames[1]}`);
  else if (layerNames.length > 2) bits.push('laid by the selected layers');
  if (!bits.length) return `No ${noun}.`;
  return `No ${noun} ${bits.join(' ')}.`;
}

function filterTriggerLabel(selectedIds, items, { idKey, nameKey, allLabel, oneFallback, manyNoun }) {
  if (!selectedIds.length) return allLabel;
  if (selectedIds.length === 1) {
    const item = items.find((t) => String(t[idKey]) === String(selectedIds[0]));
    return item?.[nameKey] || oneFallback;
  }
  return `${selectedIds.length} ${manyNoun}`;
}

function CheckboxFilter({
  labelId, label, allLabel, triggerLabel, active, open, onToggleOpen,
  onSelectAll, options, selected, onToggle, getId, getName, getTitle,
}) {
  return (
    <div className="fd-controls-field fd-controls-filter">
      <label id={labelId}>{label}</label>
      <button
        type="button"
        className={`fd-filter-trigger${active ? ' fd-filter-trigger-on' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggleOpen}
      >
        <span className="fd-filter-trigger-text">{triggerLabel}</span>
        <FilterCaret open={open} />
      </button>
      {open && (
        <div className="fd-filter-menu" role="group" aria-labelledby={labelId}>
          <label className="fd-filter-option fd-filter-option-all">
            <input type="checkbox" checked={!active} onChange={onSelectAll} />
            {allLabel}
          </label>
          {options.map((item) => {
            const id = getId(item);
            return (
              <label key={id} className="fd-filter-option" title={getTitle ? getTitle(item) : undefined}>
                <input
                  type="checkbox"
                  checked={selected.includes(id)}
                  onChange={() => onToggle(id)}
                />
                <span className="fd-filter-option-name">{getName(item)}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SortSelect({ value, open, onToggleOpen, onChange }) {
  const selected = SORT_OPTIONS.find((o) => o.id === value);
  return (
    <div className="fd-controls-field fd-controls-sort">
      <label id="fd-sort-by-label">Sort</label>
      <button
        type="button"
        className="fd-filter-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="fd-sort-by-label"
        onClick={onToggleOpen}
      >
        <span className="fd-filter-trigger-text">{selected?.label || 'Newest'}</span>
        <FilterCaret open={open} />
      </button>
      {open && (
        <div className="fd-filter-menu fd-sort-menu" role="listbox" aria-labelledby="fd-sort-by-label">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={opt.id === value}
              className={`fd-filter-option fd-sort-option${opt.id === value ? ' fd-sort-option-active' : ''}`}
              onClick={() => onChange(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
  const [layerIds, setLayerIds] = useState([]);
  const [openMenu, setOpenMenu] = useState(null);
  const [sortBy, setSortBy] = useState(SORT_NEWEST);
  const filtersRef = useRef(null);

  const teamsByName = useMemo(
    () => [...teams].sort((a, b) => a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' })),
    [teams],
  );

  const layers = useMemo(() => {
    const map = new Map();
    const add = (id, name) => {
      if (id == null || id === '') return;
      if (!map.has(id)) map.set(id, name || String(id));
    };
    for (const o of data.offers) add(o.creatorId, o.creatorName);
    for (const b of data.bets) add(b.creatorId, b.creatorName);
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [data.offers, data.bets]);

  const toggleFilterTeam = (rosterId) => {
    const rid = Number(rosterId);
    setFilterIds((prev) => (
      prev.includes(rid) ? prev.filter((id) => id !== rid) : [...prev, rid]
    ));
  };

  const toggleLayer = (id) => {
    setLayerIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  useEffect(() => {
    if (!openMenu) return undefined;
    const onDoc = (e) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) setOpenMenu(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

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
    if (sortBy === SORT_OLDEST) return copy.sort(compareOldest);
    if (sortBy === SORT_LONGEST || sortBy === SORT_SHORTEST) {
      return copy.sort((a, b) => compareByLine(a, b, sortBy));
    }
    return copy.sort((a, b) => compareByTeam(a.market, b.market, teams, sortBy, a, b));
  }, [sortBy, teams]);

  const sortBets = useCallback((list) => {
    const copy = [...list];
    if (sortBy === SORT_NEWEST) return copy.sort(compareNewest);
    if (sortBy === SORT_OLDEST) return copy.sort(compareOldest);
    if (sortBy === SORT_LONGEST || sortBy === SORT_SHORTEST) {
      return copy.sort((a, b) => compareByLine(a, b, sortBy));
    }
    return copy.sort((a, b) => compareByTeam(
      offersById[a.offerId]?.market,
      offersById[b.offerId]?.market,
      teams,
      sortBy,
      a,
      b,
    ));
  }, [sortBy, teams, offersById]);

  const matchesLayer = useCallback((creatorId) => (
    !layerIds.length || layerIds.includes(creatorId)
  ), [layerIds]);

  const filterOffer = useCallback((offer) => (
    matchesLayer(offer.creatorId)
    && itemInvolvesAnyTeam(offer.market, offerSearchText(offer), filterIds, teams)
  ), [filterIds, teams, matchesLayer]);

  const filterBet = useCallback((bet) => {
    if (bet.id === highlightBetId) return true;
    const offer = offersById[bet.offerId];
    return matchesLayer(bet.creatorId)
      && itemInvolvesAnyTeam(
        offer?.market,
        betSearchText(bet, offer),
        filterIds,
        teams,
      );
  }, [filterIds, teams, offersById, highlightBetId, matchesLayer]);

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

  const filteringTeams = filterIds.length > 0;
  const filteringLayers = layerIds.length > 0;
  const hasListFilters = filteringTeams || filteringLayers;
  const sortingByTeam = sortBy === SORT_TEAM_AZ || sortBy === SORT_TEAM_ZA;
  const emptyFilterArgs = { filterIds, teams, layerIds, layers };

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
  const createOffers = async (inputs) => {
    const errors = [];
    for (const input of inputs || []) {
      try {
        await client.createOffer(input);
      } catch (e) {
        errors.push(`${input.title || 'offer'}: ${e.message}`);
      }
    }
    setTab('market');
    await refresh();
    if (errors.length) {
      throw new Error(
        errors.length === (inputs || []).length
          ? errors.join(' ')
          : `Posted ${inputs.length - errors.length} of ${inputs.length}. ${errors.join(' ')}`,
      );
    }
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
      const msg = hasListFilters && unfilteredCount > 0
        ? emptyForFilters(noun, emptyFilterArgs)
        : emptyText;
      return <div className="fd-empty">{msg}</div>;
    }
    return renderOfferCards(offers);
  };

  const renderBets = (bets, emptyText, unfilteredCount, noun) => {
    if (bets.length === 0) {
      const msg = hasListFilters && unfilteredCount > 0
        ? emptyForFilters(noun, emptyFilterArgs)
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

      <div className="fd-controls" ref={filtersRef}>
        <div className="fd-controls-filters">
          <CheckboxFilter
            labelId="fd-team-filter-label"
            label={<>Teams<span className="fd-filter-label-extra"> in the bet</span></>}
            allLabel="All teams"
            triggerLabel={filterTriggerLabel(filterIds, teamsByName, {
              idKey: 'rosterId', nameKey: 'teamName', allLabel: 'All teams',
              oneFallback: '1 team', manyNoun: 'teams',
            })}
            active={filteringTeams}
            open={openMenu === 'teams'}
            onToggleOpen={() => setOpenMenu((v) => (v === 'teams' ? null : 'teams'))}
            onSelectAll={() => setFilterIds([])}
            options={teamsByName}
            selected={filterIds}
            onToggle={toggleFilterTeam}
            getId={(t) => Number(t.rosterId)}
            getName={(t) => t.teamName}
            getTitle={(t) => (t.ownerName ? `${t.teamName} (${t.ownerName})` : t.teamName)}
          />
          <CheckboxFilter
            labelId="fd-layer-filter-label"
            label="Layer"
            allLabel="All layers"
            triggerLabel={filterTriggerLabel(layerIds, layers, {
              idKey: 'id', nameKey: 'name', allLabel: 'All layers',
              oneFallback: '1 layer', manyNoun: 'layers',
            })}
            active={filteringLayers}
            open={openMenu === 'layers'}
            onToggleOpen={() => setOpenMenu((v) => (v === 'layers' ? null : 'layers'))}
            onSelectAll={() => setLayerIds([])}
            options={layers}
            selected={layerIds}
            onToggle={toggleLayer}
            getId={(l) => l.id}
            getName={(l) => l.name}
          />
        </div>
        <SortSelect
          value={sortBy}
          open={openMenu === 'sort'}
          onToggleOpen={() => setOpenMenu((v) => (v === 'sort' ? null : 'sort'))}
          onChange={(next) => {
            setSortBy(next);
            setOpenMenu(null);
          }}
        />
      </div>

      {showCreate && (
        <CreateOfferPanel
          teams={teams}
          currentWeek={getUpcomingWeek()}
          actor={actor}
          onCreate={createOffer}
          onCreateMany={createOffers}
          onClose={() => setShowCreate(false)}
        />
      )}

      <div className="fd-list">{body}</div>
    </div>
  );
}

export default FredDuelExchange;
