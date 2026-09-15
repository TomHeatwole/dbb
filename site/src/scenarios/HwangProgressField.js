import React from 'react';
import {
  simProgressToFillPct,
  simProgressToRunnerPct,
  RUNNER_BALL_X_FRAC,
  RUNNER_OFFSET_PX,
  isTouchdownProgress,
} from './simulatorProgress';

const BG_SRC = '/loading_hwang_background.png';
const RUNNER_SRC = '/hwang_running_clean_transparent_dust.png';

function HwangProgressField({ progress, celebrating = false, className = '', layout = 'track' }) {
  const fillPct = simProgressToFillPct(progress);
  const runnerPct = simProgressToRunnerPct(progress);
  const touchdown = celebrating || isTouchdownProgress(progress);
  const layoutClass = layout === 'immersive' ? ' simulator-hwang-track--immersive' : '';

  return (
    <div
      className={`simulator-hwang-track${layoutClass}${className ? ` ${className}` : ''}`}
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

export default HwangProgressField;
