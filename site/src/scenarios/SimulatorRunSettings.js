import React, { useEffect, useRef, useState } from 'react';
import {
  clampSimulatorIterations,
  DEFAULT_ITERATIONS,
  MAX_SIMULATOR_ITERATIONS,
  SIMULATOR_TEAM_DETAIL_MAX_ITERATIONS,
} from './simulatorMonteCarlo';

const PRESETS = [1000, 5000, 10000, 50000, 100000];

function SimulatorRunSettings({ iterations, onChangeIterations }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(iterations ?? DEFAULT_ITERATIONS));
  const wrapRef = useRef(null);

  useEffect(() => {
    setDraft(String(iterations ?? DEFAULT_ITERATIONS));
  }, [iterations]);

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
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
      {open && (
        <div className="simulator-run-settings-popover" role="dialog" aria-label="Simulation settings">
          <div className="simulator-run-settings-title">Simulation runs</div>
          <p className="simulator-run-settings-hint">
            Runs above {SIMULATOR_TEAM_DETAIL_MAX_ITERATIONS.toLocaleString()} return aggregate
            stats only (no per-sim drill-down).
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
                {n >= 1000 ? `${n / 1000}k` : n}
              </button>
            ))}
          </div>
          <button type="button" className="simulator-run-settings-apply" onClick={commitDraft}>
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

export default SimulatorRunSettings;
