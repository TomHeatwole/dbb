import React from 'react';
import HwangProgressField from '../scenarios/HwangProgressField';
import { isTouchdownProgress } from '../scenarios/simulatorProgress';

/** Simulator-style TD rush — full-screen overlay, whole field with endzones. */
function HomePageLoadingFieldTd({ exiting = false, progress = 0 }) {
  const celebrating = progress >= 1;
  const touchdown = isTouchdownProgress(progress) || celebrating;

  return (
    <div
      className={`home-page-loading home-page-loading--field home-page-loading--field-td${exiting ? ' home-page-loading--exit' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={touchdown ? 'Touchdown' : 'Hwang Dynasty is loading'}
    >
      <div className="home-page-loading__arena">
        <div className="home-page-loading__td-backdrop" aria-hidden="true" />
        <div className="home-page-loading__td-field-frame">
          <HwangProgressField
            layout="immersive"
            progress={progress}
            celebrating={celebrating}
          />
        </div>
        <div className="home-page-loading__arena-vignette" aria-hidden="true" />
        <h1 className="home-page-loading__arena-title">
          {touchdown ? 'Touchdown!' : 'Hwang Dynasty is Loading'}
          {!touchdown ? (
            <span className="home-page-loading__dots" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          ) : null}
        </h1>
      </div>
    </div>
  );
}

export default HomePageLoadingFieldTd;
