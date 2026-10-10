import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import {
  applyEnabledBooks,
  filterGames,
  formatBookSides,
  formatCombinedPct,
  formatJuicePct,
  formatTwoWayLegs,
  isBestTwoWay,
  parseSignedAmerican,
  sortGames,
} from '../rawarb/rawArbModel';
import { RAW_BOOKS } from '../rawarb/bookCatalog';
import { formatSidesForRow } from '../rawarb/twoWayPairs';
import { applyDeepAttachments, applyEnabledExtras, extraRowsForDisplay } from '../rawarb/mergeDeep';
import { sportFiltersFor, sportLabel } from '../rawarb/sportCatalog';

const OG_TITLE = 'Raw Arb';
const OG_DESCRIPTION = 'FanDuel, DraftKings, BetMGM, and Caesars two-way markets';
const REFRESH_MS = 60_000;
const BOOKS_KEY = 'rawarb-books-v2';
const DEFAULT_ON = new Set(['fd', 'dk']);

function loadEnabledBooks() {
  const next = {};
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(BOOKS_KEY) || '{}') || {};
  } catch {
    stored = {};
  }
  for (const book of RAW_BOOKS) {
    next[book.id] = Object.prototype.hasOwnProperty.call(stored, book.id)
      ? Boolean(stored[book.id])
      : DEFAULT_ON.has(book.id);
  }
  if (!RAW_BOOKS.some((book) => next[book.id])) next.fd = true;
  return next;
}

const MARKET_ROWS = [
  { key: 'moneyline', label: 'ML', kind: 'moneyline' },
  { key: 'spread', label: 'Spread', kind: 'spread' },
  { key: 'total', label: 'O/U', kind: 'total' },
];

function formatKick(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function twoWayClass(twoWay) {
  if (!twoWay) return '';
  if (twoWay.hasArb) return ' rawarb-twoway--arb';
  if (twoWay.pSum <= 1.02) return ' rawarb-twoway--close';
  return '';
}

function bookQuoted(market, kind, bookId) {
  const book = market?.[bookId];
  if (!book) return false;
  if (kind === 'total') return Boolean(book.over || book.under);
  return Boolean(book.away || book.home);
}

function MarketRow({ label, kind, market, best, wide, books }) {
  const twoWay = market?.twoWay;
  const priced = books.filter((book) => bookQuoted(market, kind, book.id)).length;
  return (
    <tr className={best ? 'rawarb-row--best' : undefined}>
      <th scope="row" className={wide ? 'rawarb-th-wide' : undefined}>{label}</th>
      {books.map((book) => {
        const sides = wide
          ? formatSidesForRow(market?.[book.id], kind, market?.twoWay, book.id)
          : formatBookSides(market?.[book.id], kind);
        return (
          <td key={book.id}>
            <span>{sides.left}</span>
            <span className="rawarb-sep">/</span>
            <span>{sides.right}</span>
          </td>
        );
      })}
      <td className={`rawarb-twoway${twoWayClass(twoWay)}`}>
        {twoWay ? (
          <>
            <div className="rawarb-twoway-nums">
              <strong>{formatCombinedPct(twoWay.pSum)}</strong>
              <span>{formatJuicePct(twoWay.pSum)}</span>
              {twoWay.lineFit === 'middle' && <span className="rawarb-middle">Middle</span>}
            </div>
            <div className="rawarb-twoway-legs">{formatTwoWayLegs(twoWay)}</div>
          </>
        ) : (
          <span className="rawarb-empty">{priced >= 2 ? '—' : 'Need two books'}</span>
        )}
      </td>
    </tr>
  );
}

function GameCard({ game, deepStatus, oddsFilter, filterNyc, books }) {
  const { promoted, rest } = extraRowsForDisplay(game, { oddsFilter, filterNyc });
  const [open, setOpen] = useState(false);
  return (
    <article className="rawarb-card">
      <header className="rawarb-card-head">
        <span className="rawarb-sport">{sportLabel(game.sport)}</span>
        <h2>
          {['soccer', 'tennis', 'mma', 'boxing'].includes(game.sport)
            ? `${game.home} v ${game.away}`
            : `${game.away} @ ${game.home}`}
        </h2>
        <span className="rawarb-kick">
          {game.inPlay ? 'Live · ' : ''}
          {formatKick(game.openDate)}
          {game.extraArbCount ? ` · ${game.extraArbCount} extra arb` : ''}
        </span>
      </header>
      <table className="rawarb-table">
        <thead>
          <tr>
            <th scope="col" />
            {books.map((book) => (
              <th key={book.id} scope="col">{book.label}</th>
            ))}
            <th scope="col">Best two-way</th>
          </tr>
        </thead>
        <tbody>
          {MARKET_ROWS.map((row) => (
            <MarketRow
              key={row.key}
              label={row.label}
              kind={row.kind}
              market={game[row.key]}
              best={isBestTwoWay(game[row.key], game, { oddsFilter, filterNyc })}
              books={books}
            />
          ))}
          {promoted.map((row) => (
            <MarketRow
              key={`${row.key}-${row.twoWay?.pSum}-${row.twoWay?.legs?.[0]?.line ?? ''}`}
              label={row.label}
              kind={row.kind}
              market={row}
              best={isBestTwoWay(row, game, { oddsFilter, filterNyc })}
              wide
              books={books}
            />
          ))}
        </tbody>
      </table>
      {rest.length > 0 && (
        <details className="rawarb-more" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary>
            Other two-way markets ({rest.length})
          </summary>
          <table className="rawarb-table rawarb-table--more">
            <tbody>
              {rest.map((row) => (
                <MarketRow
                  key={row.key}
                  label={row.label}
                  kind={row.kind}
                  market={row}
                  best={isBestTwoWay(row, game, { oddsFilter, filterNyc })}
                  wide
                  books={books}
                />
              ))}
            </tbody>
          </table>
        </details>
      )}
      {!game.deepLoaded && deepStatus === 'scanning' && (
        <p className="rawarb-scan">Scanning props…</p>
      )}
    </article>
  );
}

function RawArbPage() {
  const [games, setGames] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [stats, setStats] = useState(null);
  const [deepStats, setDeepStats] = useState(null);
  const [notices, setNotices] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deepStatus, setDeepStatus] = useState('idle');
  const [sport, setSport] = useState('all');
  const [timing, setTiming] = useState('all');
  const [sortMode, setSortMode] = useState('best');
  const [oddsBook, setOddsBook] = useState('fd');
  const [oddsMinRaw, setOddsMinRaw] = useState('');
  const [filterNyc, setFilterNyc] = useState(true);
  const [enabledBooks, setEnabledBooks] = useState(loadEnabledBooks);
  const attachmentsRef = useRef([]);
  const deepInFlight = useRef(false);

  const applyGames = useCallback((nextGames) => {
    setGames(applyDeepAttachments(nextGames, attachmentsRef.current));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/rawarb');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      applyGames(body.games ?? []);
      setFetchedAt(body.fetchedAt ?? null);
      setStats(body.stats ?? null);
      setNotices(body.notices ?? []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load lines');
    } finally {
      setLoading(false);
    }
  }, [applyGames]);

  const refreshDeep = useCallback(async () => {
    if (deepInFlight.current) return;
    deepInFlight.current = true;
    setDeepStatus('scanning');
    try {
      const res = await fetch('/api/rawarb?deep=1');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      attachmentsRef.current = body.attachments ?? [];
      setDeepStats(body.stats ?? null);
      setGames((prev) => applyDeepAttachments(prev, attachmentsRef.current));
      setDeepStatus('ready');
    } catch (err) {
      setDeepStatus('error');
      setNotices((prev) => {
        const msg = `Deep scan: ${err.message || 'failed'}`;
        return prev.includes(msg) ? prev : [...prev, msg];
      });
    } finally {
      deepInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshDeep();
    const mainId = window.setInterval(refresh, REFRESH_MS);
    const deepId = window.setInterval(refreshDeep, REFRESH_MS);
    return () => {
      window.clearInterval(mainId);
      window.clearInterval(deepId);
    };
  }, [refresh, refreshDeep]);

  const sportFilters = useMemo(() => sportFiltersFor(games), [games]);
  const minAmerican = useMemo(() => parseSignedAmerican(oddsMinRaw), [oddsMinRaw]);
  const activeBooks = useMemo(
    () => RAW_BOOKS.filter((book) => enabledBooks[book.id]),
    [enabledBooks],
  );
  const activeBookIds = useMemo(() => activeBooks.map((book) => book.id), [activeBooks]);
  const oddsBookId = activeBookIds.includes(oddsBook) ? oddsBook : activeBookIds[0];
  const oddsFilter = useMemo(
    () => (Number.isFinite(minAmerican) ? { book: oddsBookId, minAmerican } : null),
    [oddsBookId, minAmerican],
  );
  const filterOpts = useMemo(
    () => ({ oddsFilter, filterNyc }),
    [oddsFilter, filterNyc],
  );
  const bySport = useMemo(() => filterGames(games, sport), [games, sport]);
  const liveCount = useMemo(() => bySport.filter((game) => game.inPlay).length, [bySport]);
  const upcomingCount = bySport.length - liveCount;
  const visible = useMemo(() => {
    const scored = games.map((game) => (
      applyEnabledExtras(applyEnabledBooks(game, activeBookIds), activeBookIds)
    ));
    return sortGames(filterGames(scored, sport, timing, filterOpts), sortMode, filterOpts);
  }, [games, sport, timing, sortMode, filterOpts, activeBookIds]);

  useEffect(() => {
    if (sport !== 'all' && !sportFilters.some((opt) => opt.id === sport)) {
      setSport('all');
    }
  }, [sport, sportFilters]);

  const stamp = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })
    : null;
  const extraArbTotal = visible.reduce((n, game) => n + (game.extraArbCount ?? 0), 0);

  return (
    <InfoPageWrapper>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <div className="rawarb-page">
        <header className="rawarb-head">
          <h1>Raw Arb</h1>
          <p>Every sport on FanDuel and DraftKings. BetMGM and Caesars stay off until you turn them on.</p>
        </header>
        <div className="rawarb-toolbar">
          <div className="rawarb-filters" role="group" aria-label="Sport">
            {sportFilters.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`rawarb-chip${sport === opt.id ? ' rawarb-chip--on' : ''}`}
                onClick={() => setSport(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="rawarb-filters rawarb-filters--timing" role="group" aria-label="When">
            {[
              { id: 'all', label: 'All games' },
              { id: 'live', label: liveCount ? `Live ${liveCount}` : 'Live' },
              { id: 'upcoming', label: upcomingCount ? `Upcoming ${upcomingCount}` : 'Upcoming' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`rawarb-chip${opt.id === 'live' ? ' rawarb-chip--live' : ''}${timing === opt.id ? ' rawarb-chip--on' : ''}`}
                onClick={() => setTiming(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="rawarb-filters rawarb-filters--timing" role="group" aria-label="Books">
            {RAW_BOOKS.map((book) => (
              <button
                key={book.id}
                type="button"
                className={`rawarb-chip${enabledBooks[book.id] ? ' rawarb-chip--on' : ''}`}
                aria-pressed={Boolean(enabledBooks[book.id])}
                onClick={() => {
                  setEnabledBooks((prev) => {
                    const on = RAW_BOOKS.filter((row) => prev[row.id]).length;
                    if (prev[book.id] && on <= 1) return prev;
                    const next = { ...prev, [book.id]: !prev[book.id] };
                    localStorage.setItem(BOOKS_KEY, JSON.stringify(next));
                    return next;
                  });
                }}
              >
                {book.short}
              </button>
            ))}
          </div>
          <label className="rawarb-sort">
            Sort
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="best">Closest to even</option>
              <option value="kickoff">Kickoff</option>
            </select>
          </label>
          <div className="rawarb-odds" role="group" aria-label="Minimum odds">
            <span>Min odds</span>
            {activeBooks.map((book) => (
              <button
                key={book.id}
                type="button"
                className={`rawarb-chip${oddsBookId === book.id ? ' rawarb-chip--on' : ''}`}
                onClick={() => setOddsBook(book.id)}
              >
                {book.short}
              </button>
            ))}
            <input
              type="text"
              inputMode="numeric"
              placeholder="+1500"
              value={oddsMinRaw}
              onChange={(e) => setOddsMinRaw(e.target.value)}
              aria-label="Minimum American odds"
            />
          </div>
          <button
            type="button"
            className={`rawarb-chip${filterNyc ? ' rawarb-chip--on' : ''}`}
            onClick={() => setFilterNyc((on) => !on)}
            aria-pressed={filterNyc}
          >
            Filter out NYC
          </button>
          <div className="rawarb-meta">
            {stats
              ? `${visible.length} games · ${stats.withMgm ?? 0} BetMGM · ${stats.withCzr ?? 0} Caesars`
              : null}
            {deepStats ? ` · ${deepStats.extras ?? 0} pairable extras` : null}
            {extraArbTotal ? ` · ${extraArbTotal} extra arbs` : null}
            {deepStatus === 'scanning' ? ' · scanning props…' : null}
            {stamp ? ` · ${stamp}` : null}
          </div>
        </div>

        <p className="rawarb-hint">
          FanDuel and DraftKings start on. BetMGM and Caesars start off — turn a chip on to count that book. Default columns are ML, spread, and O/U. Extra two-ways that are already
          arb (quarters, alts, player props, team totals, yes/no) pin into the
          card. Everything else pairable is under each game&apos;s dropdown.
          Combined under 100% is a lock; a middle still covers 3/4 of the pot.
        </p>

        {notices.length > 0 && (
          <p className="rawarb-notice">{notices.join(' · ')}</p>
        )}
        {error && <p className="rawarb-error">{error}</p>}

        {loading && !games.length ? (
          <LoadingState label="Pulling FanDuel, DraftKings, BetMGM, and Caesars…" />
        ) : (
          <div className="rawarb-list">
            {visible.map((game) => (
              <GameCard
                key={`${game.sport}-${game.fdEventId || game.dkEventId || `${game.away}-${game.home}`}`}
                game={game}
                deepStatus={deepStatus}
                oddsFilter={oddsFilter}
                filterNyc={filterNyc}
                books={activeBooks}
              />
            ))}
            {!visible.length && !loading && (
              <p className="rawarb-empty">
                {oddsFilter
                  ? `No games with ${RAW_BOOKS.find((book) => book.id === oddsBookId)?.label || 'that book'} ${minAmerican > 0 ? '+' : ''}${minAmerican} or longer.`
                  : timing === 'live'
                    ? 'No live games right now.'
                    : timing === 'upcoming'
                      ? 'No upcoming games for that sport.'
                      : 'No games for that sport right now.'}
              </p>
            )}
          </div>
        )}
      </div>
    </InfoPageWrapper>
  );
}

export default RawArbPage;
