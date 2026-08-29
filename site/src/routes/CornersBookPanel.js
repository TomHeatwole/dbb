/**
 * Corners book tab — FanDuel Premier League totals, next 5/10 min, stoppage.
 */

import React, { useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import {
  evaluateGameCorners,
  formatAmericanOdds,
  formatEdgePct,
  formatExpected,
  formatSharePct,
} from '../corners/cornerModel';

const REFRESH_MS = 60_000;
const TEAM_SEARCH_LIST_ID = 'corners-book-team-search';
const BUCKETED_KEY = 'corners-bucketed';
const SHOW_WORK_KEY = 'corners-show-work';

function readFlag(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    if (v == null) return fallback;
    return v === '1' || v === 'true';
  } catch {
    return fallback;
  }
}

function writeFlag(key, value) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

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

function Toggle({ label, checked, onChange, hint, compact }) {
  return (
    <label className={`sop-kelly-toggle${compact ? ' corners-toggle--compact' : ''}`} title={hint}>
      <span className="sop-kelly-toggle-label">{label}</span>
      <span className="sop-kelly-switch">
        <input
          type="checkbox"
          className="sop-kelly-switch-input"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="sop-kelly-switch-track" aria-hidden="true">
          <span className="sop-kelly-switch-thumb" />
        </span>
      </span>
    </label>
  );
}

function BetButton({ bet, selected, onSelect }) {
  const hasOdds = bet.american != null;
  const baseline = Boolean(bet.baseline);
  const profitable = !baseline && Boolean(bet.profitable);
  const edge = baseline ? null : bet.analysis?.edgePoints;
  const className = [
    'corners-bet',
    profitable ? 'corners-bet--ev' : '',
    selected ? 'corners-bet--selected' : '',
    baseline ? 'corners-bet--baseline' : '',
    !hasOdds ? 'corners-bet--empty' : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={className}
      title="Show my work"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(bet.id);
      }}
      aria-pressed={selected}
    >
      <span className="corners-bet-label">{bet.label}</span>
      <span className="corners-bet-odds">
        {hasOdds ? formatAmericanOdds(bet.american) : '—'}
      </span>
      {baseline && (
        <span className="corners-bet-tag">line</span>
      )}
      {edge != null && (
        <span className={profitable ? 'sop-exp-edge-plus' : 'sop-exp-edge-minus'}>
          {formatEdgePct(edge)}
        </span>
      )}
    </button>
  );
}

function bucketLabel(id, kind) {
  if (kind === 'ht+' || id === '45+') return '45+ HT extra';
  if (kind === 'ft+' || id === '90+') return '90+ FT extra';
  return id;
}

function WindowSection({ title, packed, selectedId, onSelect, bucketed }) {
  const windowMarket = packed?.windowMarket;
  const win = packed?.win;
  const plus = windowMarket?.plus ?? [];
  const overUnder = windowMarket?.overUnder ?? [];
  const other = windowMarket?.other ?? [];
  const hasLines = plus.length + overUnder.length + other.length > 0;
  const bets = packed?.bets ?? [];
  const byLabel = new Map(bets.map((b) => [b.label, b]));

  const histPct = win ? formatSharePct(win.histWindowShare) : null;
  const uniPct = win ? formatSharePct(win.uniformWindowShare) : null;

  return (
    <section className="corners-window">
      <div className="sop-exp-section-label">
        {title}
        {windowMarket?.window && (
          <span className="corners-window-range"> {windowMarket.window}</span>
        )}
        {packed && Number.isFinite(packed.lambda) && (
          <span className="corners-window-lambda">
            E[win] {formatExpected(packed.lambda)}
          </span>
        )}
      </div>
      {histPct && (
        <p className="corners-bucket-share">
          This window is usually <strong>{histPct}</strong> of corners
          {' '}vs <strong>{uniPct}</strong> uniform
          {bucketed ? ' · using bucketed rates' : ' · using uniform per minute'}
        </p>
      )}
      {!hasLines && (
        <p className="corners-empty-hint">
          No Match Outcomes 5/10-min window on FanDuel Quick Bets yet.
        </p>
      )}
      {plus.length > 0 && (
        <div className="corners-plus-grid">
          {plus.map((row) => {
            const bet = byLabel.get(`${row.n}+`);
            if (!bet) return null;
            return (
              <BetButton
                key={bet.id}
                bet={bet}
                selected={selectedId === bet.id}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      )}
      {overUnder.length > 0 && (
        <div className="corners-ou-row">
          {overUnder.map((row) => {
            const label = `${row.side === 'over' ? 'O' : 'U'} ${row.line}`;
            const bet = byLabel.get(label);
            if (!bet) return null;
            return (
              <BetButton
                key={bet.id}
                bet={bet}
                selected={selectedId === bet.id}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      )}
      {other.length > 0 && bets.length === 0 && (
        <p className="corners-empty-hint">Non-total corner runners are not priced by the model.</p>
      )}
    </section>
  );
}

function WorkPanel({ model, selectedId }) {
  const bet = model.bets.find((b) => b.id === selectedId);
  if (!bet) return null;
  const h1Scope = bet.kind.startsWith('h1');
  const sourceRows = h1Scope ? model.h1Breakdown.rows : model.breakdown.rows;
  const futureRows = sourceRows.filter((r) => r.minutes > 0.02 && (!h1Scope || r.half === 1));
  const winBits = bet.kind.startsWith('next5')
    ? model.next5?.win?.bits
    : bet.kind.startsWith('next10')
      ? model.next10?.win?.bits
      : null;
  const lambdaWin = bet.meta?.lambda
    ?? (bet.kind.startsWith('next5') ? model.next5?.lambda : model.next10?.lambda);
  const need = bet.meta?.need;
  const implied = h1Scope ? model.halfImplied : model.fullImplied;
  const ourLambda = h1Scope ? model.ourH1Remaining : model.ourRemaining;
  const stoppageUsed = h1Scope ? model.h1Plan.used : model.plan.used;
  const scale = model.ourRemaining > 0
    ? (model.lineRemaining ?? model.ourRemaining) / model.ourRemaining
    : 1;

  return (
    <div className="corners-work">
      <div className="sop-exp-section-label">Show my work · {bet.label}</div>
      <p className={`corners-work-verdict${bet.profitable ? ' corners-work-verdict--ev' : ''}`}>
        {bet.baseline
          ? 'Game line · baseline, not a bet'
          : bet.profitable
            ? 'Good bet'
            : 'No edge'}
        {!bet.baseline && bet.analysis?.edgePoints != null && ` · ${formatEdgePct(bet.analysis.edgePoints)} vs FanDuel`}
      </p>
      <ul className="corners-work-list">
        <li>
          FanDuel {h1Scope ? 'H1' : 'total'} {implied?.line}
          {implied && ` · vig-removed P(over) ${formatSharePct(implied.pOver)}`}
          {' → implies '}
          <strong>{formatExpected(implied?.impliedTotal)}</strong>
          {' total ('}
          {formatExpected(h1Scope ? (implied?.cornersSoFar ?? 0) : model.cornersSoFar, 0)} already
          {implied?.remaining != null && ` · ${formatExpected(implied.remaining)} more from the line`}
          )
        </li>
        {!bet.baseline && Number.isFinite(bet.meta?.fracOfRemaining) && (
          <li>
            This window is <strong>{formatSharePct(bet.meta.fracOfRemaining)}</strong> of remaining
            {' '}× line remaining {formatExpected(bet.meta.lineRemaining ?? model.lineRemaining)}
            {' → '}E[win] <strong>{formatExpected(lambdaWin)}</strong>
          </li>
        )}
        <li>
          Our remaining <strong>{formatExpected(ourLambda)}</strong>
          {' '}({model.mode}, kickoff mean {formatExpected(model.meanKickoff)})
          {Number.isFinite(need) && ` · need ${need} more for the over`}
        </li>
        <li>Stoppage: {stoppageUsed}</li>
        {!bet.baseline && (
          <li>
            Model P({bet.label}) {formatSharePct(bet.pModel)}
            {' · '}fair {bet.fairAmerican != null ? formatAmericanOdds(bet.fairAmerican) : '—'}
            {' · '}FD {bet.american != null ? formatAmericanOdds(bet.american) : '—'}
            {' · '}implied {formatSharePct(bet.pMarket)}
          </li>
        )}
      </ul>
      {winBits?.length > 0 && (
        <>
          <div className="corners-work-sub">This window (incl. extra time)</div>
          <table className="corners-work-table">
            <thead>
              <tr>
                <th>Bucket</th>
                <th>Min left</th>
                <th>E[corners]</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {winBits.map((b) => (
                <tr key={b.id}>
                  <td>{bucketLabel(b.id, b.extra ? (b.id === '45+' ? 'ht+' : 'ft+') : 'regular')}</td>
                  <td>{formatExpected(b.minutes, 1)}</td>
                  <td>{formatExpected((b.expected ?? 0) * scale)}</td>
                  <td>{formatSharePct(b.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="corners-work-sub">Remaining buckets (incl. extra time)</div>
      <table className="corners-work-table">
        <thead>
          <tr>
            <th>Bucket</th>
            <th>Min left</th>
            <th>E[corners]</th>
            <th>P(≥1)</th>
            <th>Usual %</th>
          </tr>
        </thead>
        <tbody>
          {futureRows.map((r) => (
            <tr key={r.id}>
              <td>{bucketLabel(r.id, r.kind)}</td>
              <td>{formatExpected(r.minutes, 1)}</td>
              <td>{formatExpected((r.expected ?? 0) * scale)}</td>
              <td>{formatSharePct(1 - Math.exp(-((r.expected ?? 0) * scale)))}</td>
              <td>{formatSharePct(r.histShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stoppageHeadline(stoppage, clock) {
  if (clock?.halftime || stoppage?.halfTime) {
    return 'HT · typical SH stoppage 4.8′';
  }
  if (!stoppage) return null;
  if (stoppage.expectedLabel) {
    if (stoppage.remainingLabel && stoppage.played && stoppage.status === 'in') {
      const kind = stoppage.announced ? 'announced' : 'estimated';
      return `${stoppage.expectedLabel} ${kind} · ${stoppage.remainingLabel} left`;
    }
    if (stoppage.status === 'post') {
      return `${stoppage.played || stoppage.expectedLabel} played`;
    }
    return `${stoppage.expectedLabel} ${stoppage.announced ? 'announced' : 'estimated'}`;
  }
  if (stoppage.matchStatus && /half|live|started|in play/i.test(stoppage.matchStatus)) {
    return 'Estimating from play-by-play…';
  }
  return null;
}

function GameCard({ game, bucketed, showWork, onEnableShowWork }) {
  const [expanded, setExpanded] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const model = useMemo(
    () => evaluateGameCorners(game, { bucketed }),
    [game, bucketed],
  );
  const stoppageText = stoppageHeadline(game.stoppage, model.clock);
  const totalBets = model.bets.filter((b) => b.kind === 'total-over' || b.kind === 'total-under');
  const h1Bets = model.bets.filter((b) => b.kind === 'h1-over' || b.kind === 'h1-under');
  const atHalf = Boolean(model.clock.halftime || game.stoppage?.halfTime);

  const selectBet = (id) => {
    if (!showWork) onEnableShowWork?.();
    setSelectedId((cur) => (cur === id ? null : id));
  };

  useEffect(() => {
    setSelectedId(null);
  }, [game.eventId, bucketed]);

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
              {(atHalf || game.stoppage?.clock) && (
                <span className="corners-clock">{atHalf ? 'HT' : game.stoppage.clock}</span>
              )}
              {game.openDate && (
                <span className="sop-exp-time">{formatKickoff(game.openDate)}</span>
              )}
              {model.evCount > 0 && (
                <span className="sop-exp-ev-badge">{model.evCount} +EV</span>
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

          <section className="corners-implied">
            <div className="sop-exp-section-label">Expected corners from the line</div>
            <div className="corners-implied-main">
              {model.marketImpliedTotal != null ? (
                <>
                  <span className="corners-implied-lambda">
                    {formatExpected(model.marketImpliedTotal)}
                  </span>
                  <span className="corners-implied-copy">
                    FanDuel total {game.total?.line}
                    {game.total?.over?.american != null && (
                      <> · Over {formatAmericanOdds(game.total.over.american)}</>
                    )}
                    {game.total?.under?.american != null && (
                      <> / Under {formatAmericanOdds(game.total.under.american)}</>
                    )}
                    {model.fullImplied && ` · P(over) ${formatSharePct(model.fullImplied.pOver)} vig-removed`}
                    {' · '}{formatExpected(model.cornersSoFar, 0)} already
                    {model.lineRemaining != null && ` · ${formatExpected(model.lineRemaining)} more from the line`}
                  </span>
                </>
              ) : (
                <p className="corners-empty-hint">No total corners O/U on FanDuel to invert.</p>
              )}
            </div>
            {model.halfImplied && (
              <p className="corners-implied-copy">
                H1 line {game.firstHalfTotal?.line} implies{' '}
                <strong>{formatExpected(model.halfImplied.impliedTotal)}</strong>
                {game.firstHalfTotal?.over?.american != null && (
                  <> · Over {formatAmericanOdds(game.firstHalfTotal.over.american)}</>
                )}
                {game.firstHalfTotal?.under?.american != null && (
                  <> / Under {formatAmericanOdds(game.firstHalfTotal.under.american)}</>
                )}
              </p>
            )}
            <p className="corners-implied-ours">
              Next 5/10 use the line remaining, split by {model.mode} timing
              {' · '}{formatExpected(model.breakdown.remainingMinutes, 1)} min left incl. extra time
            </p>
          </section>

          <section className="corners-total">
            <div className="sop-exp-section-label">Game line (baseline)</div>
            {totalBets.length > 0 ? (
              <div className="corners-ou-row">
                {totalBets.map((bet) => (
                  <BetButton
                    key={bet.id}
                    bet={bet}
                    selected={selectedId === bet.id}
                    onSelect={selectBet}
                  />
                ))}
              </div>
            ) : (
              <p className="corners-empty-hint">No total corners O/U on FanDuel.</p>
            )}
          </section>

          {h1Bets.length > 0 && (
            <section className="corners-total">
              <div className="sop-exp-section-label">1st half line (baseline)</div>
              <div className="corners-ou-row">
                {h1Bets.map((bet) => (
                  <BetButton
                    key={bet.id}
                    bet={bet}
                    selected={selectedId === bet.id}
                    onSelect={selectBet}
                  />
                ))}
              </div>
            </section>
          )}

          <WindowSection
            title="Next 5 min"
            packed={model.next5}
            selectedId={selectedId}
            onSelect={selectBet}
            bucketed={bucketed}
          />
          <WindowSection
            title="Next 10 min"
            packed={model.next10}
            selectedId={selectedId}
            onSelect={selectBet}
            bucketed={bucketed}
          />

          {selectedId && (
            <WorkPanel model={model} selectedId={selectedId} />
          )}

          <section className="corners-stoppage">
            <div className="sop-exp-section-label">Expected stoppage</div>
            {!game.stoppage && (
              <p className="corners-empty-hint">
                {game.inPlay
                  ? 'No ESPN play-by-play matched this game yet. Using typical HT 3.3′ / FT 4.8′.'
                  : 'Estimated from ESPN play-by-play once the match is live. Pre-match uses typical HT 3.3′ + FT 4.8′.'}
              </p>
            )}
            {game.stoppage && (
              <div className="corners-stoppage-card">
                <div className="corners-stoppage-main">
                  {atHalf ? '4.8′' : (game.stoppage.expectedLabel ?? '—')}
                </div>
                <div className="corners-stoppage-meta">
                  {atHalf
                    ? 'Half-time · first-half extra is done · second-half stoppage resets to typical 4.8′'
                    : model.plan.used}
                  {!atHalf && formatMatchStatus(game.stoppage.matchStatus) && ` · ${formatMatchStatus(game.stoppage.matchStatus)}`}
                  {!atHalf && game.stoppage.clock && ` · ${game.stoppage.clock}`}
                  {!atHalf && game.stoppage.announced && ` · announced ${game.stoppage.announced}`}
                  {!atHalf && game.stoppage.played && ` · played ${game.stoppage.played}`}
                  {!atHalf && game.stoppage.status === 'in' && game.stoppage.remainingLabel && ` · ${game.stoppage.remainingLabel} remaining`}
                </div>
                {!atHalf && game.stoppage.breakdownLabel && (
                  <p className="corners-empty-hint">{game.stoppage.breakdownLabel}</p>
                )}
                {atHalf && (
                  <p className="corners-empty-hint">{game.stoppage.breakdownLabel || 'H1 extra finished'}</p>
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
  const [bucketed, setBucketed] = useState(() => readFlag(BUCKETED_KEY, true));
  const [showWork, setShowWork] = useState(() => readFlag(SHOW_WORK_KEY, true));
  const teamNames = useMemo(() => collectTeamNames(games), [games]);
  const filteredGames = useMemo(() => {
    if (!teamQuery.trim()) return games;
    return games.filter((g) => gameMatchesQuery(g, teamQuery));
  }, [games, teamQuery]);

  const setBucketedPersist = (v) => {
    setBucketed(v);
    writeFlag(BUCKETED_KEY, v);
  };
  const setShowWorkPersist = (v) => {
    setShowWork(v);
    writeFlag(SHOW_WORK_KEY, v);
  };

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

      <section className="sop-book-settings corners-settings" aria-label="Corners model settings">
        <Toggle
          label="Bucketed timing"
          checked={bucketed}
          onChange={setBucketedPersist}
          hint="On: ESPN 5-minute histogram. Off: uniform per minute including typical stoppage."
        />
        <Toggle
          label="Show my work"
          checked={showWork}
          onChange={setShowWorkPersist}
          compact
          hint="Click a line to see remaining buckets, extra time, and the Poisson math."
        />
      </section>
      <p className="corners-bucket-legend">
        5-min slice is usually vs uniform on each window below.
        {' '}90+ is <strong>7.42%</strong> of corners vs <strong>4.89%</strong> uniform
        (4.8′ / 98.1′). HT extra is <strong>3.57%</strong> vs <strong>3.36%</strong>.
      </p>

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
            <GameCard
              key={g.eventId}
              game={g}
              bucketed={bucketed}
              showWork={showWork}
              onEnableShowWork={() => setShowWorkPersist(true)}
            />
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
        Match Outcomes · stoppage estimated from ESPN play-by-play
      </p>
    </div>
  );
}

export default CornersBookPanel;
