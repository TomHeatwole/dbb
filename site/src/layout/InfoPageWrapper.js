import React from 'react';
import useViewportMode, { VIEWPORT_MODES } from '../hooks/useViewportMode';
import { Link } from 'react-router-dom';

function InfoPageWrapper({ leftHeader, title, subtitle, children }) {
  const viewportMode = useViewportMode();
  const isMobile = viewportMode === VIEWPORT_MODES.MOBILE;
  const isTablet = viewportMode === VIEWPORT_MODES.TABLET;
  
  let containerClass = 'info-shared info-rel';
  if (isMobile) {
    containerClass += ' mobile-info-container';
  } else if (isTablet) {
    containerClass += ' tablet-info-container';
  } else {
    containerClass += ' info-container';
  }

  return (
    <div className={containerClass}>
      {/* Left/top absolute header slot (e.g., year selector) */}
      {leftHeader && (
        <div className="info-header-left-abs">
          {leftHeader}
        </div>
      )}

      {/* Mobile-only Home link in top-right */}
      {isMobile && (
        <div className="mobile-home-link-abs">
          <Link className="mobile-home-link" to="/home/" aria-label="Home">
            <span role="img" aria-hidden="true">🏠</span>
            Home
          </Link>
        </div>
      )}

      {/* Title and subtitle */}
      {title ? <h1 className="info-title">{title}</h1> : null}
      {subtitle ? <div className="info-subtitle">{subtitle}</div> : null}

      {/* Page content */}
      {children}
    </div>
  );
}

export default InfoPageWrapper; 