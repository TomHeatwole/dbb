import React from 'react';
import useIsMobile from '../hooks/useIsMobile';
import { Link } from 'react-router-dom';

function InfoPageWrapper({ leftHeader, title, subtitle, children }) {
  const isMobile = useIsMobile();
  const containerClass = `${isMobile ? 'mobile-info-container' : 'info-container'} info-shared info-rel`;

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