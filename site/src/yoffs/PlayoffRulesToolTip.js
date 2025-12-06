import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import useIsMobile from '../hooks/useIsMobile';

function PlayoffRulesToolTip() {
  const [bracketText, setBracketText] = useState(null);
  const [cumulativeText, setCumulativeText] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;
    async function loadText(path, setter) {
      try {
        const res = await fetch(path);
        if (!res.ok) {
          return;
        }
        const txt = await res.text();
        if (!cancelled) {
          setter(txt);
        }
      } catch (_) {
        // ignore; fallback text will be shown
      }
    }
    loadText('/data/playoff_rules_2025_bracket.txt', setBracketText);
    loadText('/data/playoff_rules_2024_cumulative.txt', setCumulativeText);
    return () => {
      cancelled = true;
    };
  }, []);

  // Lock body scroll when the mobile modal is open
  useEffect(() => {
    if (!isMobile) {
      return;
    }
    if (modalOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [modalOpen, isMobile]);

  const bracketBody = bracketText || 'TODO: Add detailed description of the 2025 bracket format here.';
  const cumulativeBody =
    cumulativeText || 'TODO: Add detailed description of the 2024 cumulative scoring rules here.';

  const bracketHtml = { __html: bracketBody };
  const cumulativeHtml = { __html: cumulativeBody };

  const content = (
    <div className="playoff-rules-modal-content">
      <div className="playoff-rules-tooltip-inner">
        <section className="playoff-rules-section">
          <h3 className="playoff-rules-section-title">Bracket Format (2025 Rules)</h3>
          <div
            className="playoff-rules-section-body"
            dangerouslySetInnerHTML={bracketHtml}
          />
        </section>
        <section className="playoff-rules-section">
          <h3 className="playoff-rules-section-title">Cumulative Score (2024 Rules)</h3>
          <div
            className="playoff-rules-section-body"
            dangerouslySetInnerHTML={cumulativeHtml}
          />
        </section>
      </div>
    </div>
  );

  if (isMobile) {
    const modal = modalOpen
      ? createPortal(
          <div className="player-modal-overlay" onClick={() => setModalOpen(false)}>
            <div
              className="player-modal"
              role="dialog"
              aria-modal="true"
              onClick={(e) => { e.stopPropagation(); }}
            >
              {/* Reuse existing close button styling from player card */}
              <button
                type="button"
                className="player-card-close"
                aria-label="Close playoff rules"
                onClick={() => setModalOpen(false)}
              >
                ×
              </button>
              {content}
            </div>
          </div>,
          document.body
        )
      : null;

    return (
      <>
        <button
          type="button"
          className="info-icon playoff-rules-tooltip"
          aria-label="Playoff rules"
          onClick={() => setModalOpen(true)}
        >
          ℹ️
        </button>
        {modal}
      </>
    );
  }

  // Desktop/web: keep standard tooltip behavior
  return (
    <span className="info-icon playoff-rules-tooltip" aria-label="Playoff rules">
      ℹ️
      <span className="info-icon-tooltip">
        {content}
      </span>
    </span>
  );
}

export default PlayoffRulesToolTip;


