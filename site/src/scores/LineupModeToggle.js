import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import useIsMobile from '../hooks/useIsMobile';

const TOOLTIP_TITLE = 'Highest Scores vs Highest Projections';

const TOOLTIP_BODY = (
  <>
    <p>
      <strong>Highest Scores</strong> keeps anyone whose game has already started in the lineup, even if a bench player still has a bigger projection.
    </p>
    <p>
      <strong>Highest Projections</strong> fills each slot with the best remaining outlook. Live and unplayed players use the higher of current score and week projection. Finished games stay locked at their final score.
    </p>
    <p>
      The <strong>Proj</strong> total is always finished scores plus the highest remaining projections — even if that mix is not the lineup on screen.
    </p>
  </>
);

function InfoTip() {
  const isMobile = useIsMobile();
  const [modalOpen, setModalOpen] = useState(false);

  if (isMobile) {
    const modal = modalOpen
      ? createPortal(
          <div className="player-modal-overlay" onClick={() => setModalOpen(false)}>
            <div
              className="player-modal"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="player-card-close"
                aria-label="Close"
                onClick={() => setModalOpen(false)}
              >
                ×
              </button>
              <div className="lineup-mode-tooltip-modal">
                <h3>{TOOLTIP_TITLE}</h3>
                {TOOLTIP_BODY}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

    return (
      <>
        <button
          type="button"
          className="info-icon lineup-mode-info"
          aria-label={TOOLTIP_TITLE}
          onClick={() => setModalOpen(true)}
        >
          ℹ️
        </button>
        {modal}
      </>
    );
  }

  return (
    <span className="info-icon lineup-mode-info" aria-label={TOOLTIP_TITLE}>
      ℹ️
      <span className="info-icon-tooltip lineup-mode-info-tooltip">
        {TOOLTIP_BODY}
      </span>
    </span>
  );
}

export default function LineupModeToggle({ value, onChange }) {
  const isMobile = useIsMobile();
  const mode = value === 'projections' ? 'projections' : 'scores';

  return (
    <div className="lineup-mode-toggle">
      <div className="lineup-mode-toggle-seg" role="group" aria-label="Lineup ranking">
        <button
          type="button"
          className={`lineup-mode-toggle-btn${mode === 'scores' ? ' is-active' : ''}`}
          aria-pressed={mode === 'scores'}
          onClick={() => onChange('scores')}
        >
          {isMobile ? 'Highest Scores' : 'Show Highest Scores'}
        </button>
        <button
          type="button"
          className={`lineup-mode-toggle-btn${mode === 'projections' ? ' is-active' : ''}`}
          aria-pressed={mode === 'projections'}
          onClick={() => onChange('projections')}
        >
          {isMobile ? 'Highest Projections' : 'Show Highest Projections'}
        </button>
      </div>
      <InfoTip />
    </div>
  );
}
