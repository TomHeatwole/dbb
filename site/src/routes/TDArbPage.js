import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { formatAmericanOdds } from '../sop/sopModel.js';
import { bookShort } from '../rawarb/bookCatalog.js';
import {
  filterGames,
  filterPlayers,
  formatCombinedPct,
  formatHedgeLegs,
  formatJuicePct,
} from '../tdarb/tdArbModel.js';

const OG_TITLE = 'TD Arb';
const OG_DESCRIPTION = 'NFL anytime touchdown vs Kalshi NO on 1+ TD';
const REFRESH_MS = 60_000;

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

function hedgeClass(hedge) {
  if (!hedge) return '';
  if (hedge.hasArb) return ' rawarb-twoway--arb';
  if (hedge.pSum <= 1.02) return ' rawarb-twoway--close';
  return '';
}

function quoteCell(american) {
  if (american == null) return '—';
  return formatAmericanOdds(american);
}

function GameCard({ game, minAmerican, oddsBook, showArbOnly }) {
  const players = useMemo(() => {
    let rows = filterPlayers(game.players, { minAmerican, book: oddsBook });
    if (showArbOnly) rows = rows.filter((p) => p.hasArb);
    return rows;
  }, [game.players, minAmerican, oddsBook, showArbOnly]);

  if (!players.length) return null;

  return (
    <article className="rawarb-card">
      <header className="rawarb-card-head">
        <span className="rawarb-sport">NFL</span>
        <h2>
          {game.away}
          {' @ '}
          {game.home}
        </h2>
        <span className="rawarb-kick">{formatKick(game.openDate)}</span>
        {game.inPlay && <span className="rawarb-live">Live</span>}
        {game.kalshiEventTicker && (
          <span className="rawarb-meta" title={game.kalshiEventTitle || ''}>
            Kalshi {game.kalshiEventTicker.replace(/^KXNFLTD-/, '')}
          </span>
        )}
      </header>
      <div className="rawarb-table-wrap">
        <table className="rawarb-table">
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">{bookShort('fd')}</th>
              <th scope="col">{bookShort('dk')}</th>
              <th scope="col">Kalshi YES</th>
              <th scope="col">Kalshi NO</th>
              <th scope="col">Hedge</th>
            </tr>
          </thead>
          <tbody>
            {players.map((row) => (
              <tr key={row.name} className={row.hasArb ? 'rawarb-row--best' : undefined}>
                <th scope="row">{row.name}</th>
                <td>{quoteCell(row.fd?.american)}</td>
                <td>{quoteCell(row.dk?.american)}</td>
                <td>{quoteCell(row.kalshi?.yesAmerican)}</td>
                <td>{quoteCell(row.kalshi?.noAmerican)}</td>
                <td className={`rawarb-twoway${hedgeClass(row.hedge)}`}>
                  {row.hedge ? (
                    <>
                      <div className="rawarb-twoway-nums">
                        <strong>{formatCombinedPct(row.hedge.pSum)}</strong>
                        <span>{formatJuicePct(row.hedge.pSum)}</span>
                      </div>
                      <div className="rawarb-twoway-legs">{formatHedgeLegs(row.hedge)}</div>
                    </>
                  ) : (
                    <span className="rawarb-empty">Need book + Kalshi NO</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export default function TDArbPage() {
  const [games, setGames] = useState([]);
  const [stats, setStats] = useState(null);
  const [notices, setNotices] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timing, setTiming] = useState('all');
  const [sortMode, setSortMode] = useState('best');
  const [oddsBook, setOddsBook] = useState('fd');
  const [oddsMinRaw, setOddsMinRaw] = useState('');
  const [showArbOnly, setShowArbOnly] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/tdarb');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setGames(body.games ?? []);
      setStats(body.stats ?? null);
      setNotices(body.notices ?? []);
      setFetchedAt(body.fetchedAt ?? null);
    } catch (err) {
      setNotices((prev) => {
        const msg = err.message || 'Load failed';
        return prev.includes(msg) ? prev : [...prev, msg];
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const minAmerican = useMemo(() => {
    const n = Number(String(oddsMinRaw).replace(/^\+/, ''));
    return Number.isFinite(n) ? n : null;
  }, [oddsMinRaw]);

  const visible = useMemo(() => {
    let list = filterGames(games, timing);
    if (sortMode === 'kickoff') {
      list = [...list].sort(
        (a, b) => (Date.parse(a.openDate) || 0) - (Date.parse(b.openDate) || 0),
      );
    }
    return list;
  }, [games, timing, sortMode]);

  const liveCount = useMemo(() => games.filter((g) => g.inPlay).length, [games]);
  const upcomingCount = games.length - liveCount;
  const stamp = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })
    : null;

  return (
    <InfoPageWrapper>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <div className="rawarb-page">
        <header className="rawarb-head">
          <h1>TD Arb</h1>
          <p>
            NFL Anytime Touchdown on FanDuel or DraftKings vs Kalshi NO on 1+ touchdowns
            (KXNFLTD). Sportsbook YES + Kalshi NO covers both outcomes when combined implied is under 100%.
          </p>
        </header>
        <div className="rawarb-toolbar">
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
          <button
            type="button"
            className={`rawarb-chip${showArbOnly ? ' rawarb-chip--on' : ''}`}
            onClick={() => setShowArbOnly((v) => !v)}
          >
            Arbs only
          </button>
          <label className="rawarb-sort">
            Sort
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="best">Closest to even</option>
              <option value="kickoff">Kickoff</option>
            </select>
          </label>
          <div className="rawarb-odds" role="group" aria-label="Minimum odds">
            <span>Min odds</span>
            {['fd', 'dk'].map((id) => (
              <button
                key={id}
                type="button"
                className={`rawarb-chip${oddsBook === id ? ' rawarb-chip--on' : ''}`}
                onClick={() => setOddsBook(id)}
              >
                {bookShort(id)}
              </button>
            ))}
            <input
              type="text"
              inputMode="numeric"
              placeholder="+100"
              value={oddsMinRaw}
              onChange={(e) => setOddsMinRaw(e.target.value)}
              aria-label="Minimum American odds"
            />
          </div>
        </div>
        {stats && (
          <p className="rawarb-stats">
            {stats.games} games · {stats.players} players · {stats.withKalshi} with Kalshi ·
            {' '}
            {stats.arbs} arbs
            {stamp ? ` · Updated ${stamp} ET` : ''}
          </p>
        )}
        {notices.length > 0 && (
          <ul className="rawarb-notices">
            {notices.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        )}
        {loading && !games.length ? (
          <LoadingState message="Loading anytime TD lines…" />
        ) : (
          <div className="rawarb-cards">
            {visible.map((game) => (
              <GameCard
                key={`${game.fdEventId}-${game.dkEventId}-${game.kalshiEventTicker}`}
                game={game}
                minAmerican={minAmerican}
                oddsBook={oddsBook}
                showArbOnly={showArbOnly}
              />
            ))}
            {!visible.some((g) => {
              const rows = filterPlayers(g.players, { minAmerican, book: oddsBook });
              return showArbOnly ? rows.some((p) => p.hasArb) : rows.length > 0;
            }) && (
              <p className="rawarb-empty-page">No matching players for the current filters.</p>
            )}
          </div>
        )}
      </div>
    </InfoPageWrapper>
  );
}
