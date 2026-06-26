/**
 * SOPPage — over-the-top soccer odds calculator.
 */

import React, { useEffect, useMemo, useState } from 'react';
import PageMeta from '../PageMeta';
import SimulatorProgressBar from '../scenarios/SimulatorProgressBar';
import { TOUCHDOWN_CELEBRATION_MS } from '../scenarios/simulatorProgress';
import {
  computeBreakevenOdds,
  DEFAULT_NO_GOAL_AMERICAN,
  formatAmericanOdds,
  parseNoGoalAmericanOdds,
} from '../sop/sopModel';

const OG_TITLE = 'SOP — Soccer Odds Protocol';
const OG_DESCRIPTION = 'VAR-approved goal-type pricing from NO GOAL odds.';

const LOADING_DURATION_MS = 10_000;

const LOADING_MESSAGES = [
  'Initializing pitch sensors…',
  'Calibrating offside trap algorithms…',
  'Syncing with FIFA VAR mainframe…',
  'Loading corner kick coefficients…',
  'Warming up the fourth official…',
  'Parsing xG regression tables…',
  'Handshake with the goal-line tech…',
  'Downloading crowd noise samples…',
];

const OUTCOME_META = [
  { key: 'sop', label: 'SOP', tag: 'Breakeven · take if FanDuel is better', icon: '🎯', accent: '#ffd166' },
  { key: 'header', label: 'HEADER', tag: 'Breakeven · take if FanDuel is better', icon: '🦅', accent: '#06d6a0' },
  { key: 'pk', label: 'PK', tag: 'Breakeven · take if FanDuel is better', icon: '⚽', accent: '#ef476f' },
  { key: 'fk', label: 'FK', tag: 'Breakeven · take if FanDuel is better', icon: '🚀', accent: '#118ab2' },
  { key: 'og', label: 'OG', tag: 'Breakeven · take if FanDuel is better', icon: '😬', accent: '#8338ec' },
];

function SOPPage() {
  const [phase, setPhase] = useState('loading');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [msgIndex, setMsgIndex] = useState(0);
  const [noGoalInput, setNoGoalInput] = useState(String(DEFAULT_NO_GOAL_AMERICAN));

  useEffect(() => {
    let raf = 0;
    const start = performance.now();

    const tick = (now) => {
      const elapsed = now - start;
      const p = Math.min(1, elapsed / LOADING_DURATION_MS);
      setLoadingProgress(p);

      if (p < 1) {
        raf = requestAnimationFrame(tick);
        return;
      }

      setPhase('celebrating');
      window.setTimeout(() => setPhase('ready'), TOUCHDOWN_CELEBRATION_MS);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (phase !== 'loading') return undefined;

    const id = window.setInterval(() => {
      setMsgIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 1400);

    return () => clearInterval(id);
  }, [phase]);

  const noGoalAmerican = parseNoGoalAmericanOdds(noGoalInput);
  const model = useMemo(
    () => (noGoalAmerican != null ? computeBreakevenOdds(noGoalAmerican) : null),
    [noGoalAmerican],
  );

  const showLoader = phase === 'loading' || phase === 'celebrating';

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />

      <div className="sop-page">
        <div className="sop-pitch-lines" aria-hidden="true" />
        <div className="sop-spotlight sop-spotlight--left" aria-hidden="true" />
        <div className="sop-spotlight sop-spotlight--right" aria-hidden="true" />
        <div className="sop-scanlines" aria-hidden="true" />

        <header className="sop-header">
          <div className="sop-header-badge">LIVE · VAR CONNECTED</div>
          <h1 className="sop-title">
            <span className="sop-title-ball" aria-hidden="true">⚽</span>
            SOP CALCULATOR
            <span className="sop-title-ball" aria-hidden="true">⚽</span>
          </h1>
          <p className="sop-subtitle">Soccer Odds Protocol · Goal-Type Pricing Engine</p>
        </header>

        {showLoader && (
          <section className="sop-loader" aria-busy="true" aria-label="Loading SOP engine">
            <div className="sop-loader-card">
              <div className="sop-loader-kicker">MATCH DAY SIMULATION</div>
              <SimulatorProgressBar
                phase={phase === 'celebrating' ? 'celebrating' : 'loading'}
                loadingProgress={loadingProgress}
                simProgress={0}
                iterations={10000}
              />
              <div className="sop-loader-detail">{LOADING_MESSAGES[msgIndex]}</div>
              <div className="sop-loader-sub">
                Absolutely nothing is loading. This is purely for the vibes.
              </div>
            </div>
          </section>
        )}

        {phase === 'ready' && (
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
        )}
      </div>
    </>
  );
}

export default SOPPage;
