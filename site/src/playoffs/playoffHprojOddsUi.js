import React from 'react';
import { Link } from 'react-router-dom';

export const PLAYOFF_PREDICTIONS_PATH = '/playoff_predictions';

export function fmtHprojOddsPct(n) {
  if (!Number.isFinite(n)) return '—';
  const v = Math.max(0, Math.min(100, Number(n) || 0));
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function HprojOddsPctLink({ loading, value, title, className = 'standings-hproj-pct standings-inline-link' }) {
  if (loading) {
    return (
      <span className={`${className} standings-hproj-pct--loading`} title={title}>
        <span className="standings-hproj-spinner" aria-hidden="true" />
      </span>
    );
  }
  return (
    <Link
      to={PLAYOFF_PREDICTIONS_PATH}
      className={className}
      title={title}
      onClick={(e) => e.stopPropagation()}
    >
      {value}
    </Link>
  );
}