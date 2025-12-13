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
      <div className="spinner" aria-label={ariaLabel} />
      <div className="loading-text">{label}</div>
      <img src="/logo.png" alt="Site logo" className="loading-logo" />
    </div>
  );
}

export default LoadingState;


