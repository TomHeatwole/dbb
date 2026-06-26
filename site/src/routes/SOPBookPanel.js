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
      const fdAmerican = game.goalTypes?.[key]?.american ?? null;
      const breakeven = model[key];
      const analysis = analyzeAgainstBreakeven(fdAmerican, breakeven?.american);
      return {
        key,
        label,
        fdRunner,
        fdAmerican,
        breakevenAmerican: breakeven?.american ?? null,
        breakevenImplied: breakeven?.implied ?? null,
        analysis,
      };
    });
  }, [game.goalTypes, model]);

  const evCount = goalAnalyses.filter((row) => row.analysis?.profitable).length;

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
                const selected = selectedNoGoalSource === key;
                const hasOdds = quote?.american != null;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`sop-exp-no-goal-btn${selected ? ' sop-exp-no-goal-btn--selected' : ''}${!hasOdds ? ' sop-exp-no-goal-btn--missing' : ''}`}
                    onClick={() => onSelectNoGoalSource(game.eventId, key)}
                    disabled={!hasOdds}
                    title={desc}
                  >
                    <span className="sop-exp-no-goal-short">{short}</span>
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
                          {row.fdAmerican != null ? formatAmericanOdds(row.fdAmerican) : '—'}
                        </span>
                        <span className="sop-exp-goal-fd-tag">FD</span>
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
        </div>
      )}
    </article>
  );
}

function SOPBookPanel({ games, fetchedAt, error, refreshing, onRefresh }) {
  const [noGoalSourceByEvent, setNoGoalSourceByEvent] = useState({});
  const [teamQuery, setTeamQuery] = useState('');

  const teamNames = useMemo(() => collectTeamNames(games), [games]);

  const filteredGames = useMemo(() => {
    if (!teamQuery.trim()) return games;
    return games.filter((g) => gameMatchesQuery(g, teamQuery));
  }, [games, teamQuery]);

  const handleSelectNoGoalSource = useCallback((eventId, sourceKey) => {
    setNoGoalSourceByEvent((prev) => ({ ...prev, [eventId]: sourceKey }));
  }, []);

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

  return (
    <div className="sop-exp-content">
      <header className="sop-exp-header">
        <h1 className="sop-exp-title">SOP +EV Scanner</h1>
        <p className="sop-exp-subtitle">
          FIFA World Cup · FanDuel live
          {fetchedAt && (
            <span className="sop-exp-updated">
              {' '}
              · updated {new Date(fetchedAt).toLocaleTimeString()}
            </span>
          )}
        </p>
      </header>

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
              selectedNoGoalSource={getNoGoalSource(g)}
              onSelectNoGoalSource={handleSelectNoGoalSource}
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
        Auto-refreshes every {REFRESH_MS / 1000}s · default no-goal = Total U
      </footer>
    </div>
  );
}

export default SOPBookPanel;
