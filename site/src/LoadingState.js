import React from 'react';

function joinClasses(base, extra) {
  if (!extra) {
    return base;
  }
  return `${base} ${extra}`;
}

function LoadingState({
  label = 'Loading…',
  ariaLabel = 'Loading',
  className = '',
}) {
  return (
    <div className={joinClasses('loading-center', className)}>
      <div className="loading-icon-wrapper">
        <img src="/logo.png" alt="Site logo" className="loading-logo" />
        <div className="spinner loading-spinner-overlay" aria-label={ariaLabel} />
      </div>
      <div className="loading-text">{label}</div>
    </div>
  );
}

export default LoadingState;


