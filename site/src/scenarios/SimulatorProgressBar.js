import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_ITERATIONS } from './simulatorMonteCarlo';
import {
  simFractionToYardLine,
  simProgressToFillPct,
  simProgressToRunnerPct,
  RUNNER_BALL_X_FRAC,
  isTouchdownProgress,
} from './simulatorProgress';

const BG_SRC = '/loading_hwang_background.png';
const RUNNER_SRC = '/loading_hwang_runner.png';

const SMOOTH_SPEED = 0.12;

function useSmoothProgress(target) {
  const [display, setDisplay] = useState(target);
  const targetRef = useRef(target);
  const displayRef = useRef(target);
  const rafRef = useRef(null);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    function tick() {
      const tgt = targetRef.current;
      const cur = displayRef.current;
      const next = cur + (tgt - cur) * SMOOTH_SPEED;
      const settled = Math.abs(tgt - next) < 0.001;
      const value = settled ? tgt : next;
      displayRef.current = value;
      setDisplay(value);
      if (!settled) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    if (Math.abs(displayRef.current - target) >= 0.001) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  return display;
}

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
  const smoothSim = useSmoothProgress(simProgress ?? 0);
  const smoothLoading = useSmoothProgress(loadingProgress ?? 0);
  const celebrating = phase === 'celebrating';
  const displayProgress = celebrating ? 1 : simProgress;

  if (phase === 'loading') {
    const pct = Math.round(smoothLoading * 100);
    return (
      <div className="simulator-progress">
        <div className="simulator-progress-label">Loading simulation data… {pct}%</div>
        <HwangProgressField progress={loadingProgress} />
        <div className="simulator-progress-detail">Preparing outcome pools and weekly stats</div>
      </div>
    );
  }

  const completed = Math.round((celebrating ? 1 : smoothSim) * total);
  const yardLine = celebrating ? 'Touchdown!' : simFractionToYardLine(smoothSim);
  const pct = Math.round((celebrating ? 1 : smoothSim) * 100);

  return (
    <div className="simulator-progress simulator-progress--running">
      <div className="simulator-yard-line-label">{yardLine}</div>
      <HwangProgressField progress={displayProgress} celebrating={celebrating} />
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
