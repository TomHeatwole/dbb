import React, { useEffect, useState } from 'react';

const FIELD_SRC = '/loading_hwang_background.png';

const SPIN_FRAMES = [
  '/home_football_spin/frame_0.png?v=4',
  '/home_football_spin/frame_1.png?v=4',
  '/home_football_spin/frame_2.png?v=4',
  '/home_football_spin/frame_3.png?v=4',
  '/home_football_spin/frame_4.png?v=4',
  '/home_football_spin/frame_5.png?v=4',
  '/home_football_spin/frame_6.png?v=4',
];

/** Main logo face — held at end of each rotation. */
const MAIN_FRAME_INDEX = 0;

/** Spin through side frames, then pause on the logo face before repeating. */
const SPIN_SEQUENCE = [1, 2, 3, 4, 5, 6, MAIN_FRAME_INDEX];

const FRAME_MS = 85;
const MAIN_FRAME_MS = 500;

/** Centered football — photo frames cycle to simulate an end-over-end spin. */
function HomePageLoadingFieldFootball({ exiting = false }) {
  const [frameIndex, setFrameIndex] = useState(MAIN_FRAME_INDEX);

  useEffect(() => {
    SPIN_FRAMES.forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let seqIndex = 0;
    let timeoutId;

    const tick = () => {
      if (cancelled) return;
      const nextFrame = SPIN_SEQUENCE[seqIndex];
      setFrameIndex(nextFrame);
      const delay = nextFrame === MAIN_FRAME_INDEX ? MAIN_FRAME_MS : FRAME_MS;
      seqIndex = (seqIndex + 1) % SPIN_SEQUENCE.length;
      timeoutId = setTimeout(tick, delay);
    };

    tick();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  return (
    <div
      className={`home-page-loading home-page-loading--field home-page-loading--field-football${exiting ? ' home-page-loading--exit' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Hwang Dynasty is loading"
    >
      <div className="home-page-loading__arena">
        <img
          src={FIELD_SRC}
          alt=""
          className="home-page-loading__arena-field"
          draggable={false}
        />
        <div className="home-page-loading__arena-vignette" aria-hidden="true" />

        <div className="home-football-spin" aria-hidden="true">
          <img
            src={SPIN_FRAMES[frameIndex]}
            alt=""
            className="home-football-spin__ball"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}

export default HomePageLoadingFieldFootball;
