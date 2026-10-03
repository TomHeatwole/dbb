import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { formatSidesForRow } from '../rawarb/twoWayPairs';
import { applyDeepAttachments, extraRowsForDisplay } from '../rawarb/mergeDeep';

const OG_TITLE = 'Raw Arb';
const OG_DESCRIPTION = 'FanDuel vs DraftKings CFB and NFL two-way markets';
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

function MarketRow({ label, kind, market, best, wide }) {
  const fd = wide
    ? formatSidesForRow(market?.fd, kind, market?.twoWay, 'fd')
    : formatBookSides(market?.fd, kind);
  const dk = wide
    ? formatSidesForRow(market?.dk, kind, market?.twoWay, 'dk')
    : formatBookSides(market?.dk, kind);
  const twoWay = market?.twoWay;
  return (
    <tr className={best ? 'rawarb-row--best' : undefined}>
      <th scope="row" className={wide ? 'rawarb-th-wide' : undefined}>{label}</th>
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

function GameCard({ game, deepStatus }) {
  const { promoted, rest } = extraRowsForDisplay(game);
  const [open, setOpen] = useState(false);
  return (
    <article className="rawarb-card">
      <header className="rawarb-card-head">
        <span className="rawarb-sport">{game.sport.toUpperCase()}</span>
        <h2>
          {game.away} @ {game.home}
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
          {promoted.map((row) => (
            <MarketRow
              key={`${row.key}-${row.twoWay?.pSum}-${row.twoWay?.legs?.[0]?.line ?? ''}`}
              label={row.label}
              kind={row.kind}
              market={row}
              best={row.twoWay && row.twoWay.pSum === game.bestPSum}
              wide
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
                  best={row.twoWay && row.twoWay.pSum === game.bestPSum}
                  wide
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
  const [sortMode, setSortMode] = useState('best');
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
      const res = await fetch('/api/rawarb-deep');
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

  const visible = useMemo(
    () => sortGames(filterGames(games, sport), sortMode),
    [games, sport, sortMode],
  );

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
          <p>CFB + NFL · FanDuel vs DraftKings · every pairable two-way</p>
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
            {deepStats ? ` · ${deepStats.extras ?? 0} pairable extras` : null}
            {extraArbTotal ? ` · ${extraArbTotal} extra arbs` : null}
            {deepStatus === 'scanning' ? ' · scanning props…' : null}
            {stamp ? ` · ${stamp}` : null}
          </div>
        </div>

        <p className="rawarb-hint">
          Default columns are ML, spread, and O/U. Extra two-ways that are already
          arb (quarters, alts, player props, team totals, yes/no) pin into the
          card. Everything else pairable is under each game&apos;s dropdown.
          Combined under 100% is a lock; a middle still covers 3/4 of the pot.
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
              <GameCard
                key={`${game.sport}-${game.fdEventId || game.dkEventId || `${game.away}-${game.home}`}`}
                game={game}
                deepStatus={deepStatus}
              />
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
