import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import useIsMobile from '../hooks/useIsMobile';

const DATA_PATH = '/data/scenario_builder_info.txt';

const FALLBACK =
  'Build "what if?" scenarios by editing team rosters for a completed season, then hit <strong>Evaluate Scenario</strong> to see how the changes would have affected the standings.';

function ScenarioBuilderTooltip() {
  const [bodyHtml, setBodyHtml] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;
    fetch(DATA_PATH)
      .then((r) => (r.ok ? r.text() : null))
      .then((txt) => {
        if (!cancelled && txt) {
          // Convert double-newlines to paragraph breaks for display
          const html = txt
            .trim()
            .split(/\n\n+/)
            .map((p) => `<p style="margin:0 0 0.6em 0">${p.trim()}</p>`)
            .join('');
          setBodyHtml(html);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Lock body scroll when mobile modal is open
  useEffect(() => {
    if (!isMobile) return;
    if (modalOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [modalOpen, isMobile]);

  const displayHtml = bodyHtml || FALLBACK;

  const content = (
    <div className="scenario-builder-tooltip-inner">
      <div
        className="scenario-builder-tooltip-body"
        dangerouslySetInnerHTML={{ __html: displayHtml }}
      />
    </div>
  );

  // ── Mobile: tap the icon → full modal ────────────────────────────────────
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
              <div className="scenario-builder-tooltip-modal-content">
                <h3 className="scenario-builder-tooltip-modal-title">Scenario Builder</h3>
                {content}
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
          className="info-icon scenario-builder-tooltip"
          aria-label="About Scenario Builder"
          onClick={() => setModalOpen(true)}
        >
          ℹ️
        </button>
        {modal}
      </>
    );
  }

  // ── Desktop / web: hover tooltip ─────────────────────────────────────────
  return (
    <span className="info-icon scenario-builder-tooltip" aria-label="About Scenario Builder">
      ℹ️
      <span className="info-icon-tooltip">
        {content}
      </span>
    </span>
  );
}

export default ScenarioBuilderTooltip;
