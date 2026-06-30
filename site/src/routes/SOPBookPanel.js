/**
 * SOP Book tab — live FanDuel World Cup +EV scanner.
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
const TEAM_SEARCH_LIST_ID = 'sop-book-team-search';

const NO_GOAL_SOURCES = [
  {
    key: NO_GOAL_SOURCE_KEYS.nextGoalMethod,
    short: 'Next Goal',
    desc: 'Next Goal Method → No Goal',
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

function shouldShowDkNoGoal(game) {
  if (!game.dk) return false;
  // Keep DK no-goal row during live when this fixture is mapped on DraftKings.
  if (game.inPlay) {
    return game.dk.errorCode !== 'event_not_found';
  }
  return true;
}

function quoteForNoGoalPick(game, sourceKey, book) {
  if (book === 'dk') return game.dk?.noGoalMarkets?.[sourceKey];
  return game.noGoalMarkets?.[sourceKey];
}

function noGoalPickHasOdds(game, pick) {
  if (!pick?.sourceKey || !pick?.book) return false;
  return quoteForNoGoalPick(game, pick.sourceKey, pick.book)?.american != null;
}

function GameCard({ game, selectedNoGoalPick, onSelectNoGoalPick }) {
  const [expanded, setExpanded] = useState(true);
  const showDkGoals = !game.inPlay && Boolean(game.dk);
  const showDkNoGoal = shouldShowDkNoGoal(game);

  const selectedSourceKey = selectedNoGoalPick?.sourceKey;
  const selectedBook = selectedNoGoalPick?.book ?? 'fd';

  const activeNoGoal = quoteForNoGoalPick(game, selectedSourceKey, selectedBook);
  const noGoalAmerican = activeNoGoal?.american ?? null;

  const model = useMemo(
    () => (noGoalAmerican != null ? computeBreakevenOdds(noGoalAmerican) : null),
    [noGoalAmerican],
  );

  const goalAnalyses = useMemo(() => {
    if (!model) return [];
    return GOAL_TYPE_META.map(({ key, label, fdRunner }) => {
      const fdAmerican = game.goalTypes?.[key]?.american ?? null;
      const dkAmerican = showDkGoals ? game.dk?.goalTypes?.[key]?.american ?? null : null;
      const breakeven = model[key];
      const fdAnalysis = analyzeAgainstBreakeven(fdAmerican, breakeven?.american);
      const dkAnalysis = showDkGoals
        ? analyzeAgainstBreakeven(dkAmerican, breakeven?.american)
        : null;

      const fdProfitable = Boolean(fdAnalysis?.profitable);
      const dkProfitable = Boolean(dkAnalysis?.profitable);
      const fdEdge = fdAnalysis?.edgePoints ?? -Infinity;
      const dkEdge = dkAnalysis?.edgePoints ?? -Infinity;

      let highlightFd = false;
      let highlightDk = false;
      if (fdProfitable && dkProfitable) {
        if (fdEdge >= dkEdge) highlightFd = true;
        else highlightDk = true;
      } else if (fdProfitable) {
        highlightFd = true;
      } else if (dkProfitable) {
        highlightDk = true;
      }

      const bestEdge = highlightFd ? fdEdge : highlightDk ? dkEdge : null;

      const edgeCandidates = [];
      if (fdAmerican != null && fdAnalysis?.edgePoints != null) {
        edgeCandidates.push({ edge: fdAnalysis.edgePoints, book: 'fd' });
      }
      if (dkAmerican != null && dkAnalysis?.edgePoints != null) {
        edgeCandidates.push({ edge: dkAnalysis.edgePoints, book: 'dk' });
      }
      const displayEdge = edgeCandidates.length
        ? edgeCandidates.reduce((best, cur) => (cur.edge > best.edge ? cur : best))
        : null;

      return {
        key,
        label,
        fdRunner,
        fdAmerican,
        dkAmerican,
        breakevenAmerican: breakeven?.american ?? null,
        breakevenImplied: breakeven?.implied ?? null,
        fdAnalysis,
        dkAnalysis,
        highlightFd,
        highlightDk,
        bestEdge,
        displayEdge,
      };
    });
  }, [game.goalTypes, game.dk?.goalTypes, model, showDkGoals]);

  const evCount = goalAnalyses.filter((row) => row.highlightFd || row.highlightDk).length;

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
              {game.openDate && (
                <span className="sop-exp-time">{formatKickoff(game.openDate)}</span>
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
          <section className="sop-exp-no-goal">
            <div className="sop-exp-section-label">No Goal proxy</div>
            <div className="sop-exp-no-goal-grid">
              {NO_GOAL_SOURCES.map(({ key, short, desc }) => {
                const quote = game.noGoalMarkets?.[key];
                const dkQuote = game.dk?.noGoalMarkets?.[key];
                const fdSelected = selectedSourceKey === key && selectedBook === 'fd';
                const dkSelected = selectedSourceKey === key && selectedBook === 'dk';
                const hasOdds = quote?.american != null;
                const hasDkOdds = dkQuote?.american != null;
                const pickLabel = noGoalLabel(key, quote);
                const dkPickLabel = noGoalLabel(key, dkQuote);
                return (
                  <div key={key} className="sop-exp-no-goal-col">
                    <div className="sop-exp-no-goal-col-head">
                      <span className="sop-exp-no-goal-short" title={desc}>
                        {short}
                      </span>
                      {pickLabel !== '—' && (
                        <span className="sop-exp-no-goal-pick">{pickLabel}</span>
                      )}
                      {hasDkOdds && dkPickLabel !== '—' && dkPickLabel !== pickLabel && (
                        <span className="sop-exp-no-goal-pick sop-exp-no-goal-pick--dk">
                          DK · {dkPickLabel}
                        </span>
                      )}
                    </div>
                    <div className="sop-exp-no-goal-stack">
                      <div className="sop-exp-no-goal-book">
                        <span className="sop-exp-book-label sop-exp-book-label--fd">FD</span>
                        <button
                          type="button"
                          className={`sop-exp-odds-box sop-exp-odds-box--fd${fdSelected ? ' sop-exp-odds-box--selected' : ''}${!hasOdds ? ' sop-exp-odds-box--missing' : ''}`}
                          onClick={() => onSelectNoGoalPick(game.eventId, key, 'fd')}
                          disabled={!hasOdds}
                          title={desc}
                        >
                          <span className="sop-exp-odds-box-val">
                            {hasOdds ? formatAmericanOdds(quote.american) : '—'}
                          </span>
                        </button>
                      </div>
                      {showDkNoGoal && (
                        <div className="sop-exp-no-goal-book">
                          <span className="sop-exp-book-label sop-exp-book-label--dk">DK</span>
                          <button
                            type="button"
                            className={`sop-exp-odds-box sop-exp-odds-box--dk${dkSelected ? ' sop-exp-odds-box--selected' : ''}${!hasDkOdds ? ' sop-exp-odds-box--missing' : ''}`}
                            onClick={() => onSelectNoGoalPick(game.eventId, key, 'dk')}
                            disabled={!hasDkOdds}
                            title={hasDkOdds ? `DraftKings · ${desc}` : 'DraftKings — no line'}
                          >
                            <span className="sop-exp-odds-box-val">
                              {hasDkOdds ? formatAmericanOdds(dkQuote.american) : '—'}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {activeNoGoal?.market && (
              <div className="sop-exp-no-goal-detail">
                Using {selectedBook === 'dk' ? 'DK' : 'FD'} · {activeNoGoal.market}
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
                {goalAnalyses.map((row) => (
                    <li
                      key={row.key}
                      className={`sop-exp-goal-row${showDkGoals ? ' sop-exp-goal-row--dual' : ''}`}
                    >
                      <div className="sop-exp-goal-label">{row.label}</div>
                      <div
                        className={
                          showDkGoals ? 'sop-exp-goal-books-pair' : 'sop-exp-goal-books-single'
                        }
                      >
                        <div
                          className={`sop-exp-goal-odds-box sop-exp-goal-odds-box--fd${row.highlightFd ? ' sop-exp-goal-odds-box--ev' : ''}`}
                        >
                          <span className="sop-exp-goal-odds-book">FD</span>
                          <span className="sop-exp-goal-odds-val">
                            {row.fdAmerican != null ? formatAmericanOdds(row.fdAmerican) : '—'}
                          </span>
                        </div>
                        {showDkGoals && (
                          <div
                            className={`sop-exp-goal-odds-box sop-exp-goal-odds-box--dk${row.highlightDk ? ' sop-exp-goal-odds-box--ev' : ''}`}
                          >
                            <span className="sop-exp-goal-odds-book">DK</span>
                            <span className="sop-exp-goal-odds-val">
                              {row.dkAmerican != null ? formatAmericanOdds(row.dkAmerican) : '—'}
                            </span>
                          </div>
                        )}
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
                        {(row.highlightFd || row.highlightDk) && row.bestEdge != null ? (
                          <span className="sop-exp-edge-plus">
                            +{row.bestEdge.toFixed(1)}% edge
                            {showDkGoals && (
                              <span
                                className={`sop-exp-edge-book${row.highlightDk ? ' sop-exp-edge-book--dk' : ''}`}
                              >
                                {' '}
                                {row.highlightDk ? 'DK' : 'FD'}
                              </span>
                            )}
                          </span>
                        ) : row.displayEdge != null ? (
                          <span className="sop-exp-edge-minus">
                            {row.displayEdge.edge.toFixed(1)}%
                            {showDkGoals && (
                              <span
                                className={`sop-exp-edge-book${row.displayEdge.book === 'dk' ? ' sop-exp-edge-book--dk' : ''}`}
                              >
                                {' '}
                                {row.displayEdge.book === 'dk' ? 'DK' : 'FD'}
                              </span>
                            )}
                          </span>
                        ) : (
                          '—'
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </article>
  );
}

function SOPBookPanel({ games, fetchedAt, error, dkNotice, refreshing, onRefresh }) {
  const [noGoalPickByEvent, setNoGoalPickByEvent] = useState({});
  const [teamQuery, setTeamQuery] = useState('');

  const teamNames = useMemo(() => collectTeamNames(games), [games]);

  const filteredGames = useMemo(() => {
    if (!teamQuery.trim()) return games;
    return games.filter((g) => gameMatchesQuery(g, teamQuery));
  }, [games, teamQuery]);

  const handleSelectNoGoalPick = useCallback((eventId, sourceKey, book) => {
    setNoGoalPickByEvent((prev) => ({ ...prev, [eventId]: { sourceKey, book } }));
  }, []);

  const getNoGoalPick = useCallback(
    (game) => {
      const picked = noGoalPickByEvent[game.eventId];
      if (noGoalPickHasOdds(game, picked)) return picked;

      if (game.noGoalMarkets?.[DEFAULT_NO_GOAL_SOURCE]?.american != null) {
        return { sourceKey: DEFAULT_NO_GOAL_SOURCE, book: 'fd' };
      }

      const fdFallback = NO_GOAL_SOURCES.find(
        (s) => game.noGoalMarkets?.[s.key]?.american != null,
      );
      if (fdFallback) {
        return { sourceKey: fdFallback.key, book: 'fd' };
      }

      const dkFallback = NO_GOAL_SOURCES.find(
        (s) => game.dk?.noGoalMarkets?.[s.key]?.american != null,
      );
      if (dkFallback) {
        return { sourceKey: dkFallback.key, book: 'dk' };
      }

      return { sourceKey: DEFAULT_NO_GOAL_SOURCE, book: 'fd' };
    },
    [noGoalPickByEvent],
  );

  return (
    <div className="sop-exp-content">
      <header className="sop-exp-header">
        <h1 className="sop-exp-title">SOP +EV Scanner</h1>
        <p className="sop-exp-subtitle">
          FIFA World Cup · FanDuel + DraftKings
          {fetchedAt && (
            <span className="sop-exp-updated">
              {' '}
              · updated {new Date(fetchedAt).toLocaleTimeString()}
            </span>
          )}
        </p>
      </header>

      {dkNotice && (
        <p className="sop-exp-dk-notice" role="status">
          {dkNotice}
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
            <GameCard
              key={g.eventId}
              game={g}
              selectedNoGoalPick={getNoGoalPick(g)}
              onSelectNoGoalPick={handleSelectNoGoalPick}
            />
          ))}
        </div>
      )}

      {!error && games.length > 0 && teamQuery.trim() && filteredGames.length === 0 && (
        <p className="sop-exp-status">No games match “{teamQuery.trim()}”.</p>
      )}

      {!error && games.length === 0 && (
        <p className="sop-exp-status">No World Cup games found on FanDuel.</p>
      )}

      <footer className="sop-exp-footer">
        Auto-refreshes every {REFRESH_MS / 1000}s · default no-goal = Total U (FD) · click FD or DK to model
      </footer>
    </div>
  );
}

export default SOPBookPanel;
