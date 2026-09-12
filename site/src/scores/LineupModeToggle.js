import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import useIsMobile from '../hooks/useIsMobile';

const TOOLTIP_TITLE = 'Highest Scores vs Highest Projections';

function TipBody() {
  return (
    <div className="lineup-mode-tip-body">
      <section className="lineup-mode-tip-section">
        <h4>Highest Scores</h4>
        <p>
          Keeps anyone whose game has already started in the lineup, even if a bench
          player still has a bigger projection.
        </p>
      </section>
      <section className="lineup-mode-tip-section">
        <h4>Highest Projections</h4>
        <p>
          Fills each slot with the best remaining outlook. Live players use current
          score plus the leftover share of their pregame projection. Out and finished
          players lock at their actual score.
        </p>
      </section>
    </div>
  );
}

function InfoTip() {
  const isMobile = useIsMobile();
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!isMobile) {
      return undefined;
    }
    if (modalOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [modalOpen, isMobile]);

  if (isMobile) {
    const modal = modalOpen
      ? createPortal(
          <div className="lineup-mode-tip-overlay" onClick={() => setModalOpen(false)}>
            <div
              className="lineup-mode-tip-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lineup-mode-tip-title"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="lineup-mode-tip-close"
                aria-label="Close"
                onClick={() => setModalOpen(false)}
              >
                ×
              </button>
              <h3 id="lineup-mode-tip-title">{TOOLTIP_TITLE}</h3>
              <TipBody />
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
      <span className="info-icon-tooltip lineup-mode-info-tooltip" role="tooltip">
        <strong className="lineup-mode-tip-title">{TOOLTIP_TITLE}</strong>
        <TipBody />
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
