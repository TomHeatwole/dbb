import React from 'react';
import HprojHint from './HprojHint';

function formatPts(n) {
  return Number(n || 0).toFixed(1);
}

/**
 * Mid-week: accumulated actual and remaining projection as two numbers.
 * Pre-week (proj only) or finished (actual only) stay a single figure.
 */
export default function ScoreSplit({
  actual = 0,
  proj = 0,
  hasActual = false,
  hasProj = false,
  prefix = null,
  layout = 'stack',
  className = '',
  hprojHref = null,
  hprojValue = null,
}) {
  const hprojNode = hasProj && hprojHref
    ? <HprojHint href={hprojHref} value={hprojValue} size="lg" />
    : null;
  const projNode = (
    <>
      {formatPts(proj)}
      <span className="proj-tag"> proj</span>
    </>
  );
  const actualNode = <>{formatPts(actual)} pts</>;
  const mixed = hasActual && hasProj;
  const classes = [
    className,
    mixed ? 'score-split score-split--mixed' : null,
    layout === 'stack' && (mixed || hprojNode) ? 'score-split--stack' : null,
    mixed && layout === 'inline' ? 'score-split--inline' : null,
    hasProj && !hasActual ? 'score-split--proj-only' : null,
    hprojNode ? 'score-split--has-hproj' : null,
  ].filter(Boolean).join(' ');

  if (mixed && layout === 'inline') {
    return (
      <span className={classes}>
        {prefix}
        <span className="score-split-actual">{actualNode}</span>
        <span className="score-split-plus"> + </span>
        {hprojNode}
        <span className="score-split-proj">{projNode}</span>
      </span>
    );
  }
  if (mixed) {
    return (
      <span className={classes}>
        <span className="score-split-actual">{actualNode}</span>
        {hprojNode}
        <span className="score-split-proj">{projNode}</span>
      </span>
    );
  }
  if (hasProj) {
    return (
      <span className={classes}>
        {prefix}
        {hprojNode}
        <span className="score-split-proj">{projNode}</span>
      </span>
    );
  }
  return (
    <span className={classes}>
      {prefix}
      {actualNode}
    </span>
  );
}

export function starterScoreSplit(weekBreakdown) {
  if (!weekBreakdown) {
    return { actual: 0, proj: 0, hasActual: false, hasProj: false };
  }
  return {
    actual: weekBreakdown.starterActualTotal ?? 0,
    proj: weekBreakdown.optimalProjTotal ?? weekBreakdown.starterProjTotal ?? weekBreakdown.starterProjRemaining ?? 0,
    hasActual: Boolean(weekBreakdown.starterHasActual),
    hasProj: Boolean(weekBreakdown.includesProjection),
  };
}

export function benchScoreSplit(weekBreakdown) {
  if (!weekBreakdown) {
    return { actual: 0, proj: 0, hasActual: false, hasProj: false };
  }
  return {
    actual: weekBreakdown.benchActualTotal ?? 0,
    proj: weekBreakdown.benchProjTotal ?? weekBreakdown.benchProjRemaining ?? 0,
    hasActual: Boolean(weekBreakdown.benchHasActual),
    hasProj: Boolean(weekBreakdown.benchHasProj),
  };
}
