import React from 'react';
import HprojHint from './HprojHint';

function formatPts(n) {
  return Number(n || 0).toFixed(1);
}

/**
 * Mid-week: accumulated actual plus HProj (or raw proj when HProj is off).
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
  liveProjValue = null,
  gamesStarted = false,
  compact = false,
}) {
  const liveShown = Number.isFinite(liveProjValue) ? liveProjValue : null;
  const hprojShown = Number.isFinite(hprojValue)
    ? hprojValue
    : (hasProj ? Number(proj) : null);
  const useLive = Boolean(gamesStarted && hprojHref && (liveShown != null || hprojShown != null));
  const chipValue = useLive ? (liveShown != null ? liveShown : hprojShown) : hprojShown;
  const hprojNode = hasProj && hprojHref
    ? <HprojHint href={hprojHref} value={chipValue} size="lg" variant={useLive ? 'live' : 'hproj'} />
    : null;
  const projNode = hprojNode
    ? null
    : (
      <>
        {formatPts(proj)}
        <span className="proj-tag"> proj</span>
      </>
    );
  const projOrHproj = hprojNode || <span className="score-split-proj">{projNode}</span>;
  const actualNode = <>{formatPts(actual)} pts</>;
  const mixed = hasActual && hasProj;
  const classes = [
    className,
    compact ? 'score-split--compact' : null,
    mixed ? 'score-split score-split--mixed' : null,
    (layout === 'stack' || compact) && (mixed || hprojNode) ? 'score-split--stack' : null,
    mixed && layout === 'inline' && !compact ? 'score-split--inline' : null,
    hasProj && !hasActual ? 'score-split--proj-only' : null,
    hprojNode ? 'score-split--has-hproj' : null,
  ].filter(Boolean).join(' ');

  if (mixed && layout === 'inline') {
    return (
      <span className={classes}>
        {prefix}
        <span className="score-split-actual">{actualNode}</span>
        <span className="score-split-plus"> + </span>
        {projOrHproj}
      </span>
    );
  }
  if (mixed) {
    return (
      <span className={classes}>
        {projOrHproj}
        <span className="score-split-actual">{actualNode}</span>
      </span>
    );
  }
  if (hasProj) {
    return (
      <span className={classes}>
        {prefix}
        {projOrHproj}
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

function rankProjValue(row) {
  if (Number.isFinite(row.liveProj)) return row.liveProj;
  if (Number.isFinite(row.hproj)) return row.hproj;
  return null;
}

/** Rank /scores rows: Highest Projections by live/HProj; Highest Scores by pts, proj on ties. */
export function compareLeagueScoreRows(a, b, { lineupMode, useHproj, liveBoard }) {
  if (lineupMode === 'projections' && useHproj) {
    const ah = rankProjValue(a);
    const bh = rankProjValue(b);
    const aRank = ah != null ? ah : a.points;
    const bRank = bh != null ? bh : b.points;
    if (bRank !== aRank) return bRank - aRank;
  } else {
    const aScore = liveBoard ? (Number(a.actual) || 0) : a.points;
    const bScore = liveBoard ? (Number(b.actual) || 0) : b.points;
    if (bScore !== aScore) return bScore - aScore;
    if (useHproj) {
      const ah = rankProjValue(a);
      const bh = rankProjValue(b);
      if (ah != null && bh != null && bh !== ah) return bh - ah;
    }
  }
  if ((a.place || 9999) !== (b.place || 9999)) {
    return (a.place || 9999) - (b.place || 9999);
  }
  return String(a.rosterId).localeCompare(String(b.rosterId));
}

export function starterScoreSplit(weekBreakdown, { forceScore = false, weekComplete = false } = {}) {
  if (!weekBreakdown) {
    return { actual: 0, proj: 0, hasActual: forceScore || weekComplete, hasProj: false };
  }
  return {
    actual: weekBreakdown.starterActualTotal ?? 0,
    proj: weekBreakdown.optimalProjTotal ?? weekBreakdown.starterProjTotal ?? weekBreakdown.starterProjRemaining ?? 0,
    hasActual: weekComplete || forceScore || Boolean(weekBreakdown.starterHasActual),
    hasProj: weekComplete ? false : Boolean(weekBreakdown.includesProjection),
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
