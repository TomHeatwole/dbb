import React, { useEffect, useState } from 'react';

function PlayoffRulesToolTip() {
  const [bracketText, setBracketText] = useState(null);
  const [cumulativeText, setCumulativeText] = useState(null);

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

  const bracketBody = bracketText || 'TODO: Add detailed description of the 2025 bracket format here.';
  const cumulativeBody =
    cumulativeText || 'TODO: Add detailed description of the 2024 cumulative scoring rules here.';

  const bracketHtml = { __html: bracketBody };
  const cumulativeHtml = { __html: cumulativeBody };

  return (
    <span className="info-icon playoff-rules-tooltip" aria-label="Playoff rules">
      ℹ️
      <span className="info-icon-tooltip">
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
      </span>
    </span>
  );
}

export default PlayoffRulesToolTip;


