import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

const TIP_WIDTH = 280;
const GAP = 8;

function fmtPts(n) {
  return Number(n).toFixed(1);
}

const COPY = {
  hproj: {
    title: (
      <>
        <span className="hproj-hint-tip-init">H</span>wang{' '}
        <span className="hproj-hint-tip-init">PROJ</span>ection (Pregame)
      </>
    ),
    acro: null,
    body: 'Best-ball P50 for the week: draw residuals for the whole roster, then re-optimize the lineup. Not the sum of the highest-projected starters.',
    tag: 'hproj',
    link: 'Open breakdown →',
  },
  live: {
    title: (
      <>
        <span className="hproj-hint-live-dot" aria-hidden="true" />
        Live Proj
      </>
    ),
    acro: (
      <>
        <span className="hproj-hint-tip-init">H</span>wang{' '}
        <span className="hproj-hint-tip-init">PROJ</span>ection (Live)
      </>
    ),
    body: 'Best-ball P50 for the week: completed games and Out players lock at their actual score. Live players use current score plus a rolled pregame outcome scaled by time remaining. Unplayed players still get a full residual draw, then the lineup is re-optimized.',
    tag: 'live proj',
    link: 'Open breakdown →',
  },
  sleeper: {
    title: null,
    acro: null,
    body: null,
    tag: null,
    link: null,
  },
  final: {
    title: null,
    acro: null,
    body: null,
    tag: null,
    link: 'See team projection analytics →',
  },
};

/**
 * HProj / Live Proj chip — HVORP-style hover explainer with an outlink to /hproj.
 * Tooltip is portaled to document.body so overflow:hidden ancestors cannot clip it.
 */
export default function HprojHint({
  href,
  value = null,
  className = '',
  size = 'sm',
  showTag = true,
  showDot = true,
  dotAfter = false,
  variant = 'hproj',
  actual = null,
  outcomePct = null,
  sleeper = null,
  tipTitle = null,
}) {
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const hideTimer = useRef(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const hasValue = value != null && Number.isFinite(value);
  const sizeClass = size === 'lg' ? ' hproj-hint--lg' : (size === 'md' ? ' hproj-hint--md' : '');
  const kind = COPY[variant] ? variant : 'hproj';
  const copy = COPY[kind];
  const variantClass = kind === 'live'
    ? ' hproj-hint--live'
    : (kind === 'sleeper' || kind === 'final' ? ' hproj-hint--plain' : '');

  function show() {
    clearTimeout(hideTimer.current);
    setOpen(true);
  }

  function hideSoon() {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setOpen(false);
      setCoords(null);
    }, 100);
  }

  useLayoutEffect(() => {
    if (!open) return undefined;

    function place() {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const tipH = tipRef.current ? tipRef.current.offsetHeight : 150;
      const tipW = tipRef.current ? tipRef.current.offsetWidth : TIP_WIDTH;
      let top = r.top - tipH - GAP;
      if (top < GAP) top = r.bottom + GAP;
      let left = r.right - tipW;
      if (left < GAP) left = GAP;
      if (left + tipW > window.innerWidth - GAP) {
        left = window.innerWidth - tipW - GAP;
      }
      setCoords({ top, left });
    }

    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  function go(e) {
    if (!dest) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey || e.button === 1) {
      window.open(dest, '_blank', 'noopener,noreferrer');
      return;
    }
    navigate(dest);
  }

  const dest = kind === 'live' && href && !/[?&]mode=/.test(href)
    ? `${href}${href.includes('?') ? '&' : '?'}mode=live`
    : href;

  const sleeperPts = sleeper != null && Number.isFinite(Number(sleeper))
    ? Number(sleeper)
    : (kind === 'sleeper' && hasValue ? value : null);
  const sleeperTitle = tipTitle
    || (kind === 'sleeper' || kind === 'final'
      ? (sleeperPts != null ? `Sleeper Projection: ${fmtPts(sleeperPts)}` : null)
      : copy.title);
  const finalBody = kind === 'final'
    ? (
      <>
        <span>Actual score: {actual != null && Number.isFinite(Number(actual)) ? fmtPts(actual) : '—'}</span>
        {outcomePct != null && Number.isFinite(Number(outcomePct))
          ? <span>Outcome: P{outcomePct}</span>
          : null}
      </>
    )
    : copy.body;

  const tipClass = [
    'hproj-hint-tip hproj-hint-tip--fixed',
    kind === 'live' ? ' hproj-hint-tip--live' : '',
    kind === 'sleeper' || kind === 'final' ? ' hproj-hint-tip--plain' : '',
    coords ? ' is-open' : '',
  ].join('');

  const tip = open
    ? createPortal(
        <span
          ref={tipRef}
          className={tipClass}
          role="tooltip"
          style={coords ? { top: coords.top, left: coords.left } : { top: -9999, left: -9999 }}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
          onClick={dest ? go : undefined}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {sleeperTitle ? <span className="hproj-hint-tip-title">{sleeperTitle}</span> : null}
          {copy.acro ? <span className="hproj-hint-tip-acro">{copy.acro}</span> : null}
          {finalBody ? <span className="hproj-hint-tip-body">{finalBody}</span> : null}
          {copy.link && dest ? <span className="hproj-hint-tip-link">{copy.link}</span> : null}
        </span>,
        document.body,
      )
    : null;

  const triggerClass = `hproj-hint${sizeClass}${variantClass}${className ? ` ${className}` : ''}`;
  const liveDot = kind === 'live' && showDot
    ? <span className="hproj-hint-live-dot" aria-hidden="true" />
    : null;
  const triggerInner = (
    <>
      {!dotAfter ? liveDot : null}
      {hasValue ? <span className="hproj-hint-value">{fmtPts(value)}</span> : null}
      {showTag && copy.tag ? <span className="hproj-hint-tag">{copy.tag}</span> : null}
      {dotAfter ? liveDot : null}
    </>
  );

  return (
    <>
      {dest ? (
        <a
          ref={wrapRef}
          className={triggerClass}
          href={dest}
          onClick={go}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
          onFocus={show}
          onBlur={hideSoon}
        >
          {triggerInner}
        </a>
      ) : (
        <span
          ref={wrapRef}
          className={triggerClass}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
        >
          {triggerInner}
        </span>
      )}
      {tip}
    </>
  );
}
