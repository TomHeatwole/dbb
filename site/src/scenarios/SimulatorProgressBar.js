import React from 'react';
import { DEFAULT_ITERATIONS } from './simulatorMonteCarlo';
import {
  simFractionToYardLine,
  simProgressToFillPct,
  simProgressToRunnerPct,
  RUNNER_BALL_X_FRAC,
  RUNNER_OFFSET_PX,
  isTouchdownProgress,
} from './simulatorProgress';

const BG_SRC = '/loading_hwang_background.png';
const RUNNER_SRC = '/hwang_running_clean_transparent_dust.png';

function HwangProgressField({ progress, celebrating = false }) {
  const fillPct = simProgressToFillPct(progress);
  const runnerPct = simProgressToRunnerPct(progress);
  const touchdown = celebrating || isTouchdownProgress(progress);

  return (
    <div
      className="simulator-hwang-track"
      style={{
        '--fill-pct': `${fillPct}%`,
        '--runner-pct': `${runnerPct}%`,
        '--ball-x-frac': RUNNER_BALL_X_FRAC,
        '--runner-offset-px': `${RUNNER_OFFSET_PX}px`,
      }}
      aria-hidden="true"
    >
      <img
        src={BG_SRC}
        alt=""
        className="simulator-hwang-track-bg simulator-hwang-track-bg--dim"
        draggable={false}
      />
      <img
        src={BG_SRC}
        alt=""
        className="simulator-hwang-track-bg simulator-hwang-track-bg--lit"
        draggable={false}
      />
      <div
        className={
          'simulator-hwang-runner' +
          (touchdown ? ' simulator-hwang-runner--touchdown' : '') +
          (celebrating ? ' simulator-hwang-runner--celebrating' : '')
        }
      >
        <img src={RUNNER_SRC} alt="" draggable={false} />
      </div>
    </div>
  );
}

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
