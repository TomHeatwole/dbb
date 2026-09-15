import React from 'react';

const FIELD_SRC = '/loading_hwang_background.png';
const DRAGON_SRC = '/home_loading_dragon_keyed.png';
const RUNNER_SRC = '/hwang_running_clean_transparent_dust.png';

const HUNTERS = [
  { id: '1', className: 'home-page-loading__hunter--1', artClass: 'home-page-loading__hunter-art--mirror' },
  { id: '2', className: 'home-page-loading__hunter--2', artClass: 'home-page-loading__hunter-art--down-left' },
  { id: '3', className: 'home-page-loading__hunter--3', artClass: 'home-page-loading__hunter-art--up' },
  { id: '4', className: 'home-page-loading__hunter--4', artClass: 'home-page-loading__hunter-art--mirror' },
];

/** Sporadic dragons lunge at Hwang; he dodges on the same 9s loop. */
function HomePageLoadingFieldChase({ exiting = false }) {
  return (
    <div
      className={`home-page-loading home-page-loading--field home-page-loading--field-chase${exiting ? ' home-page-loading--exit' : ''}`}
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
          {HUNTERS.map((hunter) => (
            <div
              key={hunter.id}
              className={`home-page-loading__hunter ${hunter.className}`}
            >
              <img
                src={DRAGON_SRC}
                alt=""
                className={`home-page-loading__hunter-art ${hunter.artClass}`}
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

export default HomePageLoadingFieldChase;
