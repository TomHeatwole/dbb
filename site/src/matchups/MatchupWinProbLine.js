import React from 'react';
import { winProbHeat } from './matchupWinProbColor';

/**
 * Classic matchup win% under the two team headers: 64% vs 36% + split bar.
 */
export default function MatchupWinProbLine({
  leftPct,
  rightPct,
  live = false,
  scope = 'week',
  onScopeChange = null,
}) {
  const left = Number(leftPct);
  const right = Number(rightPct);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;

  const leftHeat = winProbHeat(left);
  const rightHeat = winProbHeat(right);
  const seasonScope = scope === 'season';
  const label = seasonScope
    ? `${left}% vs ${right}% chance to lead through this week`
    : `${left}% vs ${right}% chance to outscore this week`;

  return (
    <div
      className={`yoffs-matchup-winprob${live ? ' yoffs-matchup-winprob--live' : ''}`}
      title={live
        ? `${label}. Live HPROJ: completed / Out players lock; live games scale remaining time.`
        : `${label}. Pregame HPROJ: residual draws, then best-ball lineup.`}
    >
      {typeof onScopeChange === 'function' ? (
        <div className="yoffs-matchup-winprob-toggle" role="group" aria-label="Compare">
          <button
            type="button"
            className={`yoffs-matchup-winprob-toggle-btn${scope === 'week' ? ' is-active' : ''}`}
            aria-pressed={scope === 'week'}
            onClick={() => onScopeChange('week')}
          >
            This week
          </button>
          <button
            type="button"
            className={`yoffs-matchup-winprob-toggle-btn${seasonScope ? ' is-active' : ''}`}
            aria-pressed={seasonScope}
            onClick={() => onScopeChange('season')}
          >
            Cumulative
          </button>
        </div>
      ) : null}
      <div className="yoffs-matchup-winprob-pcts">
        <span
          className="yoffs-matchup-winprob-pct yoffs-matchup-winprob-pct--left"
          style={{ color: leftHeat.css, textShadow: leftHeat.glow }}
        >
          {left}%
        </span>
        <span className="yoffs-matchup-winprob-vs">
          {live ? <span className="hproj-hint-live-dot" aria-hidden="true" /> : null}
          vs
        </span>
        <span
          className="yoffs-matchup-winprob-pct yoffs-matchup-winprob-pct--right"
          style={{ color: rightHeat.css, textShadow: rightHeat.glow }}
        >
          {right}%
        </span>
      </div>
      <div
        className="yoffs-matchup-winprob-bar"
        role="img"
        aria-label={label}
      >
        <div
          className="yoffs-matchup-winprob-bar-fill yoffs-matchup-winprob-bar-fill--left"
          style={{
            flexGrow: left,
            background: leftHeat.css,
          }}
        />
        <div className="yoffs-matchup-winprob-bar-break" aria-hidden="true" />
        <div
          className="yoffs-matchup-winprob-bar-fill yoffs-matchup-winprob-bar-fill--right"
          style={{
            flexGrow: right,
            background: rightHeat.css,
          }}
        />
      </div>
    </div>
  );
}
