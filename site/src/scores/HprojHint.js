import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

const TIP_WIDTH = 280;
const GAP = 8;

/**
 * Green "hproj" chip — HVORP-style hover explainer with an outlink to /hproj.
 * Tooltip is portaled to document.body so overflow:hidden ancestors cannot clip it.
 */
export default function HprojHint({ href, value = null, className = '', size = 'sm', showTag = true }) {
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const hideTimer = useRef(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const hasValue = value != null && Number.isFinite(value);
  const sizeClass = size === 'lg' ? ' hproj-hint--lg' : (size === 'md' ? ' hproj-hint--md' : '');

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
    e.preventDefault();
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey || e.button === 1) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    navigate(href);
  }

  if (!href) return null;

  const tip = open
    ? createPortal(
        <span
          ref={tipRef}
          className={`hproj-hint-tip hproj-hint-tip--fixed${coords ? ' is-open' : ''}`}
          role="tooltip"
          style={coords ? { top: coords.top, left: coords.left } : { top: -9999, left: -9999 }}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
          onClick={go}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="hproj-hint-tip-title">HPROJ</span>
          <span className="hproj-hint-tip-acro">
            <span className="hproj-hint-tip-init">H</span>wang{' '}
            <span className="hproj-hint-tip-init">PROJ</span>ection
          </span>
          <span className="hproj-hint-tip-body">
            Best-ball P50 for the week: draw residuals for the whole roster, then
            re-optimize the lineup. Not the sum of the highest-projected starters.
          </span>
          <span className="hproj-hint-tip-link">Open breakdown →</span>
        </span>,
        document.body,
      )
    : null;

  return (
    <>
      <a
        ref={wrapRef}
        className={`hproj-hint${sizeClass}${className ? ` ${className}` : ''}`}
        href={href}
        onClick={go}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={hideSoon}
      >
        {hasValue ? <span className="hproj-hint-value">{value.toFixed(1)}</span> : null}
        {showTag ? <span className="hproj-hint-tag">hproj</span> : null}
      </a>
      {tip}
    </>
  );
}
