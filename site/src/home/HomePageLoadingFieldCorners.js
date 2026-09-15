import React from 'react';

const FIELD_SRC = '/loading_hwang_background.png';
const DRAGON_SRC = '/home_loading_dragon_keyed.png';
const RUNNER_SRC = '/hwang_running_clean_transparent_dust.png';

const CORNER_DRAGONS = [
  { id: 'tl', className: 'home-page-loading__dragon--tl', mirror: true },
  { id: 'tr', className: 'home-page-loading__dragon--tr', mirror: false },
  { id: 'bl', className: 'home-page-loading__dragon--bl', mirror: true },
  { id: 'br', className: 'home-page-loading__dragon--br', mirror: false },
];

/** Pinned corner dragons — previous field loader look. */
function HomePageLoadingFieldCorners({ exiting = false }) {
  return (
    <div
      className={`home-page-loading home-page-loading--field home-page-loading--field-corners${exiting ? ' home-page-loading--exit' : ''}`}
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

        <div className="home-page-loading__arena-layer" aria-hidden="true">
          {CORNER_DRAGONS.map((dragon) => (
            <div
              key={dragon.id}
              className={`home-page-loading__dragon ${dragon.className}`}
            >
              <img
                src={DRAGON_SRC}
                alt=""
                className={
                  'home-page-loading__dragon-art' +
                  (dragon.mirror ? ' home-page-loading__dragon-art--mirror' : '')
                }
                draggable={false}
              />
            </div>
          ))}

          <div className="home-page-loading__arena-runner">
            <img
              src={RUNNER_SRC}
              alt=""
              className="home-page-loading__arena-runner-art"
              draggable={false}
            />
          </div>
        </div>

        <h1 className="home-page-loading__arena-title">
          Hwang Dynasty is Loading
          <span className="home-page-loading__dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </h1>
      </div>
    </div>
  );
}

export default HomePageLoadingFieldCorners;
