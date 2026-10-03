import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import {
  filterGames,
  formatBookSides,
  formatCombinedPct,
  formatJuicePct,
  formatTwoWayLegs,
  sortGames,
} from '../rawarb/rawArbModel';

const OG_TITLE = 'Raw Arb';
const OG_DESCRIPTION = 'FanDuel vs DraftKings CFB and NFL moneyline, spread, and total';
const REFRESH_MS = 60_000;

const SPORT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'cfb', label: 'CFB' },
  { id: 'nfl', label: 'NFL' },
];

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

function MarketRow({ label, kind, market, best }) {
  const fd = formatBookSides(market?.fd, kind);
  const dk = formatBookSides(market?.dk, kind);
  const twoWay = market?.twoWay;
  return (
    <tr className={best ? 'rawarb-row--best' : undefined}>
      <th scope="row">{label}</th>
      <td>
        <span>{fd.left}</span>
        <span className="rawarb-sep">/</span>
        <span>{fd.right}</span>
      </td>
      <td>
        <span>{dk.left}</span>
        <span className="rawarb-sep">/</span>
        <span>{dk.right}</span>
      </td>
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
          <span className="rawarb-empty">{market?.fd && market?.dk ? '—' : 'Need both books'}</span>
        )}
      </td>
    </tr>
  );
}

function RawArbPage() {
  const [games, setGames] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [stats, setStats] = useState(null);
  const [notices, setNotices] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState('all');
  const [sortMode, setSortMode] = useState('best');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/rawarb');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setGames(body.games ?? []);
      setFetchedAt(body.fetchedAt ?? null);
      setStats(body.stats ?? null);
      setNotices(body.notices ?? []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load lines');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const visible = useMemo(
    () => sortGames(filterGames(games, sport), sortMode),
    [games, sport, sortMode],
  );

  const stamp = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })
    : null;

  return (
    <InfoPageWrapper>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <div className="rawarb-page">
        <header className="rawarb-head">
          <h1>Raw Arb</h1>
          <p>CFB + NFL · FanDuel vs DraftKings · moneyline, spread, total</p>
        </header>
        <div className="rawarb-toolbar">
          <div className="rawarb-filters" role="group" aria-label="Sport">
            {SPORT_FILTERS.map((opt) => (
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
          <label className="rawarb-sort">
            Sort
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="best">Closest to even</option>
              <option value="kickoff">Kickoff</option>
            </select>
          </label>
          <div className="rawarb-meta">
            {stats
              ? `${visible.length} games · ${stats.withTwoWay ?? 0} with both books`
              : null}
            {stamp ? ` · ${stamp}` : null}
          </div>
        </div>

        <p className="rawarb-hint">
          Two-way is the cheapest opposite sides across books. Combined under 100% is a
          lock; anything close is a boost candidate. Away / Home (or Over / Under) in
          that order.
        </p>

        {notices.length > 0 && (
          <p className="rawarb-notice">{notices.join(' · ')}</p>
        )}
        {error && <p className="rawarb-error">{error}</p>}

        {loading && !games.length ? (
          <LoadingState label="Pulling FanDuel and DraftKings…" />
        ) : (
          <div className="rawarb-list">
            {visible.map((game) => (
              <article
                key={`${game.sport}-${game.fdEventId || game.dkEventId || `${game.away}-${game.home}`}`}
                className="rawarb-card"
              >
                <header className="rawarb-card-head">
                  <span className="rawarb-sport">{game.sport.toUpperCase()}</span>
                  <h2>
                    {game.away} @ {game.home}
                  </h2>
                  <span className="rawarb-kick">
                    {game.inPlay ? 'Live · ' : ''}
                    {formatKick(game.openDate)}
                  </span>
                </header>
                <table className="rawarb-table">
                  <thead>
                    <tr>
                      <th scope="col" />
                      <th scope="col">FanDuel</th>
                      <th scope="col">DraftKings</th>
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
                        best={game[row.key]?.twoWay && game[row.key].twoWay.pSum === game.bestPSum}
                      />
                    ))}
                  </tbody>
                </table>
              </article>
            ))}
            {!visible.length && !loading && (
              <p className="rawarb-empty">No games for that sport right now.</p>
            )}
          </div>
        )}
      </div>
    </InfoPageWrapper>
  );
}

export default RawArbPage;
