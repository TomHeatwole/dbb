import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';

const STATIC_SRC = '/home_loading_dynasty_0.png';
const IMG_W = 1280;
const IMG_H = 720;

/** Bar bounds on home_loading_dynasty_0.png (source pixels). */
const BAR_BOX = { x: 450, y: 532, w: 380, h: 44 };

const BAR_SPRITES = [
  '/home_loading_dynasty_bars_v2/bar_0.png',
  '/home_loading_dynasty_bars_v2/bar_25.png',
  '/home_loading_dynasty_bars_v2/bar_50.png',
  '/home_loading_dynasty_bars_v2/bar_75.png',
  '/home_loading_dynasty_bars_v2/bar_100.png',
];

function containBarMetrics(wrapW, wrapH) {
  const imgAspect = IMG_W / IMG_H;
  const wrapAspect = wrapW / wrapH;

  let renderedW;
  let renderedH;
  let offsetX;
  let offsetY;

  if (wrapAspect > imgAspect) {
    renderedH = wrapH;
    renderedW = wrapH * imgAspect;
    offsetX = (wrapW - renderedW) / 2;
    offsetY = 0;
  } else {
    renderedW = wrapW;
    renderedH = wrapW / imgAspect;
    offsetX = 0;
    offsetY = (wrapH - renderedH) / 2;
  }

  const scale = renderedW / IMG_W;

  return {
    left: offsetX + BAR_BOX.x * scale,
    top: offsetY + BAR_BOX.y * scale,
    width: BAR_BOX.w * scale,
    height: BAR_BOX.h * scale,
  };
}

/** Evenly divide 0–1 into five bar frames (0 / 25 / 50 / 75 / 100). */
function progressToFrameIndex(progress) {
  const clamped = Math.min(1, Math.max(0, progress));
  if (clamped >= 1) return 4;
  return Math.min(4, Math.floor(clamped * 5));
}

function HomePageLoadingFieldDynasty({ exiting = false, progress = 0 }) {
  const wrapRef = useRef(null);
  const maxFrameRef = useRef(0);
  const [barStyle, setBarStyle] = useState(null);

  const frameIndex = useMemo(() => {
    if (progress <= 0) maxFrameRef.current = 0;
    const next = progressToFrameIndex(progress);
    maxFrameRef.current = Math.max(maxFrameRef.current, next);
    return maxFrameRef.current;
  }, [progress]);

  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;

    const measure = () => {
      const { width, height } = wrap.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const next = containBarMetrics(width, height);
      if (![next.left, next.top, next.width, next.height].every(Number.isFinite)) return;
      setBarStyle((prev) => {
        if (
          prev
          && prev.left === next.left
          && prev.top === next.top
          && prev.width === next.width
          && prev.height === next.height
        ) {
          return prev;
        }
        return next;
      });
    };

    measure();
    let frame = 0;
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(measure);
      })
      : null;
    ro?.observe(wrap);
    window.addEventListener('resize', measure);

    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div
      className={`home-page-loading home-page-loading--dynasty${exiting ? ' home-page-loading--exit' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Hwang Dynasty is loading"
    >
      <div
        ref={wrapRef}
        className="home-page-loading__dynasty-wrap"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Loading progress"
      >
        <img
          src={STATIC_SRC}
          alt=""
          className="home-page-loading__dynasty-art"
          draggable={false}
        />

        {barStyle ? (
          <>
            <div
              className="home-page-loading__dynasty-bar-cover"
              style={barStyle}
              aria-hidden="true"
            />
            <img
              src={BAR_SPRITES[frameIndex]}
              alt=""
              className="home-page-loading__dynasty-bar-sprite"
              style={barStyle}
              draggable={false}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

export default HomePageLoadingFieldDynasty;
