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

function GameCard({ game, selectedNoGoalSource, onSelectNoGoalSource }) {
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

  return (
    <article className="sop-exp-game">
      <header className="sop-exp-game-header">
        <div>
          <h2 className="sop-exp-game-title">{game.name}</h2>
          <div className="sop-exp-game-meta">
            {game.inPlay && <span className="sop-exp-live">LIVE</span>}
            <span className="sop-exp-score">{game.scoreDisplay ?? '0-0'}</span>
            {game.openDate && (
              <span className="sop-exp-time">{formatKickoff(game.openDate)}</span>
            )}
          </div>
        </div>
      </header>

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
    </article>
  );
}

function SOPBookPanel({ games, fetchedAt, error }) {
  const [noGoalSourceByEvent, setNoGoalSourceByEvent] = useState({});

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

      {error && <p className="sop-exp-error">{error}</p>}

      {!error && games.length > 0 && (
        <div className="sop-exp-games">
          {games.map((g) => (
            <GameCard
              key={g.eventId}
              game={g}
              selectedNoGoalSource={getNoGoalSource(g)}
              onSelectNoGoalSource={handleSelectNoGoalSource}
            />
          ))}
        </div>
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
