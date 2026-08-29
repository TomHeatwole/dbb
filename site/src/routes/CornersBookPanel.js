/**
 * Corners book tab — FanDuel Premier League totals, next 5/10 min, stoppage.
 */

import React, { useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import { formatAmericanOdds } from '../sop/sopModel';

const REFRESH_MS = 60_000;
const TEAM_SEARCH_LIST_ID = 'corners-book-team-search';

function formatKickoff(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatMatchStatus(status) {
  if (!status) return null;
  return String(status).replace(/_/g, ' ');
}

function gameMatchesQuery(game, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const parts = [
    game.name,
    game.teams?.home,
    game.teams?.away,
    ...(String(game.name ?? '').split(/\s+v\s+/i)),
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return parts.some((part) => part.includes(q));
}

function collectTeamNames(games) {
  const names = new Set();
  for (const game of games) {
    if (game.teams?.home) names.add(game.teams.home);
    if (game.teams?.away) names.add(game.teams.away);
    for (const part of String(game.name ?? '').split(/\s+v\s+/i)) {
      const trimmed = part.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function OddsBox({ american, label }) {
  const hasOdds = american != null;
  return (
    <div className={`sop-exp-no-goal-book${hasOdds ? '' : ' sop-exp-no-goal-book--empty'}`}>
      {label && <span className="sop-exp-book-label sop-exp-book-label--fd">{label}</span>}
      <div
        className={`sop-exp-odds-box sop-exp-odds-box--fd sop-exp-odds-box--static${hasOdds ? '' : ' sop-exp-odds-box--missing'}`}
      >
        <span className="sop-exp-odds-box-val">
          {hasOdds ? formatAmericanOdds(american) : '—'}
        </span>
      </div>
    </div>
  );
}

function WindowSection({ title, windowMarket, liveHint }) {
  const plus = windowMarket?.plus ?? [];
  const overUnder = windowMarket?.overUnder ?? [];
  const other = windowMarket?.other ?? [];
  const hasLines = plus.length + overUnder.length + other.length > 0;

  return (
    <section className="corners-window">
      <div className="sop-exp-section-label">
        {title}
        {windowMarket?.window && (
          <span className="corners-window-range"> {windowMarket.window}</span>
        )}
      </div>
      {!hasLines && (
        <p className="corners-empty-hint">
          {liveHint
            ? 'FanDuel posts these on Quick Bets once the match is live.'
            : 'No line up yet.'}
        </p>
      )}
      {plus.length > 0 && (
        <div className="corners-plus-grid">
          {plus.map((row) => (
            <div key={`${row.n}-${row.runnerName}`} className="sop-exp-no-goal-col">
              <div className="sop-exp-no-goal-col-head">
                <span className="sop-exp-no-goal-short">{row.n}+</span>
              </div>
              <OddsBox american={row.american} />
            </div>
          ))}
        </div>
      )}
      {overUnder.length > 0 && (
        <div className="corners-ou-row">
          {overUnder.map((row) => (
            <OddsBox
              key={`${row.side}-${row.line}`}
              american={row.american}
              label={`${row.side === 'over' ? 'O' : 'U'} ${row.line}`}
            />
          ))}
        </div>
      )}
      {other.length > 0 && (
        <div className="corners-plus-grid">
          {other.map((row) => (
            <div key={row.runnerName} className="sop-exp-no-goal-col">
              <div className="sop-exp-no-goal-col-head">
                <span className="sop-exp-no-goal-short">{row.runnerName}</span>
              </div>
              <OddsBox american={row.american} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function stoppageHeadline(stoppage) {
  if (!stoppage) return null;
  if (stoppage.expectedLabel) {
    if (stoppage.remainingLabel && stoppage.played) {
      return `${stoppage.expectedLabel} announced · ${stoppage.remainingLabel} left`;
    }
    return `${stoppage.expectedLabel} announced`;
  }
  if (stoppage.matchStatus && /half|live|started/i.test(stoppage.matchStatus)) {
    return 'Not announced yet';
  }
  return null;
}

function GameCard({ game }) {
  const [expanded, setExpanded] = useState(true);
  const stoppageText = stoppageHeadline(game.stoppage);
  const total = game.total;

  return (
    <article className={`sop-exp-game${expanded ? ' sop-exp-game--open' : ''}`}>
      <header className="sop-exp-game-header">
        <button
          type="button"
          className="sop-exp-game-toggle"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
        >
          <span className="sop-exp-game-chevron" aria-hidden="true">
            {expanded ? '▼' : '▶'}
          </span>
          <span className="sop-exp-game-toggle-main">
            <span className="sop-exp-game-title">{game.name}</span>
            <span className="sop-exp-game-meta">
              {game.inPlay && <span className="sop-exp-live">LIVE</span>}
              <span className="sop-exp-score">{game.scoreDisplay ?? '0-0'}</span>
              {game.stoppage?.clock && (
                <span className="corners-clock">{game.stoppage.clock}</span>
              )}
              {game.openDate && (
                <span className="sop-exp-time">{formatKickoff(game.openDate)}</span>
              )}
              {!expanded && total && (
                <span className="sop-exp-ev-badge">O/U {total.line}</span>
              )}
              {!expanded && stoppageText && (
                <span className="corners-stoppage-chip">{stoppageText}</span>
              )}
            </span>
          </span>
        </button>
      </header>

      {expanded && (
        <div className="sop-exp-game-body">
          {game.error && <p className="sop-exp-error">{game.error}</p>}

          <section className="corners-total">
            <div className="sop-exp-section-label">Total corners</div>
            {total ? (
              <div className="corners-total-row">
                <div className="corners-total-line">{total.line}</div>
                <OddsBox american={total.over?.american} label="Over" />
                <OddsBox american={total.under?.american} label="Under" />
              </div>
            ) : (
              <p className="corners-empty-hint">No total corners O/U on FanDuel.</p>
            )}
          </section>

          <WindowSection
            title="Next 5 min"
            windowMarket={game.next5}
            liveHint={!game.inPlay}
          />
          <WindowSection
            title="Next 10 min"
            windowMarket={game.next10}
            liveHint={!game.inPlay}
          />

          <section className="corners-stoppage">
            <div className="sop-exp-section-label">Expected stoppage</div>
            {!game.stoppage && (
              <p className="corners-empty-hint">
                {game.inPlay
                  ? 'No live timeline matched this game yet.'
                  : 'Shows up once the match is live and the 4th official board is out.'}
              </p>
            )}
            {game.stoppage && (
              <div className="corners-stoppage-card">
                <div className="corners-stoppage-main">
                  {game.stoppage.expectedLabel ?? '—'}
                </div>
                <div className="corners-stoppage-meta">
                  {game.stoppage.source === 'sportmonks' ? 'Sportmonks' : 'Sportradar'}
                  {formatMatchStatus(game.stoppage.matchStatus) && ` · ${formatMatchStatus(game.stoppage.matchStatus)}`}
                  {game.stoppage.clock && ` · ${game.stoppage.clock}`}
                  {game.stoppage.announced && ` · announced ${game.stoppage.announced}`}
                  {game.stoppage.played && ` · played ${game.stoppage.played}`}
                  {game.stoppage.remainingLabel && ` · ${game.stoppage.remainingLabel} remaining`}
                </div>
                {!game.stoppage.expectedLabel && (
                  <p className="corners-empty-hint">Not announced yet.</p>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </article>
  );
}

function CornersBookPanel({
  games,
  fetchedAt,
  error,
  notice,
  refreshing,
  loading = false,
  onRefresh,
}) {
  const [teamQuery, setTeamQuery] = useState('');
  const teamNames = useMemo(() => collectTeamNames(games), [games]);
  const filteredGames = useMemo(() => {
    if (!teamQuery.trim()) return games;
    return games.filter((g) => gameMatchesQuery(g, teamQuery));
  }, [games, teamQuery]);

  if (loading) {
    return (
      <LoadingState
        label="Loading Premier League corners…"
        ariaLabel="Loading Premier League corners"
        className="sop-book-loading"
      />
    );
  }

  return (
    <div className="sop-exp-content">
      <header className="sop-exp-header">
        <h1 className="sop-exp-title">PL Corners</h1>
        <p className="sop-exp-subtitle">
          Premier League · FanDuel totals + next 5/10
          {fetchedAt && (
            <span className="sop-exp-updated">
              {' '}
              · updated {new Date(fetchedAt).toLocaleTimeString()}
            </span>
          )}
        </p>
      </header>

      {notice && (
        <p className="sop-exp-dk-notice" role="status">
          {notice}
        </p>
      )}

      <div className="sop-exp-toolbar">
        <button
          type="button"
          className="sop-exp-refresh-btn"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh odds'}
        </button>
        <label className="sop-exp-search-wrap">
          <span className="sop-exp-search-label">Find game</span>
          <input
            type="search"
            className="sop-exp-search-input"
            list={TEAM_SEARCH_LIST_ID}
            value={teamQuery}
            onChange={(e) => setTeamQuery(e.target.value)}
            placeholder="Team name…"
            autoComplete="off"
          />
          <datalist id={TEAM_SEARCH_LIST_ID}>
            {teamNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
      </div>

      {teamQuery.trim() && (
        <p className="sop-exp-search-hint">
          {filteredGames.length} match{filteredGames.length === 1 ? '' : 'es'}
        </p>
      )}

      {error && <p className="sop-exp-error">{error}</p>}

      {!error && filteredGames.length > 0 && (
        <div className="sop-exp-games">
          {filteredGames.map((g) => (
            <GameCard key={g.eventId} game={g} />
          ))}
        </div>
      )}

      {!error && games.length > 0 && teamQuery.trim() && filteredGames.length === 0 && (
        <p className="sop-exp-status">No games match “{teamQuery.trim()}”.</p>
      )}

      {!error && games.length === 0 && (
        <p className="sop-exp-status">No Premier League games found on FanDuel.</p>
      )}

      <p className="sop-exp-footer">
        Auto-refreshes every {REFRESH_MS / 1000}s · 5/10-min corners are FanDuel Quick Bets
        (usually live-only) · stoppage from Sportradar, Sportmonks backup
      </p>
    </div>
  );
}

export default CornersBookPanel;
