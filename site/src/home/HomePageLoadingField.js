import React from 'react';

const FIELD_SRC = '/loading_hwang_background.png';
const DRAGON_SRC = '/home_loading_dragon_keyed.png';
const RUNNER_SRC = '/hwang_running_clean_transparent_dust.png';

/** Alternate home splash — Hwang dodging dragons on the field. */
function HomePageLoadingField({ exiting = false }) {
  return (
    <div
      className={`home-page-loading home-page-loading--field${exiting ? ' home-page-loading--exit' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Hwang Dynasty is loading"
    >
      <div className="home-page-loading__backdrop" aria-hidden="true" />
      <div className="home-page-loading__stage">
        <div className="home-page-loading__field-wrap">
          <img
            src={FIELD_SRC}
            alt=""
            className="home-page-loading__field"
            draggable={false}
          />

          <div className="home-page-loading__endzone home-page-loading__endzone--left" aria-hidden="true">
            <img
              src={DRAGON_SRC}
              alt=""
              className="home-page-loading__endzone-dragon home-page-loading__endzone-dragon--mirror"
              draggable={false}
            />
          </div>

          <div
            className="home-page-loading__field-dragon home-page-loading__field-dragon--mid"
            aria-hidden="true"
          >
            <img
              src={DRAGON_SRC}
              alt=""
              className="home-page-loading__field-dragon-art"
              draggable={false}
            />
          </div>

          <div className="home-page-loading__endzone home-page-loading__endzone--right" aria-hidden="true">
            <img
              src={DRAGON_SRC}
              alt=""
              className="home-page-loading__endzone-dragon"
              draggable={false}
            />
          </div>

          <div className="home-page-loading__runner" aria-hidden="true">
            <img
              src={RUNNER_SRC}
              alt=""
              className="home-page-loading__runner-art"
              draggable={false}
            />
          </div>
        </div>
        <h1 className="home-page-loading__title">
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

export default HomePageLoadingField;
