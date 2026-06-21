import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  clampSimulatorIterations,
  DEFAULT_ITERATIONS,
  MAX_SIMULATOR_ITERATIONS,
  SIMULATOR_TEAM_DETAIL_MAX_ITERATIONS,
} from './simulatorMonteCarlo';

const PRESETS = [1000, 5000, 10000, 50000, 100000, 1_000_000];
const POPOVER_WIDTH_PX = 248;
const POPOVER_GAP_PX = 7;
const VIEWPORT_MARGIN_PX = 8;

function formatPresetLabel(n) {
  if (n >= 1_000_000) return `${n / 1_000_000}m`;
  if (n >= 1000) return `${n / 1000}k`;
  return String(n);
}

function computePopoverStyle(anchorEl) {
  if (!anchorEl) return null;
  const rect = anchorEl.getBoundingClientRect();
  const maxWidth = Math.min(POPOVER_WIDTH_PX, window.innerWidth - VIEWPORT_MARGIN_PX * 2);
  let left = rect.right - maxWidth;
  left = Math.max(
    VIEWPORT_MARGIN_PX,
    Math.min(left, window.innerWidth - maxWidth - VIEWPORT_MARGIN_PX),
  );
  return {
    position: 'fixed',
    left,
    bottom: window.innerHeight - rect.top + POPOVER_GAP_PX,
    width: maxWidth,
    zIndex: 10000,
  };
}

function SimulatorRunSettings({ iterations, onChangeIterations }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(iterations ?? DEFAULT_ITERATIONS));
  const [popoverStyle, setPopoverStyle] = useState(null);
  const wrapRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    setDraft(String(iterations ?? DEFAULT_ITERATIONS));
  }, [iterations]);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverStyle(null);
      return undefined;
    }

    function updatePosition() {
      setPopoverStyle(computePopoverStyle(wrapRef.current));
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(e) {
      const inAnchor = wrapRef.current?.contains(e.target);
      const inPopover = popoverRef.current?.contains(e.target);
      if (!inAnchor && !inPopover) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const commitDraft = () => {
    const next = clampSimulatorIterations(draft);
    onChangeIterations(next);
    setDraft(String(next));
    setOpen(false);
  };

  const popover = open && popoverStyle && (
    <div
      ref={popoverRef}
      className="simulator-run-settings-popover simulator-run-settings-popover--portal"
      style={popoverStyle}
      role="dialog"
      aria-label="Simulation settings"
    >
      <div className="simulator-run-settings-title">Simulation runs</div>
      <p className="simulator-run-settings-hint">
        Histograms (finish + score distributions) work at any run count.
        Per-sim deep links are kept for runs up to {SIMULATOR_TEAM_DETAIL_MAX_ITERATIONS.toLocaleString()}.
      </p>
      <label className="simulator-run-settings-label" htmlFor="simulator-run-count">
        Number of runs (max {MAX_SIMULATOR_ITERATIONS.toLocaleString()})
      </label>
      <input
        id="simulator-run-count"
        type="number"
        className="simulator-run-settings-input"
        min={1}
        max={MAX_SIMULATOR_ITERATIONS}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitDraft();
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <div className="simulator-run-settings-presets">
        {PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            className={
              'simulator-run-settings-preset' +
              (iterations === n ? ' simulator-run-settings-preset--active' : '')
            }
            onClick={() => {
              onChangeIterations(n);
              setDraft(String(n));
              setOpen(false);
            }}
          >
            {formatPresetLabel(n)}
          </button>
        ))}
      </div>
      <button type="button" className="simulator-run-settings-apply" onClick={commitDraft}>
        Apply
      </button>
    </div>
  );

  return (
    <div className="simulator-run-settings-wrap" ref={wrapRef}>
      <button
        type="button"
        className="simulator-run-settings-btn"
        aria-label="Simulation settings"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⚙
      </button>
      {popover && createPortal(popover, document.body)}
    </div>
  );
}

export default SimulatorRunSettings;
