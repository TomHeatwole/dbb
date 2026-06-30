/**
 * DK Book panel — live DraftKings World Cup First Goal Method +EV scanner.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  analyzeAgainstBreakeven,
  computeBreakevenOdds,
  DEFAULT_NO_GOAL_SOURCE,
  formatAmericanOdds,
  GOAL_TYPE_META,
  NO_GOAL_SOURCE_KEYS,
} from '../sop/sopModel';

const REFRESH_MS = 60_000;
const TEAM_SEARCH_LIST_ID = 'dk-book-team-search';

const NO_GOAL_SOURCES = [
  {
    key: NO_GOAL_SOURCE_KEYS.nextGoalMethod,
    short: 'Goal Method',
    desc: '1st Goal Method → No Goal (DraftKings)',
  },
  {
    key: NO_GOAL_SOURCE_KEYS.correctScore,
    short: 'Correct Score',
    desc: 'Correct Score → current scoreline',
  },
  {
    key: NO_GOAL_SOURCE_KEYS.totalGoalsUnder,
    short: 'Total U',
    desc: 'Total Goals O/U → Under current total',
  },
  {
    key: NO_GOAL_SOURCE_KEYS.nthGoalNeither,
    short: 'Nth Goal',
    desc: 'Team to Score Nth Goal → Neither / No Goals',
  },
  {
    key: NO_GOAL_SOURCE_KEYS.nextGoalscorer,
    short: 'Next Scorer',
    desc: 'Next Goalscorer → No Goalscorer',
  },
];

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

function noGoalLabel(sourceKey, quote) {
  if (!quote) return '—';
  if (sourceKey === NO_GOAL_SOURCE_KEYS.correctScore && quote.scoreUsed) {
    return quote.scoreUsed;
  }
  if (sourceKey === NO_GOAL_SOURCE_KEYS.totalGoalsUnder && quote.line != null) {
    return `U ${quote.line}`;
  }
  if (sourceKey === NO_GOAL_SOURCE_KEYS.nthGoalNeither && quote.goalNumber) {
    return quote.selection ?? `G${quote.goalNumber}`;
  }
  if (sourceKey === NO_GOAL_SOURCE_KEYS.nextGoalscorer) {
    return quote.selection ?? 'No Goalscorer';
  }
  return quote.selection ?? 'No Goal';
}

function gameMatchesQuery(game, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const parts = [
    game.name,
    game.teams?.home,
    game.teams?.away,
    ...(String(game.name ?? '').split(/\s+@\s+|\s+v\s+/i)),
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
    for (const part of String(game.name ?? '').split(/\s+@\s+|\s+v\s+/i)) {
      const trimmed = part.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function countEvBets(game, selectedNoGoalSource) {
  const activeNoGoal = game.noGoalMarkets?.[selectedNoGoalSource];
  const noGoalAmerican = activeNoGoal?.american ?? null;
  if (noGoalAmerican == null || !game.goalTypes) return 0;
  const model = computeBreakevenOdds(noGoalAmerican);
  if (!model) return 0;
  return GOAL_TYPE_META.filter(({ key }) => {
    const bookAmerican = game.goalTypes[key]?.american;
    const breakeven = model[key]?.american;
    return analyzeAgainstBreakeven(bookAmerican, breakeven)?.profitable;
  }).length;
}

function hasNoGoalProxies(game) {
  return NO_GOAL_SOURCES.some((s) => game.noGoalMarkets?.[s.key]?.american != null);
}

function GameCard({ game, selectedNoGoalSource, onSelectNoGoalSource }) {
  const [expanded, setExpanded] = useState(true);

  const activeNoGoal = game.noGoalMarkets?.[selectedNoGoalSource];
  const noGoalAmerican = activeNoGoal?.american ?? null;

  const model = useMemo(
    () => (noGoalAmerican != null ? computeBreakevenOdds(noGoalAmerican) : null),
    [noGoalAmerican],
  );

  const goalAnalyses = useMemo(() => {
    if (!model) return [];
    return GOAL_TYPE_META.map(({ key, label, fdRunner }) => {
      const bookAmerican = game.goalTypes?.[key]?.american ?? null;
      const breakeven = model[key];
      const analysis = analyzeAgainstBreakeven(bookAmerican, breakeven?.american);
      return {
        key,
        label,
        fdRunner,
        bookAmerican,
        breakevenAmerican: breakeven?.american ?? null,
        breakevenImplied: breakeven?.implied ?? null,
        analysis,
      };
    });
  }, [game.goalTypes, model]);

  const evCount = goalAnalyses.filter((row) => row.analysis?.profitable).length;

  return (
    <article className={`sop-exp-game${expanded ? ' sop-exp-game--open' : ''}${evCount > 0 ? ' sop-exp-game--has-ev' : ''}`}>
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
              {game.openDate && (
                <span className="sop-exp-time">{formatKickoff(game.openDate)}</span>
              )}
              {game.dkEventId && (
                <span className="sop-exp-dk-id" title="DraftKings event ID">
                  #{game.dkEventId}
                </span>
              )}
              {!expanded && evCount > 0 && (
                <span className="sop-exp-ev-badge">{evCount} +EV</span>
              )}
            </span>
          </span>
        </button>
      </header>

      {expanded && (
        <div className="sop-exp-game-body">
          {game.error && (
            <p className={`sop-exp-status sop-exp-error${game.errorCode === 'event_not_found' ? ' sop-exp-error--soft' : ''}`}>
              {game.error}
            </p>
          )}

          {!game.goalTypes && !game.error && game.dkEventId && (
            <p className="sop-exp-status">DraftKings goal-method odds not loaded — no-goal proxies may still be available below.</p>
          )}

          {!game.goalTypes && !game.error && !game.dkEventId && (
            <p className="sop-exp-status">No First Goal Method market on DraftKings for this match.</p>
          )}

          {(game.goalTypes || hasNoGoalProxies(game)) && (
            <>
              {game.marketName && (
                <div className="sop-exp-market-name">DK market: {game.marketName}</div>
              )}

              <section className="sop-exp-no-goal">
                <div className="sop-exp-section-label">No Goal proxy</div>
                <div className="sop-exp-no-goal-grid">
                  {NO_GOAL_SOURCES.map(({ key, short, desc }) => {
                    const quote = game.noGoalMarkets?.[key];
                    const selected = selectedNoGoalSource === key;
                    const hasOdds = quote?.american != null;
                    const proxyBook = game.noGoalProxySources?.[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`sop-exp-no-goal-btn${selected ? ' sop-exp-no-goal-btn--selected' : ''}${!hasOdds ? ' sop-exp-no-goal-btn--missing' : ''}`}
                        onClick={() => onSelectNoGoalSource(game.eventId, key)}
                        disabled={!hasOdds}
                        title={desc}
                      >
                        <span className="sop-exp-no-goal-short">
                          {short}
                          {proxyBook && (
                            <span className={`sop-exp-proxy-tag sop-exp-proxy-tag--${proxyBook}`}>
                              {proxyBook.toUpperCase()}
                            </span>
                          )}
                        </span>
                        <span className="sop-exp-no-goal-pick">{noGoalLabel(key, quote)}</span>
                        <span className="sop-exp-no-goal-odds">
                          {hasOdds ? formatAmericanOdds(quote.american) : '—'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {activeNoGoal?.market && (
                  <div className="sop-exp-no-goal-detail">
                    Using {activeNoGoal.market}
                    {activeNoGoal.selection ? ` · ${activeNoGoal.selection}` : ''}
                    {model && (
                      <span>
                        {' '}
                        · {(model.noGoalProb * 100).toFixed(1)}% no goal implied
                      </span>
                    )}
                  </div>
                )}
              </section>

              <section className="sop-exp-goals">
                <div className="sop-exp-section-label">Goal types vs breakeven</div>
                {!model && (
                  <p className="sop-exp-status">Select a no-goal market with odds to run the model.</p>
                )}
                {model && (
                  <ul className="sop-exp-goal-list">
                    {goalAnalyses.map((row) => {
                      const profitable = row.analysis?.profitable;
                      const edge = row.analysis?.edgePoints;
                      return (
                        <li
                          key={row.key}
                          className={`sop-exp-goal-row${profitable ? ' sop-exp-goal-row--ev' : ''}`}
                        >
                          <div className="sop-exp-goal-label">{row.label}</div>
                          <div className="sop-exp-goal-fd">
                            <span className="sop-exp-goal-fd-val">
                              {row.bookAmerican != null ? formatAmericanOdds(row.bookAmerican) : '—'}
                            </span>
                            <span className="sop-exp-goal-fd-tag">DK</span>
                          </div>
                          <div className="sop-exp-goal-breakeven">
                            {row.breakevenAmerican != null ? (
                              <>
                                <span>{formatAmericanOdds(row.breakevenAmerican)}</span>
                                <span className="sop-exp-goal-be-tag">breakeven</span>
                              </>
                            ) : (
                              '—'
                            )}
                          </div>
                          <div className="sop-exp-goal-edge">
                            {profitable && edge != null ? (
                              <span className="sop-exp-edge-plus">+{edge.toFixed(1)}% edge</span>
                            ) : row.breakevenAmerican != null ? (
                              <span className="sop-exp-edge-need">
                                need {formatAmericanOdds(row.breakevenAmerican)}+
                              </span>
                            ) : (
                              '—'
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function DKBookPanel({ games, stats, eventMapUpdatedAt, fetchedAt, error, loading, refreshing, onRefresh }) {
  const [noGoalSourceByEvent, setNoGoalSourceByEvent] = useState({});
  const [teamQuery, setTeamQuery] = useState('');
  const [evOnly, setEvOnly] = useState(false);

  const teamNames = useMemo(() => collectTeamNames(games), [games]);

  const getNoGoalSource = useCallback(
    (game) => {
      const picked = noGoalSourceByEvent[game.eventId];
      if (picked && game.noGoalMarkets?.[picked]?.american != null) return picked;
      if (game.noGoalMarkets?.[DEFAULT_NO_GOAL_SOURCE]?.american != null) {
        return DEFAULT_NO_GOAL_SOURCE;
      }
      const fallback = NO_GOAL_SOURCES.find(
        (s) => game.noGoalMarkets?.[s.key]?.american != null,
      );
      return fallback?.key ?? DEFAULT_NO_GOAL_SOURCE;
    },
    [noGoalSourceByEvent],
  );

  const handleSelectNoGoalSource = useCallback((eventId, sourceKey) => {
    setNoGoalSourceByEvent((prev) => ({ ...prev, [eventId]: sourceKey }));
  }, []);

  const filteredGames = useMemo(() => {
    let list = games;
    if (teamQuery.trim()) {
      list = list.filter((g) => gameMatchesQuery(g, teamQuery));
    }
    if (evOnly) {
      list = list.filter((g) => countEvBets(g, getNoGoalSource(g)) > 0);
    }
    return list;
  }, [games, teamQuery, evOnly, getNoGoalSource]);

  const summary = stats ?? {
    total: games.length,
    withOdds: games.filter((g) => g.goalTypes).length,
    withEventId: games.filter((g) => g.dkEventId).length,
    missingEventId: games.filter((g) => !g.dkEventId).length,
    totalEvBets: 0,
  };

  return (
    <div className="sop-exp-content">
      <header className="sop-exp-header">
        <h1 className="sop-exp-title">DK First Goal Method</h1>
        <p className="sop-exp-subtitle">
          FIFA World Cup 2026 · upcoming matches only
          {fetchedAt && (
            <span className="sop-exp-updated">
              {' '}
              · updated {new Date(fetchedAt).toLocaleTimeString()}
            </span>
          )}
        </p>
      </header>

      <div className="sop-exp-summary" role="status">
        <span className="sop-exp-summary-chip">
          <strong>{summary.withOdds}</strong>/{summary.total} with DK odds
        </span>
        <span className="sop-exp-summary-chip">
          <strong>{summary.withEventId}</strong> event IDs matched
        </span>
        {summary.totalEvBets > 0 && (
          <span className="sop-exp-summary-chip sop-exp-summary-chip--ev">
            <strong>{summary.totalEvBets}</strong> +EV bets
          </span>
        )}
        {summary.missingEventId > 0 && (
          <span className="sop-exp-summary-chip sop-exp-summary-chip--warn">
            {summary.missingEventId} unmatched
          </span>
        )}
      </div>

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
        <label className="sop-exp-ev-filter">
          <input
            type="checkbox"
            checked={evOnly}
            onChange={(e) => setEvOnly(e.target.checked)}
          />
          +EV only
        </label>
      </div>

      {teamQuery.trim() && (
        <p className="sop-exp-search-hint">
          {filteredGames.length} match{filteredGames.length === 1 ? '' : 'es'}
        </p>
      )}

      {error && <p className="sop-exp-error">{error}</p>}

      {loading && !error && (
        <p className="sop-exp-status sop-exp-status--info">Loading World Cup schedule and DraftKings odds…</p>
      )}

      {!loading && !error && summary.withOdds === 0 && summary.withEventId > 0 && (
        <p className="sop-exp-status sop-exp-status--info">
          {summary.withEventId} DraftKings matches found but odds could not be loaded
          {summary.missingEventId > 0 ? ` (${summary.missingEventId} still unmatched)` : ''}.
          This often happens when DraftKings blocks the server IP — try Refresh.
        </p>
      )}

      {!loading && !error && filteredGames.length > 0 && (
        <div className="sop-exp-games">
          {filteredGames.map((g) => (
            <GameCard
              key={g.eventId ?? g.name}
              game={g}
              selectedNoGoalSource={getNoGoalSource(g)}
              onSelectNoGoalSource={handleSelectNoGoalSource}
            />
          ))}
        </div>
      )}

      {!loading && !error && games.length > 0 && (teamQuery.trim() || evOnly) && filteredGames.length === 0 && (
        <p className="sop-exp-status">
          {evOnly ? 'No +EV bets with current filters.' : `No games match “${teamQuery.trim()}”.`}
        </p>
      )}

      {!loading && !error && games.length === 0 && (
        <p className="sop-exp-status">
          No World Cup games on the schedule. Is <code>npm run api</code> running on port 3001?
        </p>
      )}

      <footer className="sop-exp-footer">
        Auto-refreshes every {REFRESH_MS / 1000}s · goal odds from DK · no-goal proxies may use FanDuel
        {eventMapUpdatedAt && (
          <span> · event map {new Date(eventMapUpdatedAt).toLocaleDateString()}</span>
        )}
      </footer>
    </div>
  );
}

export default DKBookPanel;
