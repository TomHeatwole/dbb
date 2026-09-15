import React from 'react';

const STADIUM_SRC = '/home_loading_stadium.png';

function HomePageLoadingStadium({ exiting = false, progress = 0 }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <div
      className={`home-page-loading home-page-loading--stadium${exiting ? ' home-page-loading--exit' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="The Hwang Dynasty is loading"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="home-page-loading__stadium-wrap">
        <img
          src={STADIUM_SRC}
          alt=""
          className="home-page-loading__stadium-art"
          draggable={false}
        />
        <div className="home-page-loading__stadium-bar" aria-hidden="true">
          <div
            className="home-page-loading__stadium-bar-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default HomePageLoadingStadium;
