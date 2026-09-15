import React from 'react';
import { DEFAULT_ITERATIONS } from './simulatorMonteCarlo';
import { simFractionToYardLine } from './simulatorProgress';
import HwangProgressField from './HwangProgressField';

function SimulatorProgressBar({ phase, loadingProgress, simProgress, iterations }) {
  const total = iterations || DEFAULT_ITERATIONS;
  const celebrating = phase === 'celebrating';
  const progress = celebrating ? 1 : phase === 'loading' ? (loadingProgress ?? 0) : (simProgress ?? 0);
  const pct = Math.round(progress * 100);

  if (phase === 'loading') {
    return (
      <div className="simulator-progress">
        <div className="simulator-progress-label">Loading simulation data… {pct}%</div>
        <HwangProgressField progress={progress} />
        <div className="simulator-progress-detail">Preparing outcome pools and weekly stats</div>
      </div>
    );
  }

  const completed = Math.round(progress * total);
  const yardLine = celebrating ? 'Touchdown!' : simFractionToYardLine(progress);

  return (
    <div className="simulator-progress simulator-progress--running">
      <div className="simulator-yard-line-label">{yardLine}</div>
      <HwangProgressField progress={progress} celebrating={celebrating} />
      <div className="simulator-progress-meta">
        <span className="simulator-progress-count">
          {completed.toLocaleString()}
          {' / '}
          {total.toLocaleString()}
        </span>
        <span className="simulator-progress-pct">{pct}%</span>
      </div>
    </div>
  );
}

export default SimulatorProgressBar;
