/**
 * SOP Manual tab — hand-entered NO GOAL odds calculator.
 */

import React, { useMemo, useState } from 'react';
import {
  computeBreakevenOdds,
  DEFAULT_NO_GOAL_AMERICAN,
  formatAmericanOdds,
  parseNoGoalAmericanOdds,
} from '../sop/sopModel';

const OUTCOME_META = [
  { key: 'sop', label: 'SOP', tag: 'Breakeven · take if FanDuel is better', icon: '🎯', accent: '#ffd166' },
  { key: 'header', label: 'HEADER', tag: 'Breakeven · take if FanDuel is better', icon: '🦅', accent: '#06d6a0' },
  { key: 'pk', label: 'PK', tag: 'Breakeven · take if FanDuel is better', icon: '⚽', accent: '#ef476f' },
  { key: 'fk', label: 'FK', tag: 'Breakeven · take if FanDuel is better', icon: '🚀', accent: '#118ab2' },
  { key: 'og', label: 'OG', tag: 'Breakeven · take if FanDuel is better', icon: '😬', accent: '#8338ec' },
];

function SOPManualPanel() {
  const [noGoalInput, setNoGoalInput] = useState(String(DEFAULT_NO_GOAL_AMERICAN));

  const noGoalAmerican = parseNoGoalAmericanOdds(noGoalInput);
  const model = useMemo(
    () => (noGoalAmerican != null ? computeBreakevenOdds(noGoalAmerican) : null),
    [noGoalAmerican],
  );

  return (
    <>
      <header className="sop-header">
        <div className="sop-header-badge">MANUAL · VAR CONNECTED</div>
        <h1 className="sop-title">
          <span className="sop-title-ball" aria-hidden="true">⚽</span>
          SOP CALCULATOR
          <span className="sop-title-ball" aria-hidden="true">⚽</span>
        </h1>
        <p className="sop-subtitle">Soccer Odds Protocol · Goal-Type Pricing Engine</p>
      </header>

      <section className="sop-main">
        <div className="sop-input-panel">
          <label className="sop-input-label" htmlFor="sop-no-goal">
            NO GOAL ODDS
          </label>
          <div className="sop-input-row">
            <input
              id="sop-no-goal"
              className="sop-input"
              type="text"
              inputMode="numeric"
              value={noGoalInput}
              onChange={(e) => setNoGoalInput(e.target.value)}
              placeholder="1150 or -150"
              autoComplete="off"
            />
            <span className="sop-input-hint">american · include − for favorites</span>
          </div>
          {model && (
            <div className="sop-input-meta">
              Implied {(model.noGoalProb * 100).toFixed(1)}% no goal · {(model.goalProb * 100).toFixed(1)}% at least one goal
            </div>
          )}
          {!model && noGoalInput.trim() && (
            <div className="sop-input-meta sop-input-meta--warn">
              Use American odds only — e.g. 1150 or −150 (no + prefix)
            </div>
          )}
        </div>

        <div className="sop-results">
          {OUTCOME_META.map(({ key, label, tag, icon, accent }) => {
            const row = model?.[key];
            return (
              <article
                key={key}
                className="sop-outcome-card"
                style={{ '--sop-accent': accent }}
              >
                <div className="sop-outcome-top">
                  <span className="sop-outcome-icon" aria-hidden="true">{icon}</span>
                  <div>
                    <div className="sop-outcome-label">{label}</div>
                    <div className="sop-outcome-tag">{tag}</div>
                  </div>
                </div>
                {row?.american != null ? (
                  <>
                    <div className="sop-outcome-odds">
                      <span className="sop-outcome-american">{formatAmericanOdds(row.american)}</span>
                    </div>
                    <div className="sop-outcome-bar">
                      <div
                        className="sop-outcome-bar-fill"
                        style={{ width: `${Math.min(100, row.implied * 4)}%` }}
                      />
                    </div>
                    <div className="sop-outcome-implied">{row.implied.toFixed(1)}% implied</div>
                  </>
                ) : (
                  <div className="sop-outcome-empty">Enter valid NO GOAL odds</div>
                )}
              </article>
            );
          })}
        </div>

        <footer className="sop-footer">
          <span>35 league-seasons · WC-era rates</span>
          <span>PK −10% · SOP +penalty remainder</span>
        </footer>
      </section>
    </>
  );
}

export default SOPManualPanel;
